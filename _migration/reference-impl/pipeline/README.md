# docs-agent

A self-hosted replacement for Mintlify's "Agent"/"Automations": watch merged PRs
in the 5 product repos (Layer, Overwatch, Locus, RouteShift, Codex) and open a
draft PR against the docs repo with an LLM-drafted update.

Files in this directory:

- `docs-agent.mjs` — the driver (Node, zero npm dependencies). Collects a
  filtered diff, finds the docs pages most likely affected, prompts an LLM CLI
  backend, parses its output, writes files, opens the PR via `gh`.
- `docs-agent.yml` — the GitHub Actions wiring. **Lives here, not in
  `.github/workflows/`, per the task this was built under — copy it to
  `.github/workflows/docs-agent.yml` in each product repo before it will
  actually run.**
- This README.

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

At solo/small-team PR volume (a few dozen merged PRs/month across 5 repos),
hosted mode is realistically **$1–10/month**, not the kind of runaway spend
that motivated leaving Mintlify. So the objection to hosted mode isn't really
"it's expensive" — it's that it (a) requires standing up and funding a
metered account on top of subscriptions you already pay for, and (b) for
Claude specifically, the subscription path doesn't just cost extra, it's
mechanically broken for unattended use (the 24h token expiry above) regardless
of what you're willing to spend.

---

## Recommendation

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
(adjust `--product` per repo: `layer | overwatch | locus | routeshift | codex`)

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
   - `DOCS_AGENT_PRODUCT` — `layer` / `overwatch` / `locus` / `routeshift` / `codex`
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
- **Timeout** (default 10 min, `--timeout-ms` / `DOCS_AGENT_TIMEOUT_MS`) — the
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
