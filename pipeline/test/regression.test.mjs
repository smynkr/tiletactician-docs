import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  backendReceiptLabel,
  buildApiRequestBody,
  deriveCloudflareMode,
  scrubbedChildEnv,
  parseSSEPayload,
  retryAfterDelayMs,
  validateCloudflareConfig,
  validateGlmReasoningEffort,
} from "../docs-agent.mjs";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const driverPath = path.resolve(testDir, "..", "docs-agent.mjs");

function command(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, { encoding: "utf8", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${cmd} ${args.join(" ")} exited ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
  }
  return result;
}

function writeExecutable(filePath, source) {
  writeFileSync(filePath, source, "utf8");
  chmodSync(filePath, 0o755);
}

// The sandbox docs repo mirrors the axiom-docs invariants the driver relies on:
//   - CANONICAL flat sources live at <product>/*.mdx at the repo root;
//   - content/docs/ is generated output, rebuilt by _migration/tools/run-migration.mjs;
//   - docs.json is the navigation source of truth;
//   - the default branch is whatever the remote says (main in most fixtures,
//     "trunk" in the base-branch auto-detection test — the hardcoded-"main"
//     bug this suite locks down).
function setupSandbox({
  existingContent,
  backendOutput,
  product = "layer",
  defaultBranch = "main",
  seedDocsJson = true,
  filesApiFixture = null,
}) {
  const root = mkdtempSync(path.join(tmpdir(), "docs-agent-regression-"));
  const binDir = path.join(root, "bin");
  const sourceRepo = path.join(root, "source");
  const docsRemote = path.join(root, "docs-remote.git");
  const docsRepo = path.join(root, "docs");
  const backendOutputPath = path.join(root, "backend-output.txt");
  const backendEnvLogPath = path.join(root, "backend-env.jsonl");
  const migrationEnvLogPath = path.join(root, "migration-env.jsonl");
  const gitEnvLogPath = path.join(root, "git-env.log");
  const prBodyPath = path.join(root, "pr-body.md");
  const ghLogPath = path.join(root, "gh.log");
  const backendPath = path.join(binDir, "backend-stub.mjs");
  const ghPath = path.join(binDir, "gh");
  const gitPath = path.join(binDir, "git");

  mkdirSync(binDir, { recursive: true });
  writeFileSync(backendOutputPath, backendOutput, "utf8");
  writeExecutable(
    backendPath,
    `#!/usr/bin/env node
import { appendFileSync, readFileSync } from "node:fs";
const phase = process.argv.includes("--version") ? "version" : "invoke";
const sensitiveEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => key === "DOCS_AGENT_SOURCE_TOKEN" ||
    key === "GH_TOKEN" || key === "GITHUB_TOKEN" || key === "DOCS_REPO_PAT" ||
    key.startsWith("GIT_CONFIG_")),
);
if (process.env.DOCS_AGENT_STUB_ENV_LOG) {
  appendFileSync(process.env.DOCS_AGENT_STUB_ENV_LOG, JSON.stringify({ phase, env: sensitiveEnv }) + "\\n");
}
if (phase === "version") process.exit(0);
process.stdin.resume();
process.stdin.on("end", () => process.stdout.write(readFileSync(process.env.DOCS_AGENT_STUB_OUTPUT_FILE, "utf8")));
`,
  );
  writeExecutable(
    ghPath,
    `#!/bin/sh
printf '%s\\n' "$*" >> "$DOCS_AGENT_GH_LOG"
if [ "$1" = "--version" ]; then
  echo "gh version fake"
  exit 0
fi
if [ "$1" = "repo" ] && [ "$2" = "view" ]; then
  printf '{"defaultBranchRef":{"name":"%s"}}\\n' "$DOCS_AGENT_STUB_DEFAULT_BRANCH"
  exit 0
fi
if [ "$1" = "pr" ] && [ "$2" = "view" ]; then
  echo '{"title":"Oversized PR","body":"(body)","url":"https://example.test/pr/123","mergedAt":"2026-08-01T00:00:00Z","state":"MERGED","files":[],"number":123}'
  exit 0
fi
if [ "$1" = "pr" ] && [ "$2" = "diff" ]; then
  echo "could not find pull request diff: HTTP 406: Sorry, the diff exceeded the maximum number of lines (20000) (https://api.github.com/repos/example/product/pulls/123)" >&2
  echo "PullRequest.diff too_large" >&2
  exit 1
fi
if [ "$1" = "api" ]; then
  cat "$DOCS_AGENT_STUB_FILES_JSON"
  exit 0
fi
if [ "$1" = "pr" ] && [ "$2" = "list" ]; then
  echo "[]"
  exit 0
fi
if [ "$1" = "pr" ] && [ "$2" = "create" ]; then
  body_file=""
  for arg in "$@"; do
    if [ "$previous_arg" = "--body-file" ]; then body_file="$arg"; fi
    previous_arg="$arg"
  done
  if [ -n "$body_file" ]; then cp "$body_file" "$DOCS_AGENT_STUB_PR_BODY_FILE"; fi
  echo "https://example.test/docs/pull/1"
  exit 0
fi
echo "unexpected gh invocation: $*" >&2
exit 1
`,
  );
  writeExecutable(
    gitPath,
    `#!/bin/sh
if [ -n "$DOCS_AGENT_STUB_GIT_ENV_LOG" ]; then
  if [ -n "\${DOCS_AGENT_SOURCE_TOKEN-}\${GH_TOKEN-}\${GITHUB_TOKEN-}\${DOCS_REPO_PAT-}\${GIT_CONFIG_COUNT-}\${GIT_CONFIG_KEY_0-}\${GIT_CONFIG_VALUE_0-}\${GIT_CONFIG_PARAMETERS-}" ]; then
    printf '%s\\n' present >> "$DOCS_AGENT_STUB_GIT_ENV_LOG"
  else
    printf '%s\\n' empty >> "$DOCS_AGENT_STUB_GIT_ENV_LOG"
  fi
fi
exec /usr/bin/git "$@"
`,
  );

  command("git", ["init", "--bare", docsRemote]);
  command("git", ["clone", docsRemote, docsRepo]);
  command("git", ["-C", docsRepo, "checkout", "-b", defaultBranch]);
  command("git", ["-C", docsRepo, "config", "user.name", "docs-agent test bot"]);
  command("git", ["-C", docsRepo, "config", "user.email", "docs-agent-test@example.test"]);

  // Canonical flat source.
  mkdirSync(path.join(docsRepo, product), { recursive: true });
  writeFileSync(path.join(docsRepo, product, "reference.mdx"), existingContent, "utf8");
  command("git", ["-C", docsRepo, "add", `${product}/reference.mdx`]);

  // Keep the node_modules sentinel out of git, as in the real repo.
  writeFileSync(path.join(docsRepo, ".gitignore"), "node_modules/\n", "utf8");
  command("git", ["-C", docsRepo, "add", ".gitignore"]);

  // Navigation source of truth — shaped like the REAL docs.json: capitalized
  // product names and pages nested under tabs[].groups[].pages (the shapes
  // the additive docs.json gate must actually handle).
  const productName = product.charAt(0).toUpperCase() + product.slice(1);
  if (seedDocsJson) {
    writeFileSync(
      path.join(docsRepo, "docs.json"),
      `${JSON.stringify({ name: "Axiom", navigation: { products: [{ product: productName, tabs: [{ tab: "Docs", groups: [{ group: "Overview", pages: [`${product}/reference`] }] }] }] } }, null, 2)}\n`,
      "utf8",
    );
    command("git", ["-C", docsRepo, "add", "docs.json"]);
  }

  // Generation stub: copies each flat product tree into content/docs/<product>,
  // standing in for _migration/tools/run-migration.mjs. Resolves the repo root
  // from its own location (two levels up from _migration/tools/).
  const migrationDir = path.join(docsRepo, "_migration", "tools");
  mkdirSync(migrationDir, { recursive: true });
  writeFileSync(
    path.join(migrationDir, "run-migration.mjs"),
    `#!/usr/bin/env node
import { appendFileSync, cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const sensitiveEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => key === "DOCS_AGENT_SOURCE_TOKEN" ||
    key === "GH_TOKEN" || key === "GITHUB_TOKEN" || key === "DOCS_REPO_PAT" ||
    key.startsWith("GIT_CONFIG_")),
);
if (process.env.DOCS_AGENT_STUB_MIGRATION_ENV_LOG) {
  appendFileSync(process.env.DOCS_AGENT_STUB_MIGRATION_ENV_LOG, JSON.stringify({ env: sensitiveEnv }) + "\\n");
}
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const dest = path.join(repoRoot, "content", "docs");
rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
for (const entry of readdirSync(repoRoot)) {
  const dir = path.join(repoRoot, entry);
  if (!statSync(dir).isDirectory()) continue;
  if (entry.startsWith(".") || entry === "content" || entry === "node_modules" || entry === "_migration") continue;
  if (!existsSync(dir)) continue;
  cpSync(dir, path.join(dest, entry), { recursive: true });
}
console.log(JSON.stringify({ stub: true, destination: dest }));
`,
    "utf8",
  );
  command("git", ["-C", docsRepo, "add", "_migration/tools/run-migration.mjs"]);

  // The driver requires node_modules before running the regeneration.
  mkdirSync(path.join(docsRepo, "node_modules"), { recursive: true });
  writeFileSync(path.join(docsRepo, "node_modules", ".keep"), "", "utf8");

  command("git", ["-C", docsRepo, "commit", "-m", "seed docs"]);
  command("git", ["-C", docsRepo, "push", "-u", "origin", defaultBranch]);
  command("git", ["--git-dir", docsRemote, "symbolic-ref", "HEAD", `refs/heads/${defaultBranch}`]);

  command("git", ["init", sourceRepo]);
  command("git", ["-C", sourceRepo, "config", "user.name", "docs-agent test bot"]);
  command("git", ["-C", sourceRepo, "config", "user.email", "docs-agent-test@example.test"]);
  mkdirSync(path.join(sourceRepo, "src"), { recursive: true });
  writeFileSync(path.join(sourceRepo, "src", "feature.js"), "export const feature = false;\n", "utf8");
  command("git", ["-C", sourceRepo, "add", "src/feature.js"]);
  command("git", ["-C", sourceRepo, "commit", "-m", "seed source"]);
  writeFileSync(path.join(sourceRepo, "src", "feature.js"), "export const feature = true;\n", "utf8");
  command("git", ["-C", sourceRepo, "commit", "-am", "user-facing change"]);

  // Fixture for the pulls/N/files API fallback (the gh stub `cat`s it).
  const filesApiFixturePath = path.join(root, "files-api-fixture.json");
  if (filesApiFixture) {
    writeFileSync(filesApiFixturePath, JSON.stringify(filesApiFixture), "utf8");
  }

  return {
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    },
    docsRemote,
    docsRepo,
    ghLogPath,
    backendEnvLogPath,
    migrationEnvLogPath,
    gitEnvLogPath,
    prBodyPath,
    backendPath,
    sourceRepo,
    logDir: path.join(root, "logs"),
    run({ prMode = false, backend = "claude", env: extraEnv = {} } = {}) {
      return spawnSync(
        process.execPath,
        [
          driverPath,
          "--repo", "example/product",
          ...(prMode ? ["--pr", "123"] : ["--range", "HEAD~1..HEAD"]),
          "--docs-repo", "example/docs",
          "--docs-repo-path", docsRepo,
          "--product", product,
          "--backend", backend,
        ],
        {
          cwd: sourceRepo,
          encoding: "utf8",
          env: {
            ...process.env,
            DOCS_AGENT_CLAUDE_CMD: backendPath,
            DOCS_AGENT_GH_LOG: ghLogPath,
            DOCS_AGENT_LOG_DIR: path.join(root, "logs"),
            DOCS_AGENT_STUB_OUTPUT_FILE: backendOutputPath,
            DOCS_AGENT_STUB_DEFAULT_BRANCH: defaultBranch,
            DOCS_AGENT_STUB_FILES_JSON: filesApiFixturePath,
            DOCS_AGENT_STUB_ENV_LOG: backendEnvLogPath,
            DOCS_AGENT_STUB_MIGRATION_ENV_LOG: migrationEnvLogPath,
            DOCS_AGENT_STUB_GIT_ENV_LOG: gitEnvLogPath,
            DOCS_AGENT_STUB_PR_BODY_FILE: prBodyPath,
            PATH: `${binDir}:${process.env.PATH}`,
            ...extraEnv,
          },
        },
      );
    },
  };
}

function fileBlock(content, filePath = "layer/reference.mdx") {
  // The END marker follows the exact file bytes. It begins a fresh line only
  // when the file itself ends in a newline.
  return `===FILE: ${filePath}===\n${content}===END===\n`;
}

function ghCalls(logPath) {
  try {
    return readFileSync(logPath, "utf8").trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

function committedFiles(docsRepo) {
  return command("git", ["-C", docsRepo, "show", "--name-only", "--format=", "HEAD"])
    .stdout.trim()
    .split("\n")
    .filter(Boolean);
}
function normalizedProviderBlock(source) {
  const match = source.match(/^\s+glm:\s*\{([\s\S]*?)^\s+\},$/m);
  assert.ok(match, "the driver must keep a named glm provider block");
  return match[1].replace(/\/\/.*$/gm, "").replace(/\s+/g, " ").trim();
}

function normalizedWorkflowProviderEnv(template) {
  const stepStart = template.indexOf("      - name: Run docs-agent with Cloudflare GLM 5.3 Flash");
  assert.notEqual(stepStart, -1, "workflow must contain the migrated docs-agent step");
  const runStart = template.indexOf("\n        run:", stepStart);
  assert.notEqual(runStart, -1, "migrated docs-agent step must contain a run block");
  const step = template.slice(stepStart, runStart);
  const names = [
    "DOCS_AGENT_SOURCE_TOKEN",
    "GH_TOKEN",
    "CLOUDFLARE_ACCOUNT_ID",
    "DOCS_AGENT_GLM_API_BASE",
    "DOCS_AGENT_GLM_MODEL",
    "DOCS_AGENT_GLM_MAX_TOKENS",
    "DOCS_AGENT_GLM_REASONING_EFFORT",
    "GLM_API_KEY",
  ];
  return Object.fromEntries(
    names.map((name) => {
      const match = step.match(new RegExp(`^\\s+${name}:\\s*(.+)$`, "m"));
      return [name, match?.[1]?.trim() ?? null];
    }),
  );
}

const TASK1_PROVIDER_SOURCE_FIXTURE = Object.freeze([
  'type: "api"',
  'apiBase: (process.env.DOCS_AGENT_GLM_API_BASE || "").replace(/\\/+$/, "")',
  'apiBaseEnv: "DOCS_AGENT_GLM_API_BASE"',
  "model: process.env.DOCS_AGENT_GLM_MODEL || CLOUDFLARE_GLM_53_MODEL",
  'reasoningEffort: process.env.DOCS_AGENT_GLM_REASONING_EFFORT || "high"',
  'reasoningEffortEnv: "DOCS_AGENT_GLM_REASONING_EFFORT"',
  'apiKeyEnv: "GLM_API_KEY"',
  "maxTokens: Number(process.env.DOCS_AGENT_GLM_MAX_TOKENS || 49152)",
  'maxTokensEnv: "DOCS_AGENT_GLM_MAX_TOKENS"',
]);

test("standalone provider and template match the normalized Task 1 contract", () => {
  const driverSource = readFileSync(driverPath, "utf8");
  const normalized = normalizedProviderBlock(driverSource);
  for (const fragment of TASK1_PROVIDER_SOURCE_FIXTURE) {
    assert.ok(normalized.includes(fragment), `provider block is missing Task 1 fragment: ${fragment}`);
  }
  assert.match(driverSource, /const CLOUDFLARE_GLM_53_MODEL = "@cf\/zai-org\/glm-5\.3-flash";/);
  assert.match(driverSource, /return Boolean\(\s*backend\??\.model === CLOUDFLARE_GLM_53_MODEL/);
  assert.match(driverSource, /const expectedApiBase = `https:\/\/api\.cloudflare\.com\/client\/v4\/accounts\/\$\{accountId\}\/ai\/v1`;/);

  // Observe provider defaults and allowed values through production exports.
  // The expected fixture remains independent; it is never spread into the
  // observed object, so this parity check cannot pass by construction.
  const providerProbeEnv = { ...process.env };
  for (const name of [
    "CLOUDFLARE_ACCOUNT_ID",
    "DOCS_AGENT_GLM_API_BASE",
    "DOCS_AGENT_GLM_MODEL",
    "DOCS_AGENT_GLM_MAX_TOKENS",
    "DOCS_AGENT_GLM_REASONING_EFFORT",
    "GLM_API_KEY",
  ]) {
    delete providerProbeEnv[name];
  }
  const providerProbe = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `const m = await import(${JSON.stringify(driverPath)}); process.stdout.write(JSON.stringify(m.getGlmProviderContract()));`,
    ],
    { encoding: "utf8", env: providerProbeEnv },
  );
  assert.equal(providerProbe.status, 0, providerProbe.stderr);
  const glmContract = JSON.parse(providerProbe.stdout);
  assert.ok(
    backendReceiptLabel("glm").includes("model:"),
    "receipt label must identify the configured model",
  );
  const observedProvider = {
    defaultModel: glmContract.defaultModel,
    defaultReasoningEffort: glmContract.defaultReasoningEffort,
    allowedReasoningEfforts: [...glmContract.allowedReasoningEfforts],
    maxTokens: glmContract.maxTokens,
    reasoningEffortEnv: glmContract.reasoningEffortEnv,
  };
  assert.deepEqual(observedProvider, {
    defaultModel: "@cf/zai-org/glm-5.3-flash",
    defaultReasoningEffort: "high",
    allowedReasoningEfforts: ["low", "medium", "high"],
    maxTokens: 49152,
    reasoningEffortEnv: "DOCS_AGENT_GLM_REASONING_EFFORT",
  });

  assert.equal(retryAfterDelayMs(new Headers({ "Retry-After": "2" }), 1_000), 2_000);
  assert.equal(retryAfterDelayMs(new Headers({ "Retry-After": "99" }), 1_000), 5_000);
  assert.equal(retryAfterDelayMs(new Headers(), 1_000), 250);

  const request = buildApiRequestBody(
    {
      model: glmContract.defaultModel,
      maxTokens: glmContract.maxTokens,
      reasoningEffort: glmContract.defaultReasoningEffort,
      reasoningEffortEnv: glmContract.reasoningEffortEnv,
    },
    "prompt",
    true,
  );
  assert.deepEqual(request, {
    model: "@cf/zai-org/glm-5.3-flash",
    messages: [{ role: "user", content: "prompt" }],
    temperature: 0.2,
    max_tokens: 49152,
    reasoning_effort: "high",
    stream: true,
  });

  for (const value of ["", "none", "max", "xhigh", "HIGH"]) {
    assert.match(
      validateGlmReasoningEffort(
        {
          model: "@cf/zai-org/glm-5.3-flash",
          reasoningEffort: "high",
          reasoningEffortEnv: "DOCS_AGENT_GLM_REASONING_EFFORT",
        },
        true,
        value,
      ),
      /must be low, medium, or high/,
    );
  }
  assert.equal(
    validateGlmReasoningEffort(
      {
        model: "@cf/zai-org/glm-5.3-flash",
        reasoningEffort: "high",
        reasoningEffortEnv: "DOCS_AGENT_GLM_REASONING_EFFORT",
      },
      true,
      "low",
    ),
    null,
  );
  assert.equal(
    validateGlmReasoningEffort(
      {
        model: "@cf/zai-org/glm-5.2",
        reasoningEffort: "high",
        reasoningEffortEnv: "DOCS_AGENT_GLM_REASONING_EFFORT",
      },
      true,
      "invalid",
    ),
    null,
    "legacy Cloudflare models retain their historical reasoning wire format",
  );
  assert.equal(
    buildApiRequestBody(
      { model: "@cf/zai-org/glm-5.2", maxTokens: 49152, reasoningEffort: "high" },
      "prompt",
      true,
    ).reasoning_effort,
    undefined,
  );

  const template = readFileSync(path.resolve(testDir, "..", "docs-agent.yml"), "utf8");
  assert.match(template, /name:\s+hosted \(GLM 5\.2 — drafts doc update\)/);
  assert.deepEqual(normalizedWorkflowProviderEnv(template), {
    DOCS_AGENT_SOURCE_TOKEN: "${{ github.token }}",
    GH_TOKEN: "${{ secrets.DOCS_REPO_PAT }}",
    CLOUDFLARE_ACCOUNT_ID: "${{ vars.CLOUDFLARE_ACCOUNT_ID }}",
    DOCS_AGENT_GLM_API_BASE: "${{ vars.DOCS_AGENT_GLM_API_BASE }}",
    DOCS_AGENT_GLM_MODEL: "${{ vars.DOCS_AGENT_GLM_MODEL }}",
    DOCS_AGENT_GLM_MAX_TOKENS: "${{ vars.DOCS_AGENT_GLM_MAX_TOKENS }}",
    DOCS_AGENT_GLM_REASONING_EFFORT: "${{ vars.DOCS_AGENT_GLM_REASONING_EFFORT || 'high' }}",
    GLM_API_KEY: "${{ secrets.CLOUDFLARE_WORKERS_AI_TOKEN }}",
  });
  assert.doesNotMatch(template, /GLM_API_KEY:\s*\$\{\{\s*secrets\.GLM_API_KEY\s*\}\}/);
});

test("exact Cloudflare GLM 5.3 Flash mode fails closed before any fetch", async (t) => {
  for (const [name, env, expectedError] of [
    [
      "missing account",
      {
        CLOUDFLARE_ACCOUNT_ID: "",
        DOCS_AGENT_GLM_MODEL: "@cf/zai-org/glm-5.3-flash",
        DOCS_AGENT_GLM_API_BASE: "https://example.test/v1",
        GLM_API_KEY: "test-key",
      },
      /CLOUDFLARE_ACCOUNT_ID must be 32 lowercase hexadecimal characters/,
    ],
    [
      "stale account endpoint",
      {
        CLOUDFLARE_ACCOUNT_ID: "0123456789abcdef0123456789abcdef",
        DOCS_AGENT_GLM_MODEL: "@cf/zai-org/glm-5.3-flash",
        DOCS_AGENT_GLM_API_BASE: "https://api.cloudflare.com/client/v4/accounts/stale/ai/v1",
        GLM_API_KEY: "test-key",
      },
      /DOCS_AGENT_GLM_API_BASE must be exactly the Cloudflare account endpoint/,
    ],
  ]) {
    await t.test(name, () => {
      const backend = { model: env.DOCS_AGENT_GLM_MODEL };
      const accountId = env.CLOUDFLARE_ACCOUNT_ID;
      const apiBase = env.DOCS_AGENT_GLM_API_BASE;
      const apiBaseHostname = new URL(apiBase).hostname;
      assert.equal(deriveCloudflareMode(backend, accountId, apiBaseHostname), true);
      assert.match(validateCloudflareConfig(backend, true, accountId, apiBase), expectedError);
      const sandbox = setupSandbox({ existingContent: "# Reference\n", backendOutput: "" });
      t.after(() => sandbox.cleanup());
      const result = sandbox.run({ backend: "glm", env });

      assert.notEqual(result.status, 0);
      assert.match(result.stderr, expectedError);
      assert.equal(existsSync(sandbox.backendEnvLogPath), false);
    });
  }
});

test("non-GitHub child environments strip GitHub and git-config credentials", (t) => {
  const input = {
    SAFE_VALUE: "retained",
    DOCS_AGENT_SOURCE_TOKEN: "source-token",
    GH_TOKEN: "destination-token",
    GITHUB_TOKEN: "github-token",
    DOCS_REPO_PAT: "docs-repo-pat",
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "credential.helper",
    GIT_CONFIG_VALUE_0: "!printf secret",
    GIT_CONFIG_PARAMETERS: "'credential.helper=store'",
  };
  const observed = scrubbedChildEnv(input);
  assert.equal(observed.SAFE_VALUE, "retained");
  assert.equal(input.GH_TOKEN, "destination-token", "scrubbing must not mutate the parent environment");
  for (const key of [
    "DOCS_AGENT_SOURCE_TOKEN",
    "GH_TOKEN",
    "GITHUB_TOKEN",
    "DOCS_REPO_PAT",
    "GIT_CONFIG_COUNT",
    "GIT_CONFIG_KEY_0",
    "GIT_CONFIG_VALUE_0",
    "GIT_CONFIG_PARAMETERS",
  ]) {
    assert.equal(observed[key], undefined, `${key} must not reach a non-GitHub child`);
  }

  const changedContent = "# Reference\n\nCredential isolation.\n";
  const sandbox = setupSandbox({ existingContent: "# Reference\n", backendOutput: fileBlock(changedContent) });
  t.after(() => sandbox.cleanup());
  const result = sandbox.run({ env: input });

  assert.equal(result.status, 0, result.stderr);
  const backendRecords = readFileSync(sandbox.backendEnvLogPath, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  assert.deepEqual(backendRecords.map((record) => record.phase), ["version", "invoke"]);
  for (const record of backendRecords) assert.deepEqual(record.env, {});
  const migrationRecord = JSON.parse(readFileSync(sandbox.migrationEnvLogPath, "utf8").trim());
  assert.deepEqual(migrationRecord.env, {});
  const gitRecords = readFileSync(sandbox.gitEnvLogPath, "utf8").trim().split("\n").filter(Boolean);
  assert.ok(gitRecords.length > 0, "driver must invoke repository git subprocesses");
  assert.deepEqual(new Set(gitRecords), new Set(["empty"]));
});

test("T1: byte-identical file blocks do not create branches, commits, or PRs", async (t) => {
  for (const existingContent of ["# Reference\n", "# Reference without final newline"]) {
    await t.test(JSON.stringify(existingContent), () => {
      const sandbox = setupSandbox({ existingContent, backendOutput: fileBlock(existingContent) });
      t.after(() => sandbox.cleanup());
      const result = sandbox.run();

      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /No-op\. NOT opening a PR/);
      assert.deepEqual(
        command("git", ["--git-dir", sandbox.docsRemote, "for-each-ref", "--format=%(refname)", "refs/heads"])
          .stdout.trim()
          .split("\n"),
        ["refs/heads/main"],
      );
      assert.equal(command("git", ["-C", sandbox.docsRepo, "status", "--short"]).stdout, "");
      assert.equal(readFileSync(path.join(sandbox.docsRepo, "layer", "reference.mdx"), "utf8"), existingContent);
      assert.deepEqual(ghCalls(sandbox.ghLogPath), ["--version"]);
    });
  }
});

test("T2: changed content writes the flat source, regenerates content/docs, and commits both", (t) => {
  const changedContent = "# Reference\n\nUpdated behavior.\n";
  const sandbox = setupSandbox({ existingContent: "# Reference\n", backendOutput: fileBlock(changedContent) });
  t.after(() => sandbox.cleanup());
  const result = sandbox.run();

  assert.equal(result.status, 0, result.stderr);
  // Canonical flat source updated...
  assert.equal(readFileSync(path.join(sandbox.docsRepo, "layer", "reference.mdx"), "utf8"), changedContent);
  // ...and the generated tree was rebuilt from it by the migration step.
  assert.equal(readFileSync(path.join(sandbox.docsRepo, "content", "docs", "layer", "reference.mdx"), "utf8"), changedContent);
  assert.match(command("git", ["-C", sandbox.docsRepo, "branch", "--show-current"]).stdout, /^docs-agent\/layer-range-/);
  assert.equal(command("git", ["-C", sandbox.docsRepo, "rev-list", "--count", "origin/main..HEAD"]).stdout.trim(), "1");
  // The commit carries both the canonical edit and the regenerated output —
  // and nothing else.
  const files = committedFiles(sandbox.docsRepo);
  assert.ok(files.includes("layer/reference.mdx"), `commit missing flat source: ${files}`);
  assert.ok(files.includes("content/docs/layer/reference.mdx"), `commit missing regenerated output: ${files}`);
  const calls = ghCalls(sandbox.ghLogPath);
  assert.deepEqual(calls.map((call) => call.split(" ").slice(0, 2).join(" ")), [
    "--version",
    "repo view",
    "pr list",
    "pr create",
  ]);
  assert.match(calls.at(-1), /--base main/);
  const prBody = readFileSync(sandbox.prBodyPath, "utf8");
  assert.ok(
    prBody.includes(`(backend: **claude** CLI (\`${sandbox.backendPath}\`))`),
    "generated PR body must include the receipt label for the actual backend command",
  );
});

test("T3: base branch is auto-detected from the docs repo, not hardcoded to main", (t) => {
  const changedContent = "# Reference\n\nUpdated on a master-style repo.\n";
  const sandbox = setupSandbox({
    existingContent: "# Reference\n",
    backendOutput: fileBlock(changedContent),
    defaultBranch: "trunk",
  });
  t.after(() => sandbox.cleanup());
  const result = sandbox.run();

  assert.equal(result.status, 0, result.stderr);
  assert.equal(command("git", ["-C", sandbox.docsRepo, "rev-list", "--count", "origin/trunk..HEAD"]).stdout.trim(), "1");
  assert.match(ghCalls(sandbox.ghLogPath).at(-1), /--base trunk/);
});

test("T4: Invest is a supported docs-agent product", (t) => {
  const changedContent = "# Invest reference\n\nUpdated paper-trading behavior.\n";
  const sandbox = setupSandbox({
    existingContent: "# Invest reference\n",
    backendOutput: fileBlock(changedContent, "invest/reference.mdx"),
    product: "invest",
  });
  t.after(() => sandbox.cleanup());
  const result = sandbox.run();

  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    readFileSync(path.join(sandbox.docsRepo, "invest", "reference.mdx"), "utf8"),
    changedContent,
  );
  assert.match(command("git", ["-C", sandbox.docsRepo, "branch", "--show-current"]).stdout, /^docs-agent\/invest-range-/);
});

test("T5: legacy content/docs/<product> paths are remapped to the canonical flat source", (t) => {
  const changedContent = "# Reference\n\nRemapped from the generated tree.\n";
  const sandbox = setupSandbox({
    existingContent: "# Reference\n",
    backendOutput: fileBlock(changedContent, "content/docs/layer/reference.mdx"),
  });
  t.after(() => sandbox.cleanup());
  const result = sandbox.run();

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /remapping generated path/);
  assert.equal(readFileSync(path.join(sandbox.docsRepo, "layer", "reference.mdx"), "utf8"), changedContent);
  assert.equal(readFileSync(path.join(sandbox.docsRepo, "content", "docs", "layer", "reference.mdx"), "utf8"), changedContent);
});

test("T6: docs.json may be rewritten for new-page navigation, but invalid JSON fails closed", async (t) => {
  await t.test("valid docs.json rewrite is committed", () => {
    const newDocsJson = `${JSON.stringify({ name: "Axiom", navigation: { products: [{ product: "Layer", tabs: [{ tab: "Docs", groups: [{ group: "Overview", pages: ["layer/reference", "layer/new-page"] }] }] }] } }, null, 2)}\n`;
    const sandbox = setupSandbox({
      existingContent: "# Reference\n",
      backendOutput:
        fileBlock("# Reference\n\nUpdated.\n") +
        fileBlock(newDocsJson, "docs.json"),
    });
    t.after(() => sandbox.cleanup());
    const result = sandbox.run();

    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(path.join(sandbox.docsRepo, "docs.json"), "utf8"), newDocsJson);
    assert.ok(committedFiles(sandbox.docsRepo).includes("docs.json"));
  });

  await t.test("invalid docs.json fails without a PR", () => {
    const sandbox = setupSandbox({
      existingContent: "# Reference\n",
      backendOutput:
        fileBlock("# Reference\n\nUpdated.\n") +
        fileBlock("{ not valid json", "docs.json"),
    });
    t.after(() => sandbox.cleanup());
    const result = sandbox.run();

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /docs\.json that is not valid JSON/);
  });
});

test("T7: paths outside the product's canonical sources are rejected fail-closed", async (t) => {
  for (const [name, badPath] of [
    ["another product's flat source", "overwatch/reference.mdx"],
    ["generated tree of another product", "content/docs/overwatch/reference.mdx"],
    ["application code", "app/layout.tsx"],
    ["generated meta.json", "content/docs/layer/meta.json"],
    ["path traversal", "layer/../secrets.mdx"],
  ]) {
    await t.test(name, () => {
      const sandbox = setupSandbox({
        existingContent: "# Reference\n",
        backendOutput: fileBlock("# Evil\n", badPath),
      });
      t.after(() => sandbox.cleanup());
      const result = sandbox.run();

      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /disallowed file path/);
      assert.deepEqual(ghCalls(sandbox.ghLogPath), ["--version"]);
    });
  }
});

test("T9: a dirty docs checkout fails closed before any commit", async (t) => {
  for (const [name, makeDirty] of [
    ["untracked leftover", (repo) => writeFileSync(path.join(repo, "stray-local-file.txt"), "junk\n", "utf8")],
    ["modified tracked page", (repo) => writeFileSync(path.join(repo, "layer", "reference.mdx"), "# half-finished manual edit\n", "utf8")],
  ]) {
    await t.test(name, () => {
      const sandbox = setupSandbox({
        existingContent: "# Reference\n",
        backendOutput: fileBlock("# Reference\n\nUpdated behavior.\n"),
      });
      t.after(() => sandbox.cleanup());
      makeDirty(sandbox.docsRepo);
      const result = sandbox.run();

      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /uncommitted changes/);
      // No branch was pushed and nothing was committed.
      assert.deepEqual(
        command("git", ["--git-dir", sandbox.docsRemote, "for-each-ref", "--format=%(refname)", "refs/heads"])
          .stdout.trim()
          .split("\n"),
        ["refs/heads/main"],
      );
    });
  }
});

test("T10: a docs.json that removes navigation fails closed", (t) => {
  const destructiveDocsJson = `${JSON.stringify({ name: "Axiom", navigation: { products: [{ product: "Layer", tabs: [{ tab: "Docs", groups: [{ group: "Overview", pages: [] }] }] }] } }, null, 2)}\n`;
  const sandbox = setupSandbox({
    existingContent: "# Reference\n",
    backendOutput:
      fileBlock("# Reference\n\nUpdated.\n") +
      fileBlock(destructiveDocsJson, "docs.json"),
  });
  t.after(() => sandbox.cleanup());
  const result = sandbox.run();

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /removes .* navigation page/);
  // The flat source was never written — validation precedes all writes.
  assert.equal(readFileSync(path.join(sandbox.docsRepo, "layer", "reference.mdx"), "utf8"), "# Reference\n");
});

test("T11: oversized PR diffs fall back to per-file patches without corruption", (t) => {
  const sandbox = setupSandbox({
    existingContent: "# Reference\n",
    backendOutput: "===NO-DOC-CHANGE===\nInternal-only changes.\n",
    filesApiFixture: [
      {
        filename: "src/matrix.py",
        status: "modified",
        // `][` inside a patch must survive verbatim — the retired page-merge
        // regex rewrote it to `,` and silently corrupted the diff.
        patch: "@@ -1 +1 @@\n-value = arr[i][j]\n+value = arr[i][j] + extra[0][1]",
      },
      { filename: "assets/huge-generated-file.bin" }, // no patch → disclosed as oversized
    ],
  });
  t.after(() => sandbox.cleanup());
  const result = sandbox.run({ prMode: true });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /falling back to per-file API patches/);
  const promptFile = command("sh", ["-c", `ls ${sandbox.logDir}/*-prompt.txt`]).stdout.trim();
  const prompt = readFileSync(promptFile, "utf8");
  assert.ok(prompt.includes("arr[i][j]"), "patch content was corrupted");
  assert.ok(prompt.includes("assets/huge-generated-file.bin"), "patch-less file not disclosed to the model");
  assert.ok(prompt.includes("too large for the GitHub API"), "missing incomplete-diff section");
});

test("SSE payload parsing survives provider quirks and truncation signals", async (t) => {
  const evt = (obj) => `data: ${JSON.stringify(obj)}`;
  const contentEvt = (s) => evt({ choices: [{ delta: { content: s } }] });
  const reasoningEvt = (s) => evt({ choices: [{ delta: { reasoning: s } }] });
  const finishEvt = (r) => evt({ choices: [{ delta: {}, finish_reason: r }] });

  await t.test("assembles content across events, skipping comments and [DONE]", () => {
    const payload = [
      ": cost {\"usd\": 0.01}", // provider comment line, not an event
      contentEvt("Hello "),
      "", // keep-alive
      contentEvt("world"),
      "data: [DONE]",
    ].join("\n");
    assert.deepEqual(parseSSEPayload(payload), { content: "Hello world", reasoningChars: 0, finishReason: null, sawDone: true });
  });

  await t.test("counts reasoning chars and captures finish_reason=length", () => {
    const payload = [reasoningEvt("thinking..."), contentEvt("answer"), finishEvt("length")].join("\n");
    assert.deepEqual(parseSSEPayload(payload), { content: "answer", reasoningChars: 11, finishReason: "length", sawDone: false });
  });

  await t.test("counts the reasoning_content spelling too (Zhipu/DeepSeek-style)", () => {
    const payload = [
      evt({ choices: [{ delta: { reasoning_content: "hmm" } }] }),
      contentEvt("ok"),
    ].join("\n");
    assert.deepEqual(parseSSEPayload(payload), { content: "ok", reasoningChars: 3, finishReason: null, sawDone: false });
  });

  await t.test("reports a stream with neither finish_reason nor [DONE]", () => {
    const parsed = parseSSEPayload(contentEvt("partial"));
    assert.equal(parsed.finishReason, null);
    assert.equal(parsed.sawDone, false); // runBackend fails the run on this pair
  });

  await t.test("tolerates CRLF and a malformed event line", () => {
    const payload = `${contentEvt("a")}\r\ndata: {not json\r\n${contentEvt("b")}\r\n`;
    assert.equal(parseSSEPayload(payload).content, "ab");
  });

  await t.test("parses a final event with no trailing newline", () => {
    const payload = `${contentEvt("first")}\n${finishEvt("stop")}`; // no trailing \n
    const parsed = parseSSEPayload(payload);
    assert.equal(parsed.content, "first");
    assert.equal(parsed.finishReason, "stop");
  });
});

test("T8: empty and malformed backend output fail without a PR attempt", async (t) => {
  for (const [name, backendOutput, expectedError] of [
    ["empty stdout", "", /EMPTY stdout/],
    ["malformed output", "I updated nothing and forgot the required markers.", /zero parseable/],
  ]) {
    await t.test(name, () => {
      const sandbox = setupSandbox({ existingContent: "# Reference\n", backendOutput });
      t.after(() => sandbox.cleanup());
      const result = sandbox.run();

      assert.notEqual(result.status, 0);
      assert.match(result.stderr, expectedError);
      assert.deepEqual(ghCalls(sandbox.ghLogPath), ["--version"]);
    });
  }
});
