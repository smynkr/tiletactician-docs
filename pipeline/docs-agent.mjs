#!/usr/bin/env node
/**
 * docs-agent.mjs — self-hosted replacement for Mintlify's "Agent"/"Automations".
 *
 * Given a source product repo + a merged PR (or a commit range), this:
 *   1. Collects the user-facing diff (lockfiles/tests/internal-only paths
 *      excluded; oversized PR diffs fall back to per-file API patches).
 *   2. Finds the CANONICAL flat-source docs pages (<product>/**.mdx) in the
 *      docs repo most likely affected by that diff.
 *   3. Builds one prompt (diff + current page content + a strict output contract)
 *      and hands it to a pluggable LLM backend (claude | codex | gemini | glm).
 *   4. Parses the backend's output for ===FILE:...===...===END=== blocks,
 *      writes those files into the flat sources of a local docs checkout,
 *      regenerates content/docs + meta.json via run-migration.mjs, and opens
 *      a (draft, by default) PR against the docs repo's default branch via `gh`.
 *
 * Design goals baked in on purpose:
 *   - No silent empty PRs. Every failure mode below is a loud, non-zero exit
 *     with a clear reason: empty backend output, zero parseable file blocks,
 *     backend non-zero exit, backend timeout. A "no doc impact" outcome
 *     (parsed files but byte-identical to what's already on disk) is the
 *     ONE case that exits 0 without opening a PR — and it says so.
 *   - Backend is pluggable via DOCS_AGENT_BACKEND (claude | codex | gemini | glm)
 *     because CLI auth/cost tradeoffs differ per backend — see README.md.
 *   - Zero npm dependencies. Everything here is Node builtins + `git` + `gh`.
 *
 * See README.md in this directory for the full auth/cost picture (which
 * backends can run unattended in hosted CI on a flat subscription, and
 * which require a metered API key — the two are NOT the same for any of
 * the three backends, and that distinction is the whole point of this file
 * being runnable both from CI and from a developer's own machine).
 */

import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Config / constants
// ---------------------------------------------------------------------------

const PRODUCTS = ["layer", "overwatch", "locus", "routeshift", "codex", "invest"];

const DEFAULT_EXCLUDE_GLOBS = [
  "**/package-lock.json",
  "**/pnpm-lock.yaml",
  "**/yarn.lock",
  "**/Cargo.lock",
  "**/go.sum",
  "**/*.test.*",
  "**/*.spec.*",
  "**/__tests__/**",
  "**/test/**",
  "**/tests/**",
  "**/.github/**",
  "**/node_modules/**",
  "**/dist/**",
  "**/build/**",
  "**/.next/**",
  "**/*.snap",
  "**/scripts/internal/**",
];

const BACKENDS = {
  claude: {
    cmd: process.env.DOCS_AGENT_CLAUDE_CMD || "claude",
    // `claude -p` (print mode) reads the prompt from stdin when no positional
    // arg is given. Verify against `claude --help` for your installed version
    // before relying on this in CI — CLI flags drift across releases.
    args: (process.env.DOCS_AGENT_CLAUDE_ARGS || "-p --output-format text").split(" ").filter(Boolean),
    stdin: true,
  },
  codex: {
    cmd: process.env.DOCS_AGENT_CODEX_CMD || "codex",
    // `codex exec -` reads the prompt from stdin in non-interactive exec mode.
    // Verify against `codex exec --help` — flags have moved before.
    args: (process.env.DOCS_AGENT_CODEX_ARGS || "exec --full-auto -").split(" ").filter(Boolean),
    stdin: true,
  },
  gemini: {
    cmd: process.env.DOCS_AGENT_GEMINI_CMD || "gemini",
    // `gemini -p -` — non-interactive one-shot prompt mode reading stdin.
    // Verify against `gemini --help`; some released versions want `-p <text>`
    // as an inline arg instead of stdin — override via DOCS_AGENT_GEMINI_ARGS
    // (e.g. "-p"): when the override omits the "-" stdin marker, runBackend()
    // appends the prompt as a trailing arg instead of piping it.
    args: (process.env.DOCS_AGENT_GEMINI_ARGS || "-p -").split(" ").filter(Boolean),
    stdin: !process.env.DOCS_AGENT_GEMINI_ARGS ||
      process.env.DOCS_AGENT_GEMINI_ARGS.split(" ").includes("-"),
  },
  // Direct HTTP API backend — no CLI binary needed, just fetch().
  // Works with any OpenAI-compatible endpoint (Neural Watt GLM, vLLM, etc.).
  // Env: DOCS_AGENT_GLM_API_BASE (e.g. https://api.neuralwatt.com/v1),
  //      DOCS_AGENT_GLM_MODEL (e.g. glm-5.2), GLM_API_KEY (Bearer token),
  //      DOCS_AGENT_GLM_MAX_TOKENS (default 49152 — reasoning models spend
  //      their completion budget on thinking BEFORE producing content; 16384
  //      was observed burning out mid-thought with 0 content chars).
  glm: {
    type: "api",
    apiBase: (process.env.DOCS_AGENT_GLM_API_BASE || "").replace(/\/+$/, ""),
    model: process.env.DOCS_AGENT_GLM_MODEL || "glm-5.2",
    apiKey: process.env.GLM_API_KEY || "",
    maxTokens: Number(process.env.DOCS_AGENT_GLM_MAX_TOKENS || 49152),
  },
};

// 20 min: the GLM budget is 49152 tokens and a slow reasoning stream must be
// able to finish inside the window; the two knobs move together.
const DEFAULT_TIMEOUT_MS = Number(process.env.DOCS_AGENT_TIMEOUT_MS || 20 * 60 * 1000);
const MAX_DOCS_PAGES = Number(process.env.DOCS_AGENT_MAX_PAGES || 5);
// Do not consume the separator before ===END===. When file content ends with
// a newline, that newline is part of the file and must survive the parse. For
// files without a final newline, the END marker may follow the final byte
// directly; see the output contract in buildPrompt().
const FILE_BLOCK_RE = /^===FILE:\s*(.+?)\s*===\r?\n([\s\S]*?)(?=^===END===\s*$|===END===\s*$)===END===\s*$/gm;

// ---------------------------------------------------------------------------
// CLI arg parsing (no dependency — this is a small, fixed surface)
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const out = {
    repo: null,
    pr: null,
    range: null,
    docsRepo: process.env.DOCS_AGENT_DOCS_REPO || null,
    docsRepoPath: process.env.DOCS_AGENT_DOCS_PATH || "./tiletactician-docs",
    product: null,
    standalone: false,
    backend: process.env.DOCS_AGENT_BACKEND || "claude",
    draft: true,
    dryRun: false,
    maxPages: MAX_DOCS_PAGES,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    // null = auto-detect the docs repo's default branch at PR time. A
    // hardcoded "main" silently broke every draft PR against repos whose
    // default branch is "master" (git fetch origin main → exit 128).
    baseBranch: null,
    force: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case "--repo": out.repo = next(); break;
      case "--pr": out.pr = Number(next()); break;
      case "--range": out.range = next(); break;
      case "--docs-repo": out.docsRepo = next(); break;
      case "--docs-repo-path": out.docsRepoPath = next(); break;
      case "--product": out.product = next(); break;
      case "--standalone": out.standalone = true; break;
      case "--backend": out.backend = next(); break;
      case "--no-draft": out.draft = false; break;
      case "--dry-run": out.dryRun = true; break;
      case "--max-docs-pages": out.maxPages = Number(next()); break;
      case "--timeout-ms": out.timeoutMs = Number(next()); break;
      case "--base-branch": out.baseBranch = next(); break;
      case "--force": out.force = true; break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
        break;
      default:
        fail(`Unknown argument: ${a} (--help for usage)`);
    }
  }
  return out;
}

function printHelp() {
  console.log(`
docs-agent.mjs — draft docs updates for a merged PR and open a PR against the docs repo.

Required:
  --repo <owner/name>          Source product repo (e.g. smynkr/axiom-layer)
  --pr <number>                 Merged PR number in --repo
                                 (or) --range <baseSha>..<headSha>  commit range instead
  --docs-repo <owner/name>      Target docs repo (or env DOCS_AGENT_DOCS_REPO)
  --product <layer|overwatch|locus|routeshift|codex|invest>
                 Product whose pages may change (any name with --standalone)
  --standalone   Single-product docs repo: product root is the SITE root
                 (flat *.mdx at repo root, allowlist **/*.mdx + docs.json)

Optional:
  --docs-repo-path <path>       Local checkout of the docs repo (default ./tiletactician-docs,
                                 or env DOCS_AGENT_DOCS_PATH). Must already exist, be a
                                 git repo, have a remote, and be gh-authenticated.
  --backend <claude|codex|gemini|glm>  Default: env DOCS_AGENT_BACKEND, else "claude".
  --no-draft                    Open the docs PR as ready-for-review (default: draft).
  --dry-run                     Do everything except push / open the PR; print the plan.
  --max-docs-pages <n>          Max candidate docs pages fed into the prompt (default 5).
  --timeout-ms <n>              Backend invocation timeout (default 1200000 = 20 min).
  --base-branch <name>          Docs repo base branch. Default: auto-detect the
                                 docs repo's default branch (gh repo view, then
                                 the checkout's origin/HEAD), so this works for
                                 "master" and "main" repos alike.
  --force                       Reuse/force-push an existing docs-agent branch for this PR.

Env:
  DOCS_AGENT_BACKEND, DOCS_AGENT_DOCS_REPO, DOCS_AGENT_DOCS_PATH,
  DOCS_AGENT_CLAUDE_CMD / _CODEX_CMD / _GEMINI_CMD (override the CLI binary),
  DOCS_AGENT_CLAUDE_ARGS / _CODEX_ARGS / _GEMINI_ARGS (override invocation flags),
  DOCS_AGENT_TIMEOUT_MS, DOCS_AGENT_MAX_PAGES.
  Auth for whichever backend you pick is NOT this script's concern — it assumes
  the CLI on PATH is already authenticated (subscription OAuth locally, or a
  metered API key in hosted CI). See README.md.
`);
}

function fail(msg, code = 1) {
  console.error(`\n[docs-agent] ERROR: ${msg}\n`);
  process.exit(code);
}

function log(msg) {
  console.log(`[docs-agent] ${msg}`);
}

// ---------------------------------------------------------------------------
// tiny glob matcher (no dependency) — supports ** * ? in POSIX-ish paths
// ---------------------------------------------------------------------------

function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        re += ".*";
        i++;
        if (glob[i + 1] === "/") i++;
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else if (".+^${}()|[]\\".includes(c)) {
      re += `\\${c}`;
    } else {
      re += c;
    }
  }
  return new RegExp(`^${re}$`);
}

function matchesAnyGlob(filePath, globs) {
  const normalized = filePath.replace(/^\.\//, "").replace(/^\/+/, "");
  return globs.some((g) => globToRegExp(g).test(normalized));
}

// ---------------------------------------------------------------------------
// shell helpers
// ---------------------------------------------------------------------------

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { encoding: "utf8", ...opts });
  if (res.error) fail(`failed to run \`${cmd} ${args.join(" ")}\`: ${res.error.message}`);
  if (res.status !== 0 && !opts.allowFail) {
    fail(`\`${cmd} ${args.join(" ")}\` exited ${res.status}\n--- stderr ---\n${res.stderr}`);
  }
  return res;
}

function runAllowFail(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { encoding: "utf8", ...opts });
}

// ---------------------------------------------------------------------------
// Step 1: collect + filter the diff
// ---------------------------------------------------------------------------

function collectRawDiff(opts) {
  if (opts.pr != null) {
    log(`fetching PR #${opts.pr} from ${opts.repo} via gh...`);
    const meta = run("gh", [
      "pr", "view", String(opts.pr),
      "--repo", opts.repo,
      "--json", "title,body,url,mergedAt,state,files,number",
    ]);
    const prMeta = JSON.parse(meta.stdout);
    if (!prMeta.mergedAt && !opts.force) {
      fail(
        `PR #${opts.pr} in ${opts.repo} is not merged (state=${prMeta.state}). ` +
        `Pass --force to draft docs for it anyway (e.g. for a pre-merge preview).`
      );
    }
    // maxBuffer: spawnSync caps stdout at 1MB by default, and this endpoint is
    // reached precisely for large PRs — let it deliver the full diff.
    const diff = runAllowFail("gh", ["pr", "diff", String(opts.pr), "--repo", opts.repo], { maxBuffer: 64 * 1024 * 1024 });
    if (diff.status === 0) return { rawDiff: diff.stdout, prMeta, oversizedPaths: [] };
    // GitHub refuses to serve diffs over ~20k lines (HTTP 406 "too_large").
    // That killed whole runs on large PRs; fall back to the per-file patches
    // endpoint instead, which serves each file's patch individually (and
    // simply omits `patch` for files too large even for that).
    if (/too_large|406/i.test(diff.stderr || "")) {
      log(`gh pr diff refused the full diff (too large); falling back to per-file API patches...`);
      const { rawDiff, oversizedPaths } = collectDiffFromApi(opts.repo, opts.pr);
      return { rawDiff, prMeta, oversizedPaths };
    }
    fail(`\`gh pr diff ${opts.pr} --repo ${opts.repo}\` exited ${diff.status}\n--- stderr ---\n${diff.stderr}`);
  }
  if (opts.range) {
    log(`collecting local git diff for range ${opts.range}...`);
    const diff = run("git", ["diff", opts.range]);
    return {
      rawDiff: diff.stdout,
      prMeta: { title: `Range ${opts.range}`, body: "", url: null, number: null },
      oversizedPaths: [],
    };
  }
  fail("one of --pr or --range is required");
}

/** Rebuild a unified diff from the pulls/N/files API (per-file `patch` fields). */
function collectDiffFromApi(repo, pr) {
  // Fetch page by page and parse each response on its own. Textually merging
  // paginated arrays (a `][` → `,` replace) would corrupt patch content that
  // itself contains `][` — nested array indexing is common in product code.
  const PAGE_SIZE = 100; // GitHub's max for this endpoint
  const MAX_PAGES = 30;  // …and its cap of 3000 files per PR
  const files = [];
  // One confirmation page past the cap: a PR with exactly 3000 files completes
  // at page 31 (empty), so only a FULL page 31 proves there is more.
  for (let page = 1; page <= MAX_PAGES + 1; page++) {
    const res = run(
      "gh",
      ["api", `repos/${repo}/pulls/${pr}/files?per_page=${PAGE_SIZE}&page=${page}`],
      { maxBuffer: 64 * 1024 * 1024 },
    );
    let pageFiles;
    try {
      pageFiles = JSON.parse(res.stdout);
    } catch {
      fail(`could not parse files response (page ${page}) for ${repo} PR #${pr}`);
    }
    if (!Array.isArray(pageFiles)) {
      fail(`unexpected files response (page ${page}) for ${repo} PR #${pr}`);
    }
    files.push(...pageFiles);
    if (pageFiles.length < PAGE_SIZE) break;
    if (page > MAX_PAGES) {
      fail(`PR #${pr} in ${repo} lists more than ${MAX_PAGES * PAGE_SIZE} changed files; refusing to draft from a partial diff.`);
    }
  }
  const blocks = [];
  const oversizedPaths = [];
  for (const f of files) {
    // A newline in a filename would break the synthesized diff headers below
    // (git C-quotes such paths; the API returns them raw). Disclose, don't guess.
    if (!f?.filename || f.filename.includes("\n")) {
      oversizedPaths.push(f?.filename || "(unparseable filename)");
      continue;
    }
    if (typeof f.patch !== "string" || f.patch.length === 0) {
      // Binary, renamed-without-content, or too large even for the per-file
      // endpoint. Keep it visible so the model knows the diff is incomplete.
      oversizedPaths.push(f.filename);
      continue;
    }
    // Synthesize just enough of the real `git diff` header structure for
    // splitDiffByFile and the model: mode lines for adds/removes, rename
    // provenance from previous_filename.
    let header = `diff --git a/${f.filename} b/${f.filename}\n`;
    if (f.status === "added") {
      header += `new file mode 100644\n--- /dev/null\n+++ b/${f.filename}\n`;
    } else if (f.status === "removed") {
      header += `deleted file mode 100644\n--- a/${f.filename}\n+++ /dev/null\n`;
    } else {
      if (f.status === "renamed" && f.previous_filename) {
        header += `rename from ${f.previous_filename}\nrename to ${f.filename}\n`;
      }
      header += `--- a/${f.filename}\n+++ b/${f.filename}\n`;
    }
    blocks.push(header + f.patch);
  }
  if (oversizedPaths.length) {
    log(`${oversizedPaths.length} file(s) had no usable per-file patch (too large/binary/unparseable name): ${oversizedPaths.join(", ")}`);
  }
  return { rawDiff: blocks.join("\n"), oversizedPaths };
}

/** Split a unified diff into per-file blocks: [{ path, block }] */
function splitDiffByFile(rawDiff) {
  const lines = rawDiff.split("\n");
  const blocks = [];
  let current = null;
  for (const line of lines) {
    const m = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (m) {
      if (current) blocks.push(current);
      current = { path: m[2], lines: [line] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) blocks.push(current);
  return blocks.map((b) => ({ path: b.path, block: b.lines.join("\n") }));
}

function filterUserFacingDiff(rawDiff, extraExcludes = []) {
  const excludes = [...DEFAULT_EXCLUDE_GLOBS, ...extraExcludes];
  const files = splitDiffByFile(rawDiff);
  const kept = files.filter((f) => !matchesAnyGlob(f.path, excludes));
  const dropped = files.filter((f) => matchesAnyGlob(f.path, excludes));
  return {
    filteredDiff: kept.map((f) => f.block).join("\n"),
    keptPaths: kept.map((f) => f.path),
    droppedPaths: dropped.map((f) => f.path),
  };
}

// ---------------------------------------------------------------------------
// Step 2: find candidate docs pages
// ---------------------------------------------------------------------------

function extractKeywords(diffText, changedPaths) {
  const keywords = new Set();
  for (const p of changedPaths) {
    const base = path.basename(p).replace(/\.[^.]+$/, "");
    for (const word of splitIdentifier(base)) {
      if (word.length > 2) keywords.add(word.toLowerCase());
    }
  }
  const routeRe = /\/api\/[a-zA-Z0-9/_-]+/g;
  for (const m of diffText.matchAll(routeRe)) keywords.add(m[0].toLowerCase());
  const symbolRe = /^\+\s*(?:export\s+)?(?:function|class|const|interface|type)\s+([A-Za-z0-9_]+)/gm;
  for (const m of diffText.matchAll(symbolRe)) {
    for (const word of splitIdentifier(m[1])) {
      if (word.length > 2) keywords.add(word.toLowerCase());
    }
  }
  const envRe = /\b([A-Z][A-Z0-9_]{4,})\b/g;
  for (const m of diffText.matchAll(envRe)) keywords.add(m[1].toLowerCase());
  return [...keywords];
}

function splitIdentifier(s) {
  return s
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[-_\s]+/)
    .filter(Boolean);
}

function walkMdx(dir, { excludeDirs } = {}) {
  const results = [];
  if (!existsSync(dir)) return results;
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (excludeDirs && excludeDirs.has(entry)) continue;
      results.push(...walkMdx(full, { excludeDirs }));
    }
    else if (entry.endsWith(".mdx")) results.push(full);
  }
  return results;
}

// Directories that are structural or generated in a standalone docs repo.
// The canonical authoring surface is the flat *.mdx at the repo root; these
// are never candidates and never writable by the backend.
const STANDALONE_EXCLUDE_DIRS = new Set([
  '.agents', '.codex', '.git', '.github', '.omo', '.playwright-mcp',
  '_migration', 'app', 'components', 'content', 'docs', 'lib', 'node_modules',
  'pipeline', 'public', 'scripts',
]);

function findCandidateDocsPages(docsRepoPath, product, keywords, maxPages, standalone) {
  // The CANONICAL authoring surface is the flat <product>/ source tree at the
  // repo root (or the site root itself with --standalone). content/docs/ is
  // generated output (run-migration.mjs rebuilds it and would silently revert
  // any draft written there), so docs-agent reads and writes the flat sources
  // and regenerates on the way out.
  // With --standalone the site root IS the product root: flat *.mdx at the
  // repo root, generated/structural directories excluded from candidates.
  const productDir = standalone ? docsRepoPath : path.join(docsRepoPath, product);
  const pages = walkMdx(productDir, { excludeDirs: standalone ? STANDALONE_EXCLUDE_DIRS : null });
  const scored = pages.map((p) => {
    const content = readFileSync(p, "utf8").toLowerCase();
    let score = 0;
    for (const kw of keywords) {
      if (kw.length < 3) continue;
      if (content.includes(kw)) score += 1;
    }
    return { path: p, score };
  });
  scored.sort((a, b) => b.score - a.score);
  const hits = scored.filter((s) => s.score > 0).slice(0, maxPages);
  if (hits.length > 0) return hits.map((h) => h.path);
  // No keyword hits at all — fall back to the product's index/landing page
  // so the model has *something* concrete to anchor to, and say so in the
  // prompt so it knows this is a low-confidence fallback, not a real match.
  const fallback = pages.find((p) => /(^|\/)(index|introduction|overview)\.mdx$/i.test(p));
  return fallback ? [fallback] : pages.slice(0, 1);
}

// ---------------------------------------------------------------------------
// Step 3: build the prompt
// ---------------------------------------------------------------------------

function buildPrompt({ prMeta, filteredDiff, droppedPaths, oversizedPaths, candidatePages, docsRepoPath, standalone }) {
  const pagesSection = candidatePages
    .map((p) => {
      const rel = path.relative(docsRepoPath, p);
      const content = readFileSync(p, "utf8");
      return `--- CURRENT CONTENT OF ${rel} ---\n${content}\n--- END ${rel} ---`;
    })
    .join("\n\n");

  // Standalone docs repos (docs.<product>.com) author flat MDX at the site
  // root; the multi-product Axiom docs site nests one directory per product.
  const siteName = standalone ? "TileTactician" : "Axiom";
  const sourceShape = standalone
    ? "authored as flat Mintlify-flavored MDX source files at the docs-repo root (the site root)"
    : "authored as flat Mintlify-flavored MDX source files at the docs-repo root (one directory per product)";
  const examplePath = standalone ? "getting-started.mdx" : "layer/integrations/aws.mdx";
  const canonicalRule = standalone
    ? "paths like `<page>.mdx` at the repo root. NEVER emit paths under `content/docs/`"
    : "paths like `<product>/page.mdx` or `<product>/section/page.mdx` at the repo root. NEVER emit paths under `content/docs/`";

  return `You are drafting a documentation update for the ${siteName} docs site — a Fumadocs
site ${sourceShape}. Treat MDX syntax as portable prose + the small
component set already used in these pages: Note, Tip, Warning, Card, Accordion,
AccordionGroup, Steps, Step, Columns, CodeGroup, Update.

A pull request was merged in a product repo. Your job: read the diff, read the
CURRENT content of the docs page(s) most likely affected, and decide whether
they need updating. Most PRs need NO doc change — say so explicitly if that's
your conclusion, and do not emit any FILE blocks in that case.

## Source PR
Title: ${prMeta.title || "(range diff, no PR title)"}
URL: ${prMeta.url || "(none — local range diff)"}
Body:
${prMeta.body || "(none)"}

## User-facing diff (lockfiles, tests, and internal-only paths already excluded)
${filteredDiff || "(empty after filtering — the diff was entirely lockfiles/tests/internal paths)"}

${droppedPaths.length ? `## Excluded as non-user-facing (for your awareness, not included above)\n${droppedPaths.join("\n")}\n` : ""}
${oversizedPaths && oversizedPaths.length ? `## Diff incomplete — these changed files were too large for the GitHub API to serve patches (judge from the PR title/body where relevant)\n${oversizedPaths.join("\n")}\n` : ""}

## Candidate docs pages (best-guess by keyword match against the diff — verify relevance yourself, they may be wrong)
${pagesSection || "(no candidate pages found under this product's source directory)"}

## Output contract — follow this EXACTLY, nothing else in your response
For each file you want to create or update, emit exactly one block:

===FILE: <path relative to the docs repo root, e.g. ${examplePath}>===
<the FULL new file content, complete MDX including frontmatter>
===END===

Rules:
- Edit the CANONICAL FLAT SOURCES only: ${canonicalRule}
  — that tree is generated output and is rebuilt from the
  flat sources by the pipeline after your files are written.
- The only non-MDX file you may emit is \`docs.json\` (the navigation source of
  truth), and only when you ADD a brand-new page: add the new page's path to
  the matching product's groups entry, preserving the existing JSON structure
  and every other entry.
- Emit the COMPLETE file content, not a diff/patch — this script overwrites the
  file wholesale with what you emit between the markers.
- Put \`===END===\` immediately after the final byte of each file. It will be
  on its own line when the file ends with a newline; for a file with no final
  newline, attach the marker directly to its final byte. This preserves exact
  file bytes in both cases.
- Preserve existing frontmatter fields (title, description, tag, mode) unless
  the change genuinely requires editing one of them.
- Only emit a FILE block for a page you are actually changing. If nothing in
  the candidate pages needs updating, emit NO FILE blocks and instead output a
  line containing exactly \`===NO-DOC-CHANGE===\` followed by a one-paragraph
  plain-text explanation of why no doc change is needed. Without that exact
  marker, zero FILE blocks is treated as a malformed response.
- Do not wrap FILE blocks in markdown code fences.
- Do not invent new pages outside the candidate list unless the diff clearly
  introduces a wholly new feature with no existing page — if you do, briefly
  justify it in one sentence before the FILE block and remember the docs.json
  navigation entry it then requires.`;
}

// ---------------------------------------------------------------------------
// Step 4: invoke the backend, with real babysitting
// ---------------------------------------------------------------------------

/**
 * Parse an OpenAI-compatible SSE payload into accumulated content. Tolerates
 * CRLF, provider comment lines (": cost {...}"), keep-alives, malformed event
 * lines, and a final event with no trailing newline. Exported for tests.
 */
export function parseSSEPayload(text) {
  let content = "";
  let reasoningChars = 0;
  let finishReason = null;
  let sawDone = false;
  for (const rawLine of text.split("\n")) {
    const line = rawLine.replace(/\r$/, "").trim();
    // SSE data lines only; everything else (comments, blank keep-alives,
    // event:/id: fields) is not a JSON chat event.
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (payload === "[DONE]") {
      sawDone = true;
      continue;
    }
    let evt;
    try {
      evt = JSON.parse(payload);
    } catch {
      continue; // tolerate a malformed/split event line, keep parsing
    }
    const choice = evt?.choices?.[0];
    if (choice?.delta?.content) content += choice.delta.content;
    // Reasoning arrives as `reasoning` (Neural Watt/GLM) or
    // `reasoning_content` (Zhipu/DeepSeek-style OpenAI-compatible APIs).
    const reasoning = choice?.delta?.reasoning ?? choice?.delta?.reasoning_content;
    if (reasoning) reasoningChars += String(reasoning).length;
    if (choice?.finish_reason) finishReason = choice.finish_reason;
  }
  return { content, reasoningChars, finishReason, sawDone };
}

function runBackend(backendName, prompt, timeoutMs) {
  const backend = BACKENDS[backendName];
  if (!backend) fail(`unknown backend "${backendName}" (must be one of: ${Object.keys(BACKENDS).join(", ")})`);

  // --- Direct HTTP API backend (no CLI binary) ---
  if (backend.type === "api") {
    if (!backend.apiBase) fail(`backend "${backendName}" requires DOCS_AGENT_GLM_API_BASE (e.g. https://api.neuralwatt.com/v1)`);
    if (!backend.apiKey) fail(`backend "${backendName}" requires GLM_API_KEY env var (metered API key)`);
    log(`invoking API backend "${backendName}" (${backend.apiBase}, model=${backend.model}, max_tokens=${backend.maxTokens}, streaming), timeout=${timeoutMs}ms...`);
    return (async () => {
      try {
        // stream:true is load-bearing for this aggregator: non-streaming
        // requests at review/pipeline prompt sizes were observed returning
        // 524 gateway timeouts where the identical streaming request
        // completed. Reasoning models (GLM 5.2, etc.) stream chain-of-thought
        // in delta.reasoning and the actual answer in delta.content; the
        // completion budget must cover BOTH, hence the large max_tokens.
        const res = await fetch(`${backend.apiBase}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${backend.apiKey}`,
          },
          body: JSON.stringify({
            model: backend.model,
            messages: [{ role: "user", content: prompt }],
            temperature: 0.2,
            max_tokens: backend.maxTokens,
            stream: true,
          }),
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) {
          const body = await res.text().catch(() => "(unreadable)");
          return { code: res.status, signal: null, stdout: "", stderr: `HTTP ${res.status}: ${body.slice(-4000)}`, timedOut: false };
        }
        if (!res.body) {
          return { code: -1, signal: null, stdout: "", stderr: "HTTP 200 but an empty response body — the endpoint may not support streaming.", timedOut: false };
        }

        // Accumulate the whole stream, then parse. Review-sized streams are a
        // few MB at most, and full-text parsing cannot drop a final event that
        // arrives without a trailing newline.
        let sseText = "";
        const decoder = new TextDecoder();
        const reader = res.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          sseText += decoder.decode(value, { stream: true });
        }
        sseText += decoder.decode(); // flush a multi-byte char split at stream end

        const { content, reasoningChars, finishReason, sawDone } = parseSSEPayload(sseText);

        // A stream that ends without a finish_reason AND without [DONE] died
        // mid-generation (gateway drop, aggregator hang-up — documented
        // history on this endpoint). Its content is truncated by definition;
        // never ship it.
        if (finishReason === null && !sawDone) {
          return {
            code: -1, signal: null, stdout: "",
            stderr: "stream ended without finish_reason or [DONE] — the provider closed early, so the response is truncated. Retry the run; if this persists, check the aggregator.",
            timedOut: false,
          };
        }

        // A truncated stream is never trustworthy: an earlier FILE block could
        // be "complete" while the final one is cut off, which would open a
        // silently-incomplete PR. Fail the whole run instead.
        if (finishReason === "length") {
          return {
            code: -1, signal: null, stdout: "",
            stderr: `stream ended with finish_reason=length — the response is truncated (max_tokens=${backend.maxTokens}). Truncated output is never committed; raise DOCS_AGENT_GLM_MAX_TOKENS or simplify the prompt.`,
            timedOut: false,
          };
        }
        if (!content && reasoningChars > 0) {
          return {
            code: -1, signal: null, stdout: "",
            stderr: `Model produced ${reasoningChars} chars of reasoning but no content (token budget exhausted during thinking). Raise DOCS_AGENT_GLM_MAX_TOKENS (current ${backend.maxTokens}) or simplify the prompt.`,
            timedOut: false,
          };
        }
        return { code: 0, signal: null, stdout: content, stderr: "", timedOut: false };
      } catch (err) {
        const timedOut = err.name === "TimeoutError" || err.name === "AbortError";
        return { code: -1, signal: null, stdout: "", stderr: `fetch error: ${err.message}`, timedOut };
      }
    })();
  }

  // --- CLI backend (spawn a subprocess) ---
  const check = runAllowFail(backend.cmd, ["--version"]);
  if (check.error) {
    fail(
      `backend CLI "${backend.cmd}" was not found on PATH (${check.error.message}). ` +
      `Install/auth it, or point DOCS_AGENT_${backendName.toUpperCase()}_CMD at the right binary.`
    );
  }

  log(`invoking backend "${backendName}" (${backend.cmd} ${backend.args.join(" ")}), timeout=${timeoutMs}ms...`);

  return new Promise((resolve) => {
    // Backends with stdin=false receive the prompt as a trailing argument.
    const spawnArgs = backend.stdin ? backend.args : [...backend.args, prompt];
    const child = spawn(backend.cmd, spawnArgs, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let exited = false;
    let escalateTimer = null;

    const killTimer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      // child.killed only means "signal sent", so it is true immediately after
      // the SIGTERM above — track actual exit to decide on escalation.
      escalateTimer = setTimeout(() => {
        if (!exited) child.kill("SIGKILL");
      }, 15_000);
    }, timeoutMs);

    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));

    child.on("close", (code, signal) => {
      exited = true;
      clearTimeout(killTimer);
      if (escalateTimer) clearTimeout(escalateTimer);
      resolve({ code, signal, stdout, stderr, timedOut });
    });

    child.on("error", (err) => {
      exited = true;
      clearTimeout(killTimer);
      if (escalateTimer) clearTimeout(escalateTimer);
      resolve({ code: -1, signal: null, stdout, stderr: `${stderr}\nspawn error: ${err.message}`, timedOut });
    });

    if (backend.stdin) {
      child.stdin.write(prompt);
      child.stdin.end();
    } else {
      // Prompt was passed as a trailing arg — close stdin so the backend
      // never blocks waiting for piped input.
      child.stdin.end();
    }
  });
}

async function invokeBackendWithBabysitting(backendName, prompt, timeoutMs) {
  const result = await runBackend(backendName, prompt, timeoutMs);

  if (result.timedOut) {
    fail(
      `backend "${backendName}" timed out after ${timeoutMs}ms and was killed. ` +
      `This is a stall, not a "no doc change" outcome — do not treat it as one. ` +
      `Raise --timeout-ms, check the backend's own health, or retry.`
    );
  }
  if (result.code !== 0) {
    fail(
      `backend "${backendName}" exited ${result.code}${result.signal ? ` (signal ${result.signal})` : ""}.\n` +
      `--- stderr (last 4000 chars) ---\n${result.stderr.slice(-4000)}\n` +
      `--- stdout (last 2000 chars) ---\n${result.stdout.slice(-2000)}`
    );
  }
  if (!result.stdout || result.stdout.trim().length === 0) {
    fail(
      `backend "${backendName}" exited 0 but produced EMPTY stdout. Treating this as a ` +
      `failure, not a legitimate "no changes needed" outcome — a real no-op response still ` +
      `contains the model's explanatory paragraph. Check stderr:\n${result.stderr.slice(-2000)}`
    );
  }
  return result.stdout;
}

// ---------------------------------------------------------------------------
// Step 5: parse the output contract
// ---------------------------------------------------------------------------

function parseFileBlocks(output, product, standalone) {
  const blocks = [];
  let m;
  FILE_BLOCK_RE.lastIndex = 0;
  while ((m = FILE_BLOCK_RE.exec(output)) !== null) {
    let relPath = m[1].trim().replace(/\\/g, "/");
    // Model output is untrusted: refuse absolute paths and traversal outright.
    if (path.isAbsolute(relPath) || relPath.split("/").includes("..")) {
      fail(`Backend emitted a disallowed file path: ${relPath} (absolute paths and ".." are rejected)`);
    }
    // Legacy compatibility: older prompts targeted the generated tree. Remap
    // content/docs/<...>/... back onto the canonical flat source so a model
    // still emitting generated paths produces a durable edit instead of a
    // write that the next regeneration would revert. In the multi-product
    // repo the generated path keeps its product segment
    // (content/docs/<product>/page.mdx -> <product>/page.mdx); in a standalone
    // repo the generated path drops the tree prefix entirely
    // (content/docs/page.mdx -> page.mdx).
    if (relPath.startsWith("content/docs/")) {
      const rest = relPath.slice("content/docs/".length);
      const remappable = standalone
        ? rest.endsWith(".mdx")
        : rest.startsWith(`${product}/`) && rest.endsWith(".mdx");
      if (remappable) {
        log(`remapping generated path "${relPath}" to canonical flat source "${rest}"`);
        relPath = rest;
      } else {
        fail(
          `Backend emitted a disallowed file path in the generated tree that cannot be remapped ` +
          `to this product's canonical sources: ${relPath} (allowed: ${standalone ? "**/*.mdx" : `${product}/**/*.mdx`} and docs.json)`
        );
      }
    }
    // Allowlist: this product's flat MDX sources (the site root itself with
    // --standalone), plus docs.json (navigation) when a new page requires an
    // entry. Everything else — generated trees, app code, configs — is
    // rejected fail-closed.
    const isOwnProductMdx = standalone
      ? relPath.endsWith(".mdx") && !STANDALONE_EXCLUDE_DIRS.has(relPath.split("/")[0])
      : relPath.startsWith(`${product}/`) && relPath.endsWith(".mdx");
    const isDocsJson = relPath === "docs.json";
    if (!isOwnProductMdx && !isDocsJson) {
      fail(
        `Backend emitted a disallowed file path: ${relPath} ` +
        `(allowed: ${standalone ? "**/*.mdx at the repo root" : `${product}/**/*.mdx`} and docs.json — the canonical flat sources)`
      );
    }
    blocks.push({ relPath, content: m[2] });
  }
  return blocks;
}

// ---------------------------------------------------------------------------
// Step 5b: docs.json is global — bound the blast radius structurally
// ---------------------------------------------------------------------------

/**
 * Recursively collect every page string under `pages` arrays. The live
 * docs.json schema nests them as products[i].tabs[j].groups[k].pages[] —
 * `tabs`, `groups`, and `pages` must ALL be descended, or the deletion gate
 * silently sees zero pages.
 */
function collectPageStrings(node, acc = []) {
  if (typeof node === "string") {
    acc.push(node);
  } else if (Array.isArray(node)) {
    for (const item of node) collectPageStrings(item, acc);
  } else if (node && typeof node === "object") {
    if ("pages" in node) collectPageStrings(node.pages, acc);
    if (Array.isArray(node.groups)) {
      for (const group of node.groups) collectPageStrings(group, acc);
    }
    if (Array.isArray(node.tabs)) {
      for (const tab of node.tabs) collectPageStrings(tab, acc);
    }
  }
  return acc;
}

/** Key-order-insensitive canonical serialization (arrays keep their order). */
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * The model may only ADD navigation for its own product. Deleting pages,
 * touching another product's entry, or changing the product list fails
 * closed — a "docs: sync layer" run must never be able to delete Overwatch
 * navigation just because docs.json is a global file.
 */
function assertDocsJsonAdditive(docsRepoPath, product, emittedText) {
  const committedPath = path.join(docsRepoPath, "docs.json");
  if (!existsSync(committedPath)) return; // nothing to compare against
  let committed;
  try {
    committed = JSON.parse(readFileSync(committedPath, "utf8"));
  } catch (err) {
    // Fail CLOSED: with an unparseable baseline the structural gate cannot
    // run, and skipping it would let the model rewrite navigation freely.
    fail(`committed docs.json is not parseable (${err.message}); cannot verify an additive rewrite against a broken baseline.`);
  }
  const committedProducts = committed?.navigation?.products;
  const emitted = JSON.parse(emittedText);
  const emittedProducts = emitted?.navigation?.products;
  if (!Array.isArray(emittedProducts)) {
    fail("emitted docs.json has no navigation.products array — refusing a nav-destroying rewrite.");
  }
  if (!Array.isArray(committedProducts)) return;

  if (emittedProducts.length !== committedProducts.length) {
    fail(
      `emitted docs.json changes the product count (${committedProducts.length} -> ${emittedProducts.length}). ` +
      `docs-agent may only add pages to "${product}".`
    );
  }
  // docs.json product names are capitalized ("Layer", "RouteShift", …) while
  // --product is lowercase — compare case-insensitively or the running
  // product gets policed as "another product" and every legitimate addition
  // fails.
  const isRunningProduct = (entry) => String(entry?.product || "").toLowerCase() === product;
  for (let i = 0; i < committedProducts.length; i++) {
    const was = committedProducts[i];
    const now = emittedProducts[i];
    if (String(was?.product || "").toLowerCase() !== String(now?.product || "").toLowerCase()) {
      fail(
        `emitted docs.json reorders or renames products (position ${i}: "${was?.product}" -> "${now?.product}"). ` +
        `docs-agent may only add pages to "${product}".`
      );
    }
    if (!isRunningProduct(was)) {
      // Canonical (key-order-insensitive) equality: a benign reserialization
      // of an untouched entry must not fail the run, but any real change must.
      if (canonicalJson(was) !== canonicalJson(now)) {
        fail(
          `emitted docs.json modifies the "${was?.product}" navigation entry. ` +
          `docs-agent may only add pages to "${product}".`
        );
      }
      continue;
    }
    // The running product: every committed page must survive (additions allowed).
    const before = new Set(collectPageStrings(was));
    const after = new Set(collectPageStrings(now));
    const removed = [...before].filter((p) => !after.has(p));
    if (removed.length > 0) {
      fail(
        `emitted docs.json removes ${removed.length} existing "${product}" navigation page(s): ${removed.join(", ")}. ` +
        `docs-agent may only ADD navigation entries.`
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Step 6+7: write files, git branch/commit/push, open PR
// ---------------------------------------------------------------------------

function applyChangesAndOpenPR(opts, { fileBlocks, prMeta, backendName, droppedPaths, keptPaths, oversizedPaths, rawOutput }) {
  const changed = [];
  const unchanged = [];

  for (const fb of fileBlocks) {
    const abs = path.join(opts.docsRepoPath, fb.relPath);
    const existing = existsSync(abs) ? readFileSync(abs, "utf8") : null;
    if (existing === fb.content) {
      unchanged.push(fb.relPath);
    } else {
      changed.push({ ...fb, abs });
    }
  }

  if (changed.length === 0) {
    log(
      `backend "${backendName}" returned ${fileBlocks.length} file block(s), but all were ` +
      `byte-identical to what's already on disk (or zero blocks were returned at all — the ` +
      `model judged no doc update was needed). No-op. NOT opening a PR. Exiting 0.`
    );
    if (fileBlocks.length === 0) {
      log(`model's explanation:\n${rawOutput.trim().slice(0, 2000)}`);
    }
    return { opened: false };
  }

  log(`${changed.length} file(s) to write: ${changed.map((c) => c.relPath).join(", ")}`);

  if (opts.dryRun) {
    log("--dry-run set: not writing files, not touching git, not opening a PR.");
    for (const c of changed) {
      log(`--- would write ${c.relPath} (${c.content.length} bytes) ---`);
    }
    return { opened: false, dryRun: true };
  }

  const prNumLabel = prMeta.number != null ? `pr-${prMeta.number}` : `range-${Date.now()}`;
  const branchName = `docs-agent/${opts.product}-${prNumLabel}`;

  assertGitRepo(opts.docsRepoPath);
  const baseBranch = resolveBaseBranch(opts);
  run("git", ["-C", opts.docsRepoPath, "fetch", "origin", baseBranch]);

  const existingPr = runAllowFail("gh", [
    "pr", "list", "--repo", opts.docsRepo, "--head", branchName, "--state", "open", "--json", "number,url",
  ]);
  let existingPrJson = [];
  try {
    existingPrJson = JSON.parse(existingPr.stdout || "[]");
  } catch {
    /* ignore parse failure, treat as no existing PR */
  }
  if (existingPrJson.length > 0 && !opts.force) {
    fail(
      `an open docs PR already exists for branch ${branchName}: ${existingPrJson[0].url}. ` +
      `Pass --force to update it instead of failing.`
    );
  }

  run("git", ["-C", opts.docsRepoPath, "checkout", "-B", branchName, `origin/${baseBranch}`]);

  // Re-check after checkout: `checkout -B` carries pre-existing edits and
  // untracked leftovers across, and this run must commit only its own work —
  // never an operator's in-progress pages or a previous failed run's residue.
  // (main() already ran this guard before the backend call; this is the
  // authoritative check at commit time.)
  assertCleanCheckout(opts.docsRepoPath);

  // If the model rewrote docs.json (new page navigation), it must be valid
  // JSON and strictly additive for this product — the migration and the site
  // both parse it, and it is the navigation source of truth for ALL six
  // products. Validate BEFORE writing anything so a bad response leaves no
  // dirty tree behind.
  const docsJsonBlock = changed.find((c) => c.relPath === "docs.json");
  if (docsJsonBlock) {
    try {
      JSON.parse(docsJsonBlock.content);
    } catch (err) {
      fail(`backend emitted a docs.json that is not valid JSON: ${err.message}`);
    }
    assertDocsJsonAdditive(opts.docsRepoPath, opts.product, docsJsonBlock.content);
  }

  for (const dir of new Set(changed.map((c) => path.dirname(c.abs)))) {
    mkdirSync(dir, { recursive: true });
  }
  for (const c of changed) {
    writeFileSync(c.abs, c.content, "utf8");
  }

  // Rebuild the generated tree from the canonical sources so this PR keeps
  // flat sources and content/docs in sync (the LAY-721 drift class).
  const regenerated = regenerateGeneratedOutput(opts.docsRepoPath);

  // Stage exactly this run's contract surface: the canonical edits plus, when
  // regeneration ran, the trees it owns. Deliberately NOT `git add -A` — a
  // long-lived local checkout may carry unrelated untracked files, and those
  // must never ride along into a docs PR.
  const pathspecs = [...changed.map((c) => c.relPath)];
  if (regenerated) {
    for (const generated of ["content/docs", path.join("_migration", "reports")]) {
      if (existsSync(path.join(opts.docsRepoPath, generated))) pathspecs.push(generated);
    }
  }
  run("git", ["-C", opts.docsRepoPath, "add", "--", ...pathspecs]);

  const diffCheck = runAllowFail("git", ["-C", opts.docsRepoPath, "diff", "--cached", "--quiet"]);
  if (diffCheck.status === 0) {
    log("staged diff is empty after `git add` (should not happen given the pre-check above). No-op, not opening a PR.");
    return { opened: false };
  }

  const commitMsg =
    `docs: sync ${opts.product} docs for ${opts.repo}${prMeta.number != null ? ` PR #${prMeta.number}` : ""}\n\n` +
    `Drafted by docs-agent (${backendName} backend). Source: ${prMeta.url || opts.range}\n` +
    `Human review required before merge.`;
  run("git", ["-C", opts.docsRepoPath, "commit", "-m", commitMsg]);

  const pushArgs = ["-C", opts.docsRepoPath, "push", "-u", "origin", branchName];
  if (opts.force) pushArgs.push("--force");
  run("git", pushArgs);

  if (existingPrJson.length > 0) {
    log(`branch pushed; existing PR updated: ${existingPrJson[0].url}`);
    return { opened: true, url: existingPrJson[0].url, updated: true };
  }

  const bodyLines = [
    `Drafted automatically by \`docs-agent.mjs\` (backend: **${backendName}**).`,
    "",
    `Source PR: ${prMeta.url || `local range ${opts.range}`}`,
    prMeta.title ? `Source title: ${prMeta.title}` : "",
    "",
    "**Files changed:**",
    ...changed.map((c) => `- \`${c.relPath}\``),
    "",
    "**This is LLM-drafted content. A human must review it for accuracy before merging** —",
    "verify against the actual code change, not just against the diff summary the model saw.",
    "",
    keptPaths.length ? `<details><summary>Source diff paths considered (${keptPaths.length})</summary>\n\n${keptPaths.map((p) => `- ${p}`).join("\n")}\n\n</details>` : "",
    droppedPaths.length ? `<details><summary>Excluded as non-user-facing (${droppedPaths.length})</summary>\n\n${droppedPaths.map((p) => `- ${p}`).join("\n")}\n\n</details>` : "",
    oversizedPaths.length
      ? `**Diff incomplete:** ${oversizedPaths.length} changed file(s) had no usable patch (too large/binary for the GitHub API) — ` +
        `this draft may miss their impact. Review against the source PR, not just this diff.\n`
      : "",
  ].filter(Boolean);

  const tmpBody = path.join(mkdtempSync(path.join(tmpdir(), "docs-agent-")), "pr-body.md");
  writeFileSync(tmpBody, bodyLines.join("\n"), "utf8");

  const createArgs = [
    "pr", "create",
    "--repo", opts.docsRepo,
    "--base", baseBranch,
    "--head", branchName,
    "--title", `docs: sync ${opts.product} docs for ${prMeta.title || opts.range || `PR #${prMeta.number}`}`,
    "--body-file", tmpBody,
  ];
  if (opts.draft) createArgs.push("--draft");

  const created = run("gh", createArgs);
  const url = created.stdout.trim();
  log(`opened docs PR: ${url}`);
  return { opened: true, url };
}

function assertGitRepo(p) {
  if (!existsSync(p)) {
    fail(`--docs-repo-path "${p}" does not exist. Clone the docs repo there first (e.g. \`gh repo clone <docs-repo> ${p}\`).`);
  }
  const check = runAllowFail("git", ["-C", p, "rev-parse", "--is-inside-work-tree"]);
  if (check.status !== 0) fail(`--docs-repo-path "${p}" is not a git repository.`);
}

/**
 * Resolve the docs repo's base branch. Explicit --base-branch wins; otherwise
 * ask GitHub for the default branch, then fall back to the checkout's
 * origin/HEAD (a local-clone convenience — actions/checkout does not set
 * origin/HEAD, so in CI the gh lookup is the path that fires). Deliberately
 * lazy (called at PR time, after the backend): by then `gh` has already
 * proven itself on this run's PR fetch, so a failure here is real, and
 * resolving earlier would add no safety. Fail-closed rather than guessing:
 * a wrong guess here is the exact bug that silently killed every draft PR
 * on a "master" repo.
 */
function resolveBaseBranch(opts) {
  if (opts.baseBranch) return opts.baseBranch;

  const viaGh = runAllowFail("gh", [
    "repo", "view", opts.docsRepo, "--json", "defaultBranchRef",
  ]);
  if (viaGh.status === 0) {
    try {
      const name = JSON.parse(viaGh.stdout)?.defaultBranchRef?.name;
      if (name) {
        log(`resolved docs-repo default branch via gh: ${name}`);
        return name;
      }
    } catch {
      /* fall through to origin/HEAD */
    }
  }

  const viaOriginHead = runAllowFail("git", [
    "-C", opts.docsRepoPath, "symbolic-ref", "--short", "refs/remotes/origin/HEAD",
  ]);
  if (viaOriginHead.status === 0) {
    const ref = viaOriginHead.stdout.trim();
    const name = ref.replace(/^origin\//, "");
    if (name) {
      log(`resolved docs-repo default branch from origin/HEAD: ${name}`);
      return name;
    }
  }

  fail(
    `could not determine the docs repo's default branch (gh repo view failed and the ` +
    `checkout has no origin/HEAD). Pass --base-branch explicitly.`
  );
}

/**
 * Fail-closed cleanliness guard. "Couldn't check" counts as dirty: a guard
 * that fails open on its own error protects nothing.
 */
function assertCleanCheckout(docsRepoPath) {
  const dirty = runAllowFail("git", ["-C", docsRepoPath, "status", "--porcelain"]);
  if (dirty.error || dirty.status !== 0) {
    fail(
      `could not verify the docs checkout at ${docsRepoPath} is clean ` +
      `(\`git status\` ${dirty.error ? `errored: ${dirty.error.message}` : `exited ${dirty.status}`}) — ` +
      `refusing to run on an unverifiable tree.`
    );
  }
  if (dirty.stdout.trim().length > 0) {
    fail(
      `the docs checkout at ${docsRepoPath} has uncommitted changes:\n${dirty.stdout.trim()}\n` +
      `Commit or stash them first — docs-agent only commits its own work.`
    );
  }
}

/**
 * Cheap preflight for the regeneration step, run BEFORE the metered backend
 * call so a misconfigured checkout fails fast instead of after spending tokens.
 */
function assertRegenerationPrereqs(docsRepoPath) {
  const migrationScript = path.join(docsRepoPath, "_migration", "tools", "run-migration.mjs");
  if (!existsSync(migrationScript)) return; // pre-migration checkout; regeneration is skipped later anyway
  if (!existsSync(path.join(docsRepoPath, "node_modules"))) {
    fail(
      `the docs checkout at ${docsRepoPath} has no node_modules, so the content/docs ` +
      `regeneration would fail after the backend call. Run \`npm ci\` there first ` +
      `(CI workflows include this step).`
    );
  }
}

/**
 * Regenerate content/docs + meta.json from the canonical flat sources after
 * writing the model's files, so a docs-agent PR keeps the canonical and
 * generated trees in sync (a generated-only edit would be silently reverted
 * by the next run-migration). Skipped only when the checkout predates the
 * migration tooling.
 */
function regenerateGeneratedOutput(docsRepoPath) {
  const migrationScript = path.join(docsRepoPath, "_migration", "tools", "run-migration.mjs");
  if (!existsSync(migrationScript)) {
    log("no _migration/tools/run-migration.mjs in this checkout; skipping regeneration of content/docs.");
    return false;
  }
  if (!existsSync(path.join(docsRepoPath, "node_modules"))) {
    fail(
      `the docs checkout has no node_modules, so the content/docs regeneration cannot run. ` +
      `Run \`npm ci\` in ${docsRepoPath} first (CI workflows must add an npm ci step for the docs checkout).`
    );
  }
  log("regenerating content/docs + meta.json from canonical flat sources...");
  const res = runAllowFail(process.execPath, [migrationScript], { cwd: docsRepoPath });
  if (res.status !== 0) {
    fail(
      `content/docs regeneration failed (exit ${res.status}). The canonical edits were written ` +
      `but are not committed — fix the failure before retrying.\n--- stderr ---\n${(res.stderr || "").slice(-4000)}`
    );
  }
  return true;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (!opts.repo) fail("--repo is required");
  if (!opts.pr && !opts.range) fail("one of --pr or --range is required");
  if (!opts.docsRepo) fail("--docs-repo is required (or set DOCS_AGENT_DOCS_REPO)");
  if (!opts.product) fail("--product is required");
  if (!opts.standalone && !PRODUCTS.includes(opts.product)) {
    fail(`--product must be one of: ${PRODUCTS.join(", ")} (got "${opts.product}")`);
  }
  if (!BACKENDS[opts.backend]) {
    fail(`--backend must be one of: ${Object.keys(BACKENDS).join(", ")} (got "${opts.backend}")`);
  }

  const ghCheck = runAllowFail("gh", ["--version"]);
  if (ghCheck.error) fail(`gh CLI not found on PATH — required for both reading the source PR and opening the docs PR.`);

  const { rawDiff, prMeta, oversizedPaths: rawOversized } = collectRawDiff(opts);
  // Oversized files that the exclude globs already drop (huge lockfiles are
  // the canonical patch-less file) are noise, not signal — for both the
  // fail-closed guard below and the model prompt.
  const oversizedPaths = rawOversized.filter((p) => !matchesAnyGlob(p, DEFAULT_EXCLUDE_GLOBS));
  const { filteredDiff, keptPaths, droppedPaths } = filterUserFacingDiff(rawDiff);

  if (keptPaths.length === 0) {
    // A diff this script could not read is NOT a quiet PR: asserting
    // "no doc change" from zero visible patches would be a fabricated no-op
    // (the exact failure class weekly-recap was built to kill).
    if (oversizedPaths.length > 0) {
      fail(
        `every changed file in PR #${opts.pr} was too large for a usable patch ` +
        `(${oversizedPaths.length} file(s) without one) — refusing to assert "no doc change" ` +
        `from a diff I could not read. Review this PR's docs impact manually.`
      );
    }
    log(
      `every changed path was excluded (lockfiles/tests/internal-only): ${droppedPaths.join(", ")}. ` +
      `Nothing user-facing to draft docs for. Exiting 0, no PR opened.`
    );
    process.exit(0);
  }

  log(`user-facing changed files (${keptPaths.length}): ${keptPaths.join(", ")}`);
  if (droppedPaths.length) log(`excluded (${droppedPaths.length}): ${droppedPaths.join(", ")}`);

  assertGitRepo(opts.docsRepoPath);
  // Fail on missing regeneration prerequisites and on a dirty checkout BEFORE
  // spending the metered backend call, not after it. Dry runs write nothing,
  // so they skip both preflights.
  if (!opts.dryRun) {
    assertRegenerationPrereqs(opts.docsRepoPath);
    assertCleanCheckout(opts.docsRepoPath);
  }

  const keywords = extractKeywords(filteredDiff, keptPaths);
  const candidatePages = findCandidateDocsPages(opts.docsRepoPath, opts.product, keywords, opts.maxPages, opts.standalone);
  log(`candidate docs pages: ${candidatePages.map((p) => path.relative(opts.docsRepoPath, p)).join(", ") || "(none found)"}`);

  const prompt = buildPrompt({ prMeta, filteredDiff, droppedPaths, oversizedPaths, candidatePages, docsRepoPath: opts.docsRepoPath, standalone: opts.standalone });

  // Persist the prompt + raw output for debugging — especially important in
  // hosted CI where you can't just re-run interactively to see what happened.
  // Deliberately NOT under process.cwd(): cwd is typically the checked-out
  // source repo (or the docs repo), and a stray `git add -A` in some other
  // step must not be able to sweep debug logs into a real commit. Point
  // DOCS_AGENT_LOG_DIR at a workflow-artifact path in CI to keep these.
  const logDir = process.env.DOCS_AGENT_LOG_DIR || mkdtempSync(path.join(tmpdir(), "docs-agent-logs-"));
  mkdirSync(logDir, { recursive: true });
  const runId = crypto.randomUUID().slice(0, 8);
  log(`debug logs for this run: ${logDir} (run id ${runId})`);
  writeFileSync(path.join(logDir, `${runId}-prompt.txt`), prompt, "utf8");

  const rawOutput = await invokeBackendWithBabysitting(opts.backend, prompt, opts.timeoutMs);
  writeFileSync(path.join(logDir, `${runId}-output.txt`), rawOutput, "utf8");

  const fileBlocks = parseFileBlocks(rawOutput, opts.product, opts.standalone);
  // Fail-closed no-op contract: zero FILE blocks is a legitimate no-op ONLY
  // when the model emitted the explicit ===NO-DOC-CHANGE=== sentinel (and no
  // stray ===FILE fragments). Fuzzy phrase-matching was rejected in review —
  // "No documentation update was generated: output truncated" must FAIL.
  if (
    fileBlocks.length === 0 &&
    (rawOutput.includes("===FILE") || !rawOutput.includes("===NO-DOC-CHANGE==="))
  ) {
    fail(
      `backend "${opts.backend}" produced zero parseable ===FILE:===...===END=== blocks and no ` +
      `===NO-DOC-CHANGE=== sentinel — this is a malformed response, not a real no-op. Full output ` +
      `saved to ${path.join(logDir, `${runId}-output.txt`)} for inspection.`
    );
  }

  const result = applyChangesAndOpenPR(opts, {
    fileBlocks,
    prMeta,
    backendName: opts.backend,
    droppedPaths,
    keptPaths,
    oversizedPaths,
    rawOutput,
  });

  log(`done. ${JSON.stringify(result)}`);
}

// Run only when executed directly — importing this module (tests) must not
// start the pipeline. realpath on both sides so a symlinked invocation still
// runs instead of silently exiting 0 (the fabricated-no-op class).
{
  let invokedAs = null;
  if (process.argv[1]) {
    try {
      invokedAs = realpathSync(process.argv[1]);
    } catch {
      invokedAs = null;
    }
  }
  if (invokedAs && invokedAs === realpathSync(fileURLToPath(import.meta.url))) {
    main().catch((err) => {
      fail(err.stack || err.message || String(err));
    });
  }
}
