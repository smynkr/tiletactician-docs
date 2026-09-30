import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  backendReceiptLabel,
  getBackendConfig,
  VALID_GLM_REASONING_EFFORTS,
  buildApiRequestBody,
  fallbackReasoningEffort,
  isFallbackEligibleStatus,
  runApiBackend,
  scrubbedChildEnv,
  destinationGitEnv,
  parseSSEPayload,
  retryAfterDelayMs,
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
    key === "GLM_API_KEY" || key === "GLM_FALLBACK_API_KEY" || key.startsWith("GIT_CONFIG_")),
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
    key === "GLM_API_KEY" || key === "GLM_FALLBACK_API_KEY" || key.startsWith("GIT_CONFIG_")),
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
function runBackendProbe(env) {
  const probe = spawnSync(process.execPath, ["--input-type=module", "--eval", `
    const m = await import(${JSON.stringify(driverPath)});
    let fetchCalled = false;
    globalThis.fetch = async () => { fetchCalled = true; throw new Error("fetch should not run"); };
    process.exit = code => { throw new Error(\`process.exit(\${code})\`); };
    let error = null;
    try { await m.runBackend("glm", "probe", 1000); } catch (err) { error = err.message; }
    console.log(JSON.stringify({ error, fetchCalled }));
  `], { env, encoding: "utf8" });
  assert.equal(probe.status, 0, probe.stderr);
  return { ...JSON.parse(probe.stdout), stderr: probe.stderr };
}

test("GLM defaults resolve to z.ai, high effort, and glm-5.3-flash", () => {
  const env = { ...process.env };
  for (const key of ["DOCS_AGENT_GLM_API_BASE", "DOCS_AGENT_GLM_MODEL", "DOCS_AGENT_GLM_REASONING_EFFORT"]) delete env[key];
  const probe = spawnSync(process.execPath, ["--input-type=module", "--eval", `
    const m = await import(${JSON.stringify(driverPath)});
    const { apiBase, model, reasoningEffort } = m.getBackendConfig("glm");
    console.log(JSON.stringify({ apiBase, model, reasoningEffort, body: m.buildApiRequestBody({ model, reasoningEffort, maxTokens: 49152 }, "prompt"), receipt: m.backendReceiptLabel("glm") }));
  `], { env, encoding: "utf8" });
  assert.equal(probe.status, 0, probe.stderr);
  const result = JSON.parse(probe.stdout);
  assert.equal(result.apiBase, "https://api.z.ai/api/coding/paas/v4");
  assert.equal(result.model, "glm-5.3-flash");
  assert.equal(result.reasoningEffort, "high");
  assert.equal(result.body.reasoning_effort, "high");
  assert.match(result.receipt, /glm-5\.3-flash.*api\.z\.ai/);
});

test("generic custom base/model and garbage retired account ID are accepted", () => {
  const probe = spawnSync(process.execPath, ["--input-type=module", "--eval", `
    const m = await import(${JSON.stringify(driverPath)});
    const backend = m.getBackendConfig("glm");
    console.log(JSON.stringify({ apiBase: backend.apiBase, body: m.buildApiRequestBody(backend, "prompt"), error: m.validateGlmReasoningEffort(backend) }));
  `], { env: { ...process.env, DOCS_AGENT_GLM_API_BASE: "https://example.test/v1///", DOCS_AGENT_GLM_MODEL: "custom-model", DOCS_AGENT_GLM_REASONING_EFFORT: "max", CLOUDFLARE_ACCOUNT_ID: "garbage" }, encoding: "utf8" });
  assert.equal(probe.status, 0, probe.stderr);
  const result = JSON.parse(probe.stdout);
  assert.equal(result.apiBase, "https://example.test/v1");
  assert.equal(result.body.model, "custom-model");
  assert.equal(result.body.reasoning_effort, "max");
  assert.equal(result.error, null);
});

test("invalid GLM effort fails before fetching", () => {
  const result = runBackendProbe({ ...process.env, GLM_API_KEY: "test-key", DOCS_AGENT_GLM_REASONING_EFFORT: "extreme" });
  assert.equal(result.fetchCalled, false);
  assert.match(result.stderr, /DOCS_AGENT_GLM_REASONING_EFFORT must be low, medium, high, or max/);
  for (const reasoningEffort of VALID_GLM_REASONING_EFFORTS) assert.equal(validateGlmReasoningEffort({ reasoningEffort }), null);
});

test("GLM effort is always sent and DeepSeek wire format has no effort", () => {
  for (const reasoningEffort of ["high", "max"]) {
    assert.equal(buildApiRequestBody({ model: "glm-5.3-flash", maxTokens: 49152, reasoningEffort }, "prompt").reasoning_effort, reasoningEffort);
  }
  assert.equal(Object.hasOwn(buildApiRequestBody({ model: "deepseek-v4-flash", maxTokens: 49152 }, "prompt"), "reasoning_effort"), false);
  assert.equal(retryAfterDelayMs(new Headers({ "Retry-After": "99" })), 5000);
});

test("workflow maps z.ai subscription and optional OpenRouter fallback", () => {
  const template = readFileSync(path.resolve(testDir, "..", "docs-agent.yml"), "utf8").replace(/[ \t]+/g, " ");
  for (const expected of [
    "DOCS_AGENT_GLM_API_BASE: ${{ vars.DOCS_AGENT_GLM_API_BASE }}",
    "DOCS_AGENT_GLM_MODEL: ${{ vars.DOCS_AGENT_GLM_MODEL }}",
    "DOCS_AGENT_GLM_MAX_TOKENS: ${{ vars.DOCS_AGENT_GLM_MAX_TOKENS }}",
    "DOCS_AGENT_GLM_REASONING_EFFORT: ${{ vars.DOCS_AGENT_GLM_REASONING_EFFORT || 'high' }}",
    "GLM_API_KEY: ${{ secrets.ZAI_API_KEY }}",
    "DOCS_AGENT_GLM_FALLBACK_API_BASE: ${{ vars.DOCS_AGENT_GLM_FALLBACK_API_BASE }}",
    "DOCS_AGENT_GLM_FALLBACK_MODEL: ${{ vars.DOCS_AGENT_GLM_FALLBACK_MODEL }}",
    "GLM_FALLBACK_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}",
  ]) assert.ok(template.includes(expected), `workflow is missing ${expected}`);
});

test("non-GitHub children scrub credentials while destination git preserves only destination auth", (t) => {
  const input = {
    SAFE_VALUE: "retained",
    GLM_API_KEY: "primary-test-key",
    GLM_FALLBACK_API_KEY: "fallback-test-key",
    DOCS_AGENT_SOURCE_TOKEN: "source-token",
    GH_TOKEN: "destination-token",
    GITHUB_TOKEN: "github-token",
    DOCS_REPO_PAT: "docs-repo-pat",
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "credential.helper",
    GIT_CONFIG_VALUE_0: "!printf secret",
    GIT_CONFIG_PARAMETERS: "'credential.helper=store'",
    SSH_AUTH_SOCK: "/tmp/ssh-agent.sock",
  };
  const observed = scrubbedChildEnv(input);
  assert.equal(observed.SAFE_VALUE, "retained");
  assert.equal(input.GH_TOKEN, "destination-token", "scrubbing must not mutate the parent environment");
  for (const key of [
    "GLM_API_KEY",
    "GLM_FALLBACK_API_KEY",
    "DOCS_AGENT_SOURCE_TOKEN",
    "GH_TOKEN",
    "GITHUB_TOKEN",
    "DOCS_REPO_PAT",
    "GIT_CONFIG_COUNT",
    "GIT_CONFIG_KEY_0",
    "GIT_CONFIG_VALUE_0",
    "GIT_CONFIG_PARAMETERS",
    "SSH_AUTH_SOCK",
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
  assert.deepEqual(new Set(gitRecords), new Set(["empty", "present"]));
  assert.deepEqual(
    destinationGitEnv({
      DOCS_AGENT_SOURCE_TOKEN: "source",
      GLM_API_KEY: "primary-test-key",
      GLM_FALLBACK_API_KEY: "fallback-test-key",
      GH_TOKEN: "destination",
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
      GIT_CONFIG_VALUE_0: "AUTHORIZATION: basic destination",
    }),
    {
      GH_TOKEN: "destination",
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
      GIT_CONFIG_VALUE_0: "AUTHORIZATION: basic destination",
    },
  );
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

test("fallback effort mapping and deterministic status exclusions", () => {
  assert.equal(fallbackReasoningEffort("https://openrouter.ai/api/v1", "max"), "xhigh");
  assert.equal(fallbackReasoningEffort("https://example.test/v1", "max"), "max");
  assert.equal(fallbackReasoningEffort("https://openrouter.ai.example.test/v1", "max"), "max");
  assert.equal(fallbackReasoningEffort("https://openrouter.ai/api/v1", "high"), "high");
  for (const status of [401, 403, 408, 409, 429, 500, 503, 599]) assert.equal(isFallbackEligibleStatus(status, "failure"), true);
  for (const status of [400, 402, 404, 418, 422]) assert.equal(isFallbackEligibleStatus(status, "quota 1113"), false);
  for (const body of ["1113", "1308", "1310", "insufficient balance", "usage limit", "quota"]) assert.equal(isFallbackEligibleStatus(200, body), true);
});

test("GLM fallback uses one request, pinned effort, and the serving receipt", async (t) => {
  const cases = [
    ["503 then fallback", [503], true, true],
    ["400 surfaces without fallback", [400], true, false],
    ["429 twice then fallback", [429, 429], true, true],
    ["503 without configuration", [503], false, false],
    ["401 then fallback", [401], true, true],
    ["403 then fallback", [403], true, true],
    ["408 then fallback", [408], true, true],
    ["409 then fallback", [409], true, true],
  ];
  for (const [name, statuses, enabled, succeeds] of cases) await t.test(name, async () => {
    const requests = [];
    const server = createServer((req, res) => {
      let raw = "";
      req.setEncoding("utf8");
      req.on("data", chunk => raw += chunk);
      req.on("end", () => {
        requests.push({ path: req.url, body: JSON.parse(raw), authorization: req.headers.authorization });
        const status = statuses[requests.length - 1] || 200;
        if (status !== 200) { res.writeHead(status, { "Retry-After": "0" }); res.end("provider failure"); return; }
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.end('data: {"choices":[{"delta":{"content":"answer"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n');
      });
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const backend = { type: "api", apiBase: `${base}/primary`, model: "primary-model", apiKey: "primary-test-key", maxTokens: 100, reasoningEffort: "max", ...(enabled ? { fallbackApiBase: `${base}/fallback`, fallbackModel: "fallback-model", fallbackApiKey: "fallback-test-key" } : {}) };
    try {
      const result = await runApiBackend("glm", backend, "same prompt", 1000);
      assert.equal(result.code === 0, succeeds);
      assert.equal(requests.length, statuses.length + (succeeds ? 1 : 0));
      if (succeeds) {
        assert.equal(requests.at(-1).path, "/fallback/chat/completions");
        assert.equal(requests.at(-1).authorization, "Bearer fallback-test-key");
        assert.equal(requests.at(-1).body.model, "fallback-model");
        assert.equal(requests.at(-1).body.reasoning_effort, "max");
        assert.deepEqual({ ...requests.at(-1).body, model: "primary-model" }, requests[0].body);
        assert.equal(result.servedBy, "127.0.0.1");
        assert.equal(result.model, "fallback-model");
        assert.match(backendReceiptLabel("glm"), /model: `fallback-model`.*served_by: `127\.0\.0\.1`/);
      } else assert.match(result.stderr, new RegExp(`HTTP ${statuses.at(-1)}`));
    } finally { await new Promise(resolve => server.close(resolve)); }
  });
});

test("fallback handles transport failures but preserves stream/output boundaries", async (t) => {
  const backend = { type: "api", apiBase: "https://primary.test/v1", model: "primary", apiKey: "test-primary", maxTokens: 100, reasoningEffort: "max", fallbackApiBase: "https://openrouter.ai/api/v1", fallbackModel: "fallback", fallbackApiKey: "test-fallback" };
  const stream = (content, reason = "stop") => new Response(`data: ${JSON.stringify({ choices: [{ delta: { content }, ...(reason ? { finish_reason: reason } : {}) }] })}\n`);
  const cases = [
    ["network TypeError", () => { throw new TypeError("connection reset"); }, true],
    ["early AbortError", () => { throw new DOMException("aborted", "AbortError"); }, true],
    ["quota response", () => new Response('{"error":{"code":1113,"message":"usage limit"}}'), true],
    ["incomplete stream", () => stream("partial", null), true],
    ["length", () => stream("partial", "length"), false],
    ["content filter", () => stream("partial", "content_filter"), false],
    ["valid output about quotas", () => stream("Document the quota and usage limit."), false],
    ["invalid output stays with validation", () => stream("Missing required FILE blocks."), false],
  ];
  for (const [name, primary, fallback] of cases) await t.test(name, async (t) => {
    const requests = [];
    t.mock.method(globalThis, "fetch", async (url, options) => { requests.push({ url, options }); return requests.length === 1 ? primary() : stream("answer"); });
    const result = await runApiBackend("glm", backend, "prompt", 1000);
    assert.equal(requests.length, fallback ? 2 : 1);
    if (fallback) {
      assert.equal(result.code, 0);
      assert.equal(result.servedBy, "openrouter.ai");
      assert.equal(JSON.parse(requests[1].options.body).reasoning_effort, "xhigh");
    }
  });
  await t.test("partial configuration disables fallback", async (t) => {
    let calls = 0;
    t.mock.method(globalThis, "fetch", async () => { calls++; return new Response("failure", { status: 503 }); });
    for (const key of ["fallbackApiBase", "fallbackModel", "fallbackApiKey"]) assert.equal((await runApiBackend("glm", { ...backend, [key]: "" }, "prompt", 1000)).code, 503);
    assert.equal(calls, 3);
  });
  await t.test("fallback 429 is never retried", async (t) => {
    let calls = 0;
    t.mock.method(globalThis, "fetch", async () => new Response("failure", { status: ++calls === 1 ? 503 : 429 }));
    assert.equal((await runApiBackend("glm", backend, "prompt", 1000)).code, 429);
    assert.equal(calls, 2);
  });
  await t.test("errors cannot echo configured keys", async (t) => {
    t.mock.method(globalThis, "fetch", async () => new Response("echo test-primary test-fallback", { status: 400 }));
    assert.doesNotMatch((await runApiBackend("glm", backend, "prompt", 1000)).stderr, /test-primary|test-fallback/);
  });
  await t.test("malformed primary URL cannot break fallback logging", async (t) => {
    let calls = 0;
    t.mock.method(globalThis, "fetch", async () => { if (++calls === 1) throw new TypeError("invalid URL"); return stream("answer"); });
    assert.equal((await runApiBackend("glm", { ...backend, apiBase: "invalid" }, "prompt", 1000)).code, 0);
    assert.equal(calls, 2);
  });
  await t.test("fallback shares the primary timeout budget", async (t) => {
    let calls = 0;
    t.mock.method(globalThis, "fetch", async (_url, options) => {
      if (++calls === 1) { await new Promise(resolve => setTimeout(resolve, 45)); return new Response("failure", { status: 503 }); }
      return new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true }));
    });
    const keepAlive = setTimeout(() => {}, 300);
    try {
      const start = Date.now();
      assert.equal((await runApiBackend("glm", backend, "prompt", 100)).timedOut, true);
      assert.equal(calls, 2);
      assert.ok(Date.now() - start < 145, "fallback must not receive a fresh timeout budget");
    } finally { clearTimeout(keepAlive); }
  });
});

test("provider metadata advertises z.ai defaults and max reasoning", () => {
  const env = { ...process.env };
  for (const key of ["DOCS_AGENT_GLM_API_BASE", "DOCS_AGENT_GLM_MODEL", "DOCS_AGENT_GLM_REASONING_EFFORT", "DOCS_AGENT_GLM_MAX_TOKENS"]) delete env[key];
  const probe = spawnSync(process.execPath, ["--input-type=module", "--eval", `const m = await import(${JSON.stringify(driverPath)}); console.log(JSON.stringify(m.getGlmProviderContract()));`], { env, encoding: "utf8" });
  assert.equal(probe.status, 0, probe.stderr);
  const contract = JSON.parse(probe.stdout);
  assert.equal(contract.defaultApiBase, "https://api.z.ai/api/coding/paas/v4");
  assert.equal(contract.defaultModel, "glm-5.3-flash");
  assert.equal(contract.defaultReasoningEffort, "high");
  assert.deepEqual([...contract.allowedReasoningEfforts], ["low", "medium", "high", "max"]);
});
