# docs-agent

A self-hosted replacement for Mintlify's "Agent"/"Automations": watch merged PRs
in the 6 product repos (Layer, Overwatch, Locus, RouteShift, Codex, Invest) and open a
draft PR against the docs repo with an LLM-drafted update.

Files in this directory:

- `docs-agent.mjs` — the driver (Node, zero npm dependencies). Collects a
  filtered diff (falling back to per-file API patches when a PR is too large
  for `gh pr diff`), finds the canonical flat-source docs pages most likely
  affected, prompts an LLM backend, parses its output, writes the flat
  sources, regenerates `content/docs/` + `meta.json` via
  `_migration/tools/run-migration.mjs` so canonical and generated trees stay
  in sync, and opens the PR via `gh` against the docs repo's auto-detected
  default branch (`master` and `main` both work).
- `docs-agent.yml` — the GitHub Actions wiring. **Lives here, not in
  `.github/workflows/`, per the task this was built under — copy it to
  `.github/workflows/docs-agent.yml` in each product repo before it will
  actually run.**
- `weekly-recap.mjs` — generates the changelog's **weekly recap from the real
  merged-PR record** (the durable fix for the fabricated "quiet week" entries —
  see [Weekly recap](#weekly-recap-the-durable-fix-for-fabricated-changelogs)).
  Its workflow lives at `.github/workflows/weekly-recap.yml` (it runs in THIS
  repo, unlike `docs-agent.yml`).
- `weekly-recap-overrides.json` — repository-and-PR-scoped human review
  decisions for ambiguous changes that title heuristics cannot classify
  safely. Every override includes the reason shown in the recap PR's audit
  trail.
- This README.

## How docs-agent drafts (canonical sources, not generated output)

The docs repo's canonical authoring surface is the flat MDX tree at the repo
root (`layer/`, `overwatch/`, `locus/`, `routeshift/`, `codex/`, `invest/`);
`content/docs/` is generated output rebuilt by
`node _migration/tools/run-migration.mjs`. docs-agent honors that boundary:

1. **Candidate discovery reads the flat sources** (`<product>/**.mdx`), scored
   by keyword overlap with the filtered diff (falling back to the product
   index page when nothing matches).
2. **The output contract only permits canonical paths**: `<product>/**/*.mdx`
   for the run's product, plus `docs.json` when a brand-new page needs a
   navigation entry. Anything else — another product's pages, `content/docs/`,
   `meta.json`, app code — is rejected fail-closed. Legacy
   `content/docs/<product>/…` paths are remapped onto the flat source with a
   logged notice instead of writing into the tree a regeneration would revert.
3. **After writing, the driver reruns the migration** inside the docs checkout
   and commits the regenerated `content/docs/` + `meta.json` alongside the
   canonical edits, so a merged docs-agent PR can never drift from the
   generated corpus (the LAY-721 failure class). This requires `npm ci` in the
   docs checkout first — hosted workflows include that step.
4. **The base branch is auto-detected** (`gh repo view` default branch, then
   the checkout's `origin/HEAD`), overridable with `--base-branch`. A
   hardcoded `main` once silently killed every draft PR against this repo's
   `master`; the detection now fails loud instead of guessing.

Backend notes: the `glm` backend (OpenAI-compatible HTTP, e.g. Neural Watt GLM
5.2) always streams (`stream:true` — non-streaming 524s at pipeline prompt
sizes on that aggregator) and defaults `max_tokens` to 49152
(`DOCS_AGENT_GLM_MAX_TOKENS`), because reasoning models spend the completion
budget on thinking before content. A stream that ends with
`finish_reason=length` fails the run outright — truncated output is never
committed, rather than smuggling a half-written FILE block into a PR.

## Weekly recap (the durable fix for fabricated changelogs)

The changelog's weekly recaps were once written by a bot with **no visibility
into the product repos**, which stamped boilerplate *"quiet week, no user-facing
changes"* over weeks that actually had 250+ merged PRs, and invented overlapping
3-day "weeks" (July 12–14, then July 14–16). `weekly-recap.mjs` makes the recap
a pure function of ground truth so that can't happen again:

1. **7-day calendar weeks by construction.** Every recap spans exactly one
   Sunday–Saturday calendar week. The window resolves to the most recent
   **completed** week (the default anchor is yesterday; mid-week runs snap back
   to the prior Saturday), so the cadence cron always captures the full prior
   week with no same-day merges stranded. An explicit `--since`/`--until` that
   isn't Sun–Sat is snapped to the calendar week and warns; `--force` targets an
   exact window for historical backfill or regeneration.
2. **Grounded in real PRs.** It collects the merged PRs in the window from all
   six product repos via the GitHub search API (`gh api search/issues` with
   `is:pr is:merged merged:<since>..<until>`), or from a `--prs-json` fixture
   for replay/testing.
3. **Transparent filtering.** Non-user-facing noise (bots, wiki op-logs, chores,
   tests, CI) is filtered, and the dropped list *with reasons* goes into the PR
   body — so a "quiet week" is **provably** quiet (derived from an actually-empty
   query), never asserted. Ambiguous historical changes use exact
   `repo#pull-request` decisions in `weekly-recap-overrides.json`; this keeps
   reviewer judgment deterministic without broad keyword rules that could hide
   a real product release.
4. **Deterministic by default = zero hallucination.** The default output
   organizes the kept PRs into **New features / Updates / Fixes** sections
   (each bullet labeled by product) with their real titles and links — no LLM,
   so nothing can be invented. An opt-in `--polish` mode rewrites that into
   house-style prose under a strict "use only the listed facts" contract, and
   keeps the raw PR list in the PR body for a human to verify the prose against.
5. **No polish regression.** It regenerates the dated changelog collection and
   its root landing page, never the product docs dirs, so it can't clobber the
   hand-polished product pages (the LAY-721 drift).
6. **The landing page stays current.** Each completed window gets a compact,
   source-linked highlights block at the top of `changelog.mdx`, while the
   dated entry retains the full reviewed list.

### Local usage

```bash
# Dry run for the default window (the most recent completed Sun–Sat week):
node pipeline/weekly-recap.mjs --dry-run

# A specific week (snapped to the Sun–Sat calendar week containing the date;
# this example resolves to the week ending Saturday 2026-08-01):
node pipeline/weekly-recap.mjs --until 2026-08-01 --dry-run

# An exact window for historical backfill (bypasses calendar snapping and
# overlap guards — use for regenerating a specific week):
node pipeline/weekly-recap.mjs --since 2026-07-19 --until 2026-07-25 --force --dry-run

# Write the files locally (flat source + regenerated changelog + nav):
node pipeline/weekly-recap.mjs

# Open a draft PR against the docs repo:
node pipeline/weekly-recap.mjs --open-pr

# Optional LLM prose polish (uses your already-authed CLI; raw list stays in
# the PR body for verification):
node pipeline/weekly-recap.mjs --open-pr --polish --backend claude

# Replay/test from a fixture instead of the GitHub API:
node pipeline/weekly-recap.mjs --prs-json /tmp/prs.json --dry-run

# Print the exact kept/dropped audit body for review or PR refresh:
node pipeline/weekly-recap.mjs --since 2026-07-24 --until 2026-07-25 --force --print-pr-body
```

### Deploy (the one manual step)

The workflow at `.github/workflows/weekly-recap.yml` runs every **Sunday
02:00 UTC** (and on demand via `workflow_dispatch`). It runs after Saturday
ends, so the window — which closes on a completed day (`until` = yesterday) —
captures the full prior week with no same-day merges stranded between windows.
The default deterministic path is **free** — it needs only `gh` + Node and one
PAT. To activate it:

1. Create a **fine-grained PAT**. GitHub applies one permission set across every
   repo a token can access, so select all seven repos — the six product repos
   (`axiomlayer`, `axiom-overwatch`, `axiom-locus`, `RouteShift`, `axiomcodex`,
   `invest`) plus `axiom-docs` — and grant **Contents: Read & Write** and **Pull
   requests: Read & Write**. The product repos only ever need *read* (for the
   cross-repo merged-PR search); the write grant on them is unused but
   unavoidable with a single token. (The default `GITHUB_TOKEN` is scoped to
   this repo only and cannot read the other private repos, which is why a PAT
   is required at all.)
2. Set it as the repo secret **`DOCS_AGENT_PAT`** (Settings → Secrets and
   variables → Actions): `gh secret set DOCS_AGENT_PAT --repo smynkr/axiom-docs`.
3. (Optional, only for `--polish`) set one of `ANTHROPIC_API_KEY` /
   `OPENAI_API_KEY` / `GEMINI_API_KEY`. The scheduled default does **not** use
   these — it's deterministic and metered-key-free.

Until the PAT is set, the script still works **locally** (your own `gh` auth has
access to all the repos) — run it by hand after a quiet week and the automation
is just the convenience layer on top.

---

Everything below was verified against primary sources on 2026-07-22, not
assumed. Re-verify before relying on it long-term — CLI auth flows and
pricing both move.

---

## The crux question: does the subscription work in CI, or do you need a metered key?

**Short answer: for all three backends, unattended generation on a
GitHub-hosted runner needs a metered API key. None of the three flat
subscriptions the team already pays for (Claude Code Max, ChatGPT Plus/Pro/Team
for Codex, a personal Gemini login) is a working substitute for that specific
use case.** That's a real constraint on the "this should be free, we already
pay for it" framing — but it's a narrower problem than it sounds, and there's
a genuinely free path around it (see [Recommendation](#recommendation)).

### Claude Code

- `claude setup-token` (Pro/Max only) mints an OAuth token you can put in
  `CLAUDE_CODE_OAUTH_TOKEN` for [`anthropics/claude-code-action`][claude-action],
  which then bills your subscription quota instead of the API.
- **But that token expires in roughly 24 hours, and the Action has no
  `claude_code_refresh_token` input to auto-renew it** — this is an open
  upstream issue ([`anthropics/claude-code-action#727`][claude-issue-727]).
  A webhook-triggered workflow (PR merged → run docs-agent) cannot assume the
  token is still valid; it will start silently failing within a day of being
  set up, with no automated recovery.
- Separately, Anthropic's own guidance draws the line at *unattended*
  automation: subscription terms cover interactive/individual usage, and the
  documented pattern for CI/CD, scripts, and hooks that call Claude without a
  human present is the metered API, not the subscription. A scheduled or
  webhook-triggered GitHub Actions job is exactly that case.
- **Conclusion: hosted CI needs `ANTHROPIC_API_KEY`.**

### Codex CLI

- The official [Codex GitHub Action][codex-action] documents `OPENAI_API_KEY`
  as the credential — "Store your OpenAI key as a GitHub secret... The action
  installs the Codex CLI, starts the Responses API proxy when you provide an
  API key, and runs `codex exec`."
- ChatGPT Plus/Pro/Team subscription login is **not** an option the Action
  supports today. There's an open feature request for subscription-backed
  `@codex` usage on GitHub (`openai/codex#34425`), but it isn't shipped.
- **Conclusion: hosted CI needs `OPENAI_API_KEY`. No subscription path exists
  for the officially supported Action, full stop.**

### Gemini CLI

- The documented non-interactive/CI pattern (`google-github-actions/run-gemini-cli`,
  and the CLI's own headless-mode docs) is `GEMINI_API_KEY` set as an
  environment variable; the CLI exits with an error in non-interactive mode if
  no key is found.
- A personal Google OAuth login (`~/.gemini/oauth_creds.json`) is what backs
  interactive terminal sessions and the free/subscription tier, but reusing
  that credential file in CI isn't an officially supported or documented
  pattern, and OAuth access tokens rotate/expire in ways the interactive CLI
  handles transparently that a headless CI job won't.
- **Conclusion: hosted CI needs `GEMINI_API_KEY`.**

### What it actually costs if you do it anyway

Given current (2026-07-22) API pricing —
Claude Sonnet 5 ($2/$10 per M input/output tokens, intro pricing through
Aug 31 2026), GPT-5.6 ($5/$30 per M), Gemini 3 Pro ($2/$12 per M up to 200K
context) — and a typical prompt for this pipeline (filtered diff + 1-3 short
MDX pages + instructions, roughly 3-8K input tokens; drafted output roughly
1-3K tokens):

| Backend | Typical run | Worst case (big diff, 5 pages) |
|---|---|---|
| Claude Sonnet 5 | ~$0.02–0.04 | ~$0.10 |
| GPT-5.6 | ~$0.04–0.08 | ~$0.19 |
| Gemini 3 Pro | ~$0.02–0.04 | ~$0.08 |

At solo/small-team PR volume (a few dozen merged PRs/month across 6 product repos),
hosted mode is realistically **$1–10/month**, not the kind of runaway spend
that motivated leaving Mintlify. So the objection to hosted mode isn't really
"it's expensive" — it's that it (a) requires standing up and funding a
metered account on top of subscriptions you already pay for, and (b) for
Claude specifically, the subscription path doesn't just cost extra, it's
mechanically broken for unattended use (the 24h token expiry above) regardless
of what you're willing to spend.

---

## Recommendation

> **Status (2026-08-04):** all six product repos run the **hosted GLM 5.2**
> form of this design (the template in `pipeline/docs-agent.yml`), so the
> `detect`/`notify`/`DOCS_AGENT_MODE` machinery described below is the
> historical rationale for the free path, not the current wiring. The cost
> analysis below still explains why hosted mode uses a metered key.

**Default to local, human-triggered generation (zero marginal cost), with
hosted mode as an explicit opt-in for teams who want full hands-off
automation and are fine with a small metered bill.** This is what
`docs-agent.yml` implements:

1. **`detect` job (always runs, free)** — on every merged PR, calls
   `gh pr view --json files` and applies the same exclude-glob filter
   `docs-agent.mjs` uses (lockfiles/tests/internal paths out). Zero LLM calls,
   zero cost, just the GitHub API.
2. **`notify` job (default path, free)** — if the PR looks user-facing,
   comments on it asking a human to run:
   ```
   npm run docs:sync -- --pr <number>
   ```
   locally. This runs `docs-agent.mjs` against your machine's own
   already-authenticated `claude` / `codex` / `gemini` CLI session — the exact
   same subscription you use for everything else, at **$0 marginal cost**,
   with no ToS ambiguity (you're a human running a command, not a webhook
   running unattended). The tradeoff is honest: it's not "fully automated in
   the cloud," it's "one command after you merge." For a solo/small team
   that's a fine trade for zero marginal cost and no new billing relationship.
3. **`hosted` job (opt-in, metered)** — set the repo/org Actions **variable**
   `DOCS_AGENT_MODE=hosted` (not a secret — it's not sensitive) to make the
   workflow call `docs-agent.mjs` directly in CI with a metered key. Realistic
   cost per the table above. Use this if full hands-off automation is worth
   $1-10/month to you; the driver script is identical either way; only the
   auth environment differs.

A third option not built here but worth naming: a **self-hosted GitHub
Actions runner** on a machine (or small always-on VPS) where you've already
run `claude login` / `codex login` / `gemini` interactively once. Triggering
via GitHub Actions on that runner would let the webhook use the local
subscription session directly, no API key — but this still means an
unattended job driving the CLI with no human present, which is the same
"automated use → use the API" line Anthropic draws for the subscription (see
above). We're flagging this as a real gray area rather than quietly building
it: if you want a fully automatic pipeline with zero metered spend, the
`notify` + local `npm run docs:sync` pattern is the one that's unambiguously
fine; a self-hosted-runner-as-cron variant of the same idea trades that
certainty for convenience.

---

## Setup

### Prerequisites (both modes)

- `gh` CLI installed and authenticated (`gh auth login`), with access to both
  the product repos and the docs repo.
- A local checkout of the docs repo, e.g.:
  ```
  gh repo clone your-org/axiom-docs ../axiom-docs
  ```
- Node 18+.

### Local mode (`npm run docs:sync`)

Add to the product repo's `package.json`:
```jsonc
"scripts": {
  "docs:sync": "node pipeline/docs-agent.mjs --docs-repo your-org/axiom-docs --docs-repo-path ../axiom-docs --product layer"
}
```
(adjust `--product` per repo: `layer | overwatch | locus | routeshift | codex | invest`)

Run after merging a PR:
```
npm run docs:sync -- --repo your-org/axiom-layer --pr 1234
```
or against a local range instead of a merged PR number:
```
npm run docs:sync -- --repo your-org/axiom-layer --range origin/main~5..origin/main
```

Auth: whatever you're already logged into locally (`claude`, `codex`, or
`gemini` — pick with `--backend`, default `claude`) is used as-is. Nothing
extra to configure.

### Hosted mode (opt-in)

1. Copy `docs-agent.yml` to `.github/workflows/docs-agent.yml` in each product
   repo.
2. Set repo variables (Settings → Secrets and variables → Actions → Variables):
   - `DOCS_AGENT_PRODUCT` — `layer` / `overwatch` / `locus` / `routeshift` / `codex` / `invest`
   - `DOCS_AGENT_DOCS_REPO` — e.g. `your-org/axiom-docs`
   - `DOCS_AGENT_MODE=hosted` — only if you want the metered path; leave unset
     (or `detect`) to stay on the free local-trigger pattern.
3. Set repo secrets:
   - `DOCS_REPO_PAT` — a fine-grained GitHub PAT scoped to the docs repo only,
     with Contents: Read & write and Pull requests: Read & write. The default
     `GITHUB_TOKEN` is scoped to the repo the workflow runs in and cannot open
     a PR against a different repo.
   - Whichever of `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GEMINI_API_KEY`
     matches your chosen `--backend`, **only if `DOCS_AGENT_MODE=hosted`**.
     Not needed at all for the default free path.

### Backend selection

`--backend claude|codex|gemini`, or env `DOCS_AGENT_BACKEND`. Default is
`claude`. All three are wired identically — same driver, same output
contract, same babysitting logic — so switching is a one-flag change. Pick
based on which CLI you find drafts the cleanest MDX for this codebase; there's
no cost-driven reason to prefer one over another for local runs (all $0
marginal), and the hosted-mode cost table above shows they're within 2-3x of
each other, not an order of magnitude apart.

Each backend's CLI binary and invocation flags are overridable
(`DOCS_AGENT_CLAUDE_CMD`, `DOCS_AGENT_CLAUDE_ARGS`, etc. — see
`docs-agent.mjs --help`) because these CLIs' non-interactive flags have moved
before and will again; verify against `<cmd> --help` for your installed
version before trusting the defaults baked into the script, especially in CI
where a silent flag change would show up as an opaque non-zero exit.

---

## Babysitting / failure modes (why this doesn't produce silent empty PRs)

`docs-agent.mjs` treats exactly one outcome as "nothing to do, exit 0, no PR":
the backend returned zero file blocks (or blocks identical to what's already
on disk) **and** its explanation reads like a real "no doc change needed"
response. Every other way this can go wrong is a loud non-zero exit with the
raw stderr/stdout in the message and the full prompt + response saved to a
debug log dir (`DOCS_AGENT_LOG_DIR`, uploaded as a workflow artifact in hosted
mode):

- **Backend not found / not authenticated** — fails immediately on
  `<cmd> --version` before ever building a prompt.
- **Timeout** (default 20 min, `--timeout-ms` / `DOCS_AGENT_TIMEOUT_MS`) — the
  child process is SIGTERM'd then SIGKILL'd after a grace period; reported as
  a stall, explicitly not conflated with "no changes needed."
- **Non-zero exit from the backend** — surfaced with stderr, not swallowed.
- **Empty stdout on exit 0** — treated as a failure, not a no-op. A genuine
  "no changes needed" response still contains the model's explanation text;
  truly empty output means something broke upstream (rate limit that didn't
  set a non-zero exit, a CLI update that changed print-mode behavior, etc.).
- **Output that doesn't follow the `===FILE:...===...===END===` contract and
  doesn't read like an explicit no-op explanation either** — treated as the
  model not following instructions, not as "nothing to do." Full output is
  saved for inspection rather than discarded.
- **Every changed path in the diff was excluded** (lockfiles/tests/internal
  paths only) — this one legitimately exits 0 with no backend call at all,
  logged clearly as "nothing user-facing changed."

If you want to verify this behavior for yourself rather than trust this
paragraph: swap `DOCS_AGENT_CLAUDE_CMD` to point at a stub script that exits
1, or prints nothing, or sleeps past the timeout, and confirm the run fails
loudly rather than opening (or silently skipping) a PR. That's exactly how
this was verified while building it.

[claude-action]: https://github.com/anthropics/claude-code-action
[claude-issue-727]: https://github.com/anthropics/claude-code-action/issues/727
[codex-action]: https://developers.openai.com/codex/github-action
