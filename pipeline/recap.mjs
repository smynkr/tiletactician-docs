#!/usr/bin/env node
/**
 * recap.mjs — generate a changelog entry from the REAL merged-PR record
 * of a single app repository (smynkr/Crossplay-Pro). Stripped-down sibling of axiom-docs'
 * weekly-recap.mjs: one repo, one changelog, zero LLM.
 *
 * Usage:
 *   node pipeline/recap.mjs --repo smynkr/Crossplay-Pro [--dry-run]
 *   node pipeline/recap.mjs --repo smynkr/Crossplay-Pro --since 2026-07-20 --until 2026-07-26
 *   node pipeline/recap.mjs --repo smynkr/Crossplay-Pro --force  # overlap/backfill
 *
 * Requires: Node 18+, `gh` CLI authenticated with read access to the app repo.
 * Zero npm dependencies.
 */

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..");
const CHANGELOG_PATH = path.join(REPO_ROOT, "tiletactician", "changelog.mdx");

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function fail(msg) { console.error(`\n[recap] ERROR: ${msg}\n`); process.exit(1); }
function log(msg) { console.log(`[recap] ${msg}`); }

function parseArgs(argv) {
  const out = {
    repo: process.env.RECAP_REPO || null,
    since: null,
    until: null,
    dryRun: false,
    force: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => { const v = argv[++i]; if (v === undefined) fail(`${a} requires a value`); return v; };
    switch (a) {
      case "--repo": out.repo = next(); break;
      case "--since": out.since = next(); break;
      case "--until": out.until = next(); break;
      case "--dry-run": out.dryRun = true; break;
      case "--force": out.force = true; break;
      case "--help": case "-h": printHelp(); process.exit(0); break;
      default: fail(`Unknown argument: ${a} (--help for usage)`);
    }
  }
  if (!out.repo) fail("--repo <owner/name> is required (or set RECAP_REPO env var)");
  return out;
}

function printHelp() {
  console.log(`
recap.mjs — generate a changelog entry from the real merged-PR record.

  --repo <owner/name>   App repository to collect PRs from (required)
  --since <YYYY-MM-DD>  Window start (default: 7 days before --until)
  --until <YYYY-MM-DD>  Window end (default: yesterday)
  --dry-run             Print the entry; write nothing
  --force               Allow overlapping an existing changelog entry
`);
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

function parseDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) fail(`invalid date "${s}" (want YYYY-MM-DD)`);
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3])
    fail(`invalid calendar date "${s}"`);
  return d;
}
function fmtDate(d) { return d.toISOString().slice(0, 10); }
function addDays(d, n) { const x = new Date(d); x.setUTCDate(x.getUTCDate() + n); return x; }
function todayUTC() { return parseDate(new Date().toISOString().slice(0, 10)); }

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function windowLabel(since, until) {
  const s = parseDate(since), u = parseDate(until);
  if (since === until) return `${MONTHS[s.getUTCMonth()]} ${s.getUTCDate()}, ${s.getUTCFullYear()}`;
  if (s.getUTCMonth() === u.getUTCMonth() && s.getUTCFullYear() === u.getUTCFullYear())
    return `${MONTHS[s.getUTCMonth()]} ${s.getUTCDate()}–${u.getUTCDate()}, ${s.getUTCFullYear()}`;
  return `${MONTHS[s.getUTCMonth()]} ${s.getUTCDate()} – ${MONTHS[u.getUTCMonth()]} ${u.getUTCDate()}, ${u.getUTCFullYear()}`;
}

// ---------------------------------------------------------------------------
// Collection
// ---------------------------------------------------------------------------

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { encoding: "utf8", ...opts });
  if (res.error) fail(`failed to run \`${cmd} ${args.join(" ")}\`: ${res.error.message}`);
  if (res.status !== 0 && !opts.allowFail)
    fail(`\`${cmd} ${args.join(" ")}\` exited ${res.status}\n${res.stderr}`);
  return res;
}

function collectMergedPRs(repo, since, until) {
  const q = `repo:${repo} is:pr is:merged merged:${since}..${until}`;
  const items = [];
  for (let page = 1; page <= 10; page++) {
    const res = run("gh", [
      "api", "search/issues", "-X", "GET",
      "-f", `q=${q}`, "-f", "per_page=100", "-f", `page=${page}`,
    ], { allowFail: true });
    if (res.status !== 0)
      fail(`gh api search/issues failed for ${repo} (exit ${res.status}).\n${(res.stderr || "").slice(-1000)}`);
    let parsed;
    try { parsed = JSON.parse(res.stdout || "{}"); } catch { fail(`could not parse gh search output`); }
    const batch = parsed.items || [];
    for (const it of batch) {
      items.push({
        number: it.number,
        title: it.title,
        url: it.html_url,
        mergedAt: (it.pull_request && it.pull_request.merged_at) || "",
        author: (it.user && it.user.login) || "",
      });
    }
    if (batch.length < 100) break;
    if (items.length >= 1000) fail(`${repo} returned 1000+ PRs — narrow the window`);
  }
  return items.sort((a, b) => String(b.mergedAt).localeCompare(String(a.mergedAt)) || b.number - a.number);
}

// ---------------------------------------------------------------------------
// Noise filter
// ---------------------------------------------------------------------------

const BOT_AUTHORS = /(\[bot\]|^github-actions$|^dependabot$|^renovate$)/i;
const NOISE_RULES = [
  [/^chore(\(|:)/i, "chore"],
  [/^test(\(|:|$)/i, "test-only"],
  [/^ci(\(|:|$)/i, "CI-only"],
  [/^build(\(|:|$)/i, "build-only"],
  [/^docs(\(|:)/i, "docs-only"],
  [/^style(\(|:)/i, "style-only"],
  [/^refactor(\(|:)/i, "refactor"],
];

function filterPRs(prs) {
  const kept = [], dropped = [];
  for (const pr of prs) {
    if (pr.author && BOT_AUTHORS.test(pr.author)) { dropped.push({ ...pr, reason: `bot (${pr.author})` }); continue; }
    const rule = NOISE_RULES.find(([re]) => re.test(pr.title));
    if (rule) { dropped.push({ ...pr, reason: rule[1] }); continue; }
    kept.push(pr);
  }
  return { kept, dropped };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function stripPrefix(title) {
  return title.replace(/^[a-z]+(\([^)]*\))?!?:\s*/i, "").trim() || title;
}
function escapeMdx(s) {
  return String(s).replace(/[<>{}]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "{": "&lbrace;", "}": "&rbrace;" }[c]));
}
function categorize(title) {
  if (/^feat(\(|:|!)/i.test(title)) return "features";
  if (/^fix(\(|:|!)/i.test(title)) return "fixes";
  return "updates";
}

const SECTION_TITLE = { features: "New features", updates: "Updates", fixes: "Fixes" };
const SECTION_ORDER = ["features", "updates", "fixes"];

function renderEntry(label, kept, dropped) {
  const lines = [];
  lines.push(`## ${label}`);
  lines.push("");
  if (kept.length === 0) {
    lines.push(`No user-facing changes shipped this window. (${dropped.length} merged PR${dropped.length === 1 ? " was" : "s were"} filtered as non-user-facing.)`);
    lines.push("");
    return lines.join("\n");
  }
  lines.push(`${kept.length} user-facing change${kept.length === 1 ? "" : "s"} shipped.`);
  lines.push("");
  for (const section of SECTION_ORDER) {
    const rows = kept.filter((pr) => categorize(pr.title) === section);
    if (rows.length === 0) continue;
    lines.push(`### ${SECTION_TITLE[section]}`);
    lines.push("");
    for (const pr of rows) {
      lines.push(`- ${escapeMdx(stripPrefix(pr.title))} ([#${pr.number}](${pr.url}))`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Changelog file management
// ---------------------------------------------------------------------------

const FRONTMATTER_END = "---\n";

function insertEntry(entry) {
  if (!existsSync(CHANGELOG_PATH)) fail(`changelog not found at ${CHANGELOG_PATH}`);
  const current = readFileSync(CHANGELOG_PATH, "utf8");

  // Find the end of frontmatter (second ---) to insert after it.
  const firstDash = current.indexOf(FRONTMATTER_END);
  if (firstDash === -1) fail("changelog.mdx has no frontmatter");
  const secondDash = current.indexOf(FRONTMATTER_END, firstDash + FRONTMATTER_END.length);
  if (secondDash === -1) fail("changelog.mdx frontmatter is not closed");
  const insertAt = secondDash + FRONTMATTER_END.length;

  // Skip any leading whitespace/newlines after frontmatter.
  const afterFrontmatter = current.slice(insertAt).replace(/^\s*/, "");
  const updated = current.slice(0, insertAt) + "\n" + entry + "\n" + afterFrontmatter;
  writeFileSync(CHANGELOG_PATH, updated, "utf8");
}

function lastEntryDate() {
  if (!existsSync(CHANGELOG_PATH)) return null;
  const content = readFileSync(CHANGELOG_PATH, "utf8");
  // Match "## Month D–D, YYYY" or "## Month D, YYYY" headings.
  const m = /^## .*(\d{4})\s*$/m.exec(content);
  return m ? m[1] : null;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const opts = parseArgs(process.argv.slice(2));

  const until = opts.until || fmtDate(addDays(todayUTC(), -1));
  const since = opts.since || fmtDate(addDays(parseDate(until), -6));
  const label = windowLabel(since, until);

  log(`repo: ${opts.repo}`);
  log(`window: ${label} (${since} → ${until})`);

  // Overlap guard: check if an entry for this window already exists.
  if (!opts.force) {
    const existing = readFileSync(CHANGELOG_PATH, "utf8");
    if (existing.includes(`## ${label}`)) {
      log(`an entry for "${label}" already exists in changelog.mdx. Pass --force to regenerate.`);
      process.exit(0);
    }
  }

  const prs = collectMergedPRs(opts.repo, since, until);
  log(`collected ${prs.length} merged PR(s)`);

  const { kept, dropped } = filterPRs(prs);
  log(`kept ${kept.length} user-facing; filtered ${dropped.length}`);

  const entry = renderEntry(label, kept, dropped);

  if (opts.dryRun) {
    log("--dry-run: would prepend to changelog.mdx —\n");
    console.log(entry);
    return;
  }

  insertEntry(entry);
  log(`wrote ${CHANGELOG_PATH}`);

  // Canonical flat source is the contract: regenerate the Fumadocs mirror and
  // the memory source manifest so gates stay green (migration is idempotent).
  run("node", ["_migration/tools/run-migration.mjs"], { cwd: REPO_ROOT });
  const mg = run("npm", ["run", "memory:generate"], { cwd: REPO_ROOT, allowFail: true });
  if (mg.status !== 0) log("memory:generate skipped or failed (see logs) — migration mirror still written");
  log("done.");
}

main();
