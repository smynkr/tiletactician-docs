# SPEC — Migrate Axiomancer docs off Mintlify to self-hosted Fumadocs

**Status:** Ready for design + implementation
**Author:** research/PoC pass, 2026-07-22
**Implementer:** Fable
**Reference implementation:** `./reference-impl/` (working, build-verified — see §9)

---

## 1. Decision & rationale

Move `docs.axiomancer.io` (5 products, 219 MDX pages) off Mintlify Pro onto a self-hosted
**Fumadocs** site on Vercel.

**Why:** Mintlify's cost model is subscription + metered AI credits, where *page generation itself*
burns credits. The startup-plan discount is time-limited. Of the Pro-only features, the owner needs
exactly one — the docs-writing **Agent** — and that is the metered one. Reader chat Assistant and API
playground are explicitly out of scope (§3).

**Why this is cheaper than it looks:** the migration risk concentrated in three places that turned out
not to apply here — no OpenAPI-generated pages, no content images, and only 11 distinct components.
See §2.

---

## 2. Verified ground truth

All of the following was verified directly against the live deployment and the repo — **do not
re-derive, and do not assume the generic "Mintlify migration is hard" narrative applies.**

### Content corpus (`github.com/smynkr/axiom-docs`, default branch `master`)
- 226 files; **155 product `.mdx` pages + 64 changelog pages**. 5 products: `layer/` `overwatch/`
  `locus/` `routeshift/` `codex/`.
- **Frontmatter is only `title` (220), `description` (219), `tag` (6), `mode` (1).** Nothing else.
  `title`/`description` are Fumadocs natives — zero frontmatter migration.
- **No content images.** `images/` holds only `favicon.svg`, `logo-dark.svg`, `logo-light.svg`.
- **API reference pages are hand-written MDX prose**, e.g. headings like ``## `GET` `/api/score` ``.
  There is **no `openapi` key in `docs.json`** and **zero `ParamField`/`ResponseField` usage**.
  → Nothing is OpenAPI-generated. The biggest normally-cited migration risk (slug drift from a
  different OpenAPI plugin breaking indexed URLs) **does not exist here**.

### Complete component census (these are the ONLY components used in all 219 pages)
| Component | Uses | Target |
|---|---|---|
| `Update label tags` | 423 (changelog only) | local shim |
| `Note` | 157 | `Callout` |
| `Step` | 155 | `Step` (Mintlify's `title` prop → `### heading`) |
| `Card title icon href` | 71 | `Card` |
| `Accordion title` | 55 | `Accordion` (must be wrapped in `Accordions`) |
| `Steps` | 40 | `Steps` |
| `Columns cols={n}` | 22 | `Cards` |
| `Tip` | 21 | `Callout type="info"` |
| `AccordionGroup` | 18 | `Accordions` |
| `Warning` | 10 | `Callout type="warn"` |
| `CodeGroup` | 1 | `Tabs` |

No `Frame`, `Snippet`, `Expandable`, `RequestExample`, `ResponseExample`, `Tooltip`, `Panel`, `Tiles`.

### Why the docs went stale (context — this migration must not reproduce it)
- **4 Mintlify automations are `disabledByBilling: true`**, all last ran **2026-04-29** — the same date
  115 of 155 product pages froze.
- **178 open PRs, 100% authored by the `mintlify` GitHub App**, created 2026-04-18 → 2026-05-19.
- Merged PRs/month: **Apr 278 → May 79 → Jun 0 → Jul 43.**
- The `Update from code changes` automation has `automerge: false`; the repo has
  `allow_auto_merge: false`. No branch protection and **no rulesets** (a ruleset-bypass theory was
  checked and refuted).
- **19 changelog entries are labelled 2026-08-01 … 2026-11-28** but were git-authored in April/May,
  and the `docs.json` global Changelog anchor points at `/changelog/2026-11-28` (live, HTTP 200).

**Design consequence:** the failure mode was *generation without a merge path*. The new pipeline must
have an owner-facing merge step that is cheap and habitual, not an unbounded PR firehose.

**Re-verify commands:**
```bash
gh pr list --repo smynkr/axiom-docs --state open --limit 200 --json author,createdAt
gh api repos/smynkr/axiom-docs/rulesets
# Mintlify Admin MCP: workflows.listWorkflows({})
```

---

## 3. Scope

**In scope**
1. Fumadocs site serving all 5 products + changelog, deployed on Vercel at `docs.axiomancer.io`.
2. Mintlify→Fumadocs codemod for all 219 pages.
3. Navigation generated from the existing `docs.json`.
4. Built-in static search.
5. **Self-hosted docs-generation agent** (the Mintlify "Agent" replacement).
6. **Search analytics** — specifically zero-result queries.
7. `llms.txt` / `llms-full.txt` parity.

**Out of scope (explicit owner decision)**
- Reader-facing AI chat assistant.
- API playground / interactive try-it (never existed — no OpenAPI spec).
- Mintlify's web WYSIWYG editor. Editing is git/PR-based, which is already the de-facto flow.

**Carry-over decision needed:** the Intercom widget (`docs.json` → `integrations.intercom.appId`) is
live on the current site. Decide whether to port it. Not blocking.

---

## 4. Architecture

```
smynkr/axiom-docs (content, MDX)  ──►  Fumadocs (Next.js) ──► Vercel ──► docs.axiomancer.io
        ▲                                     │
        │ PR                                  ├─ static search index (built-in)
        │                                     ├─ /llms.txt, /llms-full.txt (scaffold-provided)
   docs-agent                                 └─ PostHog: docs_search / docs_search_no_results
        ▲
        │ merged PR diff
  5 product repos (axiomlayer, axiom-overwatch, axiom-locus, routeshift, axiomcodex)
```

**Stack (verified working):** `fumadocs-core@16.12.0`, `fumadocs-mdx@15.2.0`,
`fumadocs-ui` (= `npm:@fumadocs/base-ui@16.12.0`), `next@16.2.11`, React 19, Tailwind 4.

The scaffold from `npm create fumadocs-app` (template `+next+fuma-docs-mdx`) **already ships**:
`app/api/search/route.ts`, `app/llms.txt/route.ts`, `app/llms-full.txt/route.ts`, per-page markdown
routes, OG image routes, and `lucideIconsPlugin()`. Do not rebuild these.

---

## 5. Workstream A — Site + content migration

### A1. Serve docs at the ROOT, not `/docs` — **URL preservation (required)**
Current live URLs are `docs.axiomancer.io/layer/integrations/aws`. Fumadocs defaults to `/docs/...`.

**Requirement:** configure `loader({ baseUrl: '/' })` in `lib/source.ts` and move the catch-all route
so existing URLs are preserved **byte-identically**. This eliminates the entire redirect map and any
SEO loss.

- Known constraint: an *optional* catch-all `app/[[...slug]]` collides with `app/(home)/page.tsx`.
  Use a **required** catch-all `app/[...slug]` and keep `(home)/page.tsx` for `/`.
- **Consequence:** the codemod's internal-link rewriting becomes a **no-op** — links stay `/layer/...`.
  This also makes bug **B1** below moot. Prefer this over rewriting links.
- Acceptance: for every one of the 155 product pages, the new URL equals the old URL. Verify by
  diffing a crawl of the live Mintlify sitemap against the built route list.

### A2. Codemod
Port `reference-impl/tools/` (`mintlify-to-fumadocs.mjs`, `docsjson-to-meta.mjs`, `lib/shared.mjs`).
AST-based (unified/remark/remark-mdx), idempotent (verified byte-identical on re-run).

**Bugs found in the reference implementation — fix or design out:**

- **B1 — internal links with both a path and a fragment are silently not rewritten.**
  `reference-impl/tools/lib/shared.mjs:77-79`, `REWRITE_RE` matches either a full path with no `?`/`#`,
  or a bare product prefix immediately followed by `?`/`#`. It has no branch for
  `/layer/integrations/microsoft-365#token-refresh`, contradicting its own docstring. Two dead links
  shipped into the 30-page proof (`layer/integrations/overview.mdx:97`, `layer/ai-usage-tracking.mdx:59`).
  **Preferred fix: adopt A1 (root serving) and delete the rewriting entirely.** If A1 is rejected, fix
  the regex and add a fragment-link test.
- **B2 — `Card` icon mapping is a naive kebab→PascalCase name match** against installed `lucide-react`.
  `apple` resolves to lucide's *fruit* icon, not a brand mark. Brand icons with no lucide equivalent
  (`aws`, `atlassian`, `google`, `microsoft`, `slack`) are dropped — on `layer/integrations/overview.mdx`
  that is **7 of 13 cards losing their icon**, a visible regression on a high-traffic page.
  **Required:** a curated icon map with real brand marks (e.g. `simple-icons`) for the integration
  cards, and an explicit deny-list so no false-positive name match ever ships.

**Unexercised paths (must be covered before the full port):**
- `CodeGroup → Tabs` — zero occurrences in `layer`; the corpus's only one is
  `routeshift/api/chat-completions.mdx`.
- Multi-tab nav in `docsjson-to-meta.mjs` — `overwatch`/`locus`/`routeshift` have a `Documentation`
  + `API reference` tab; only single-tab `layer` was exercised.
- Root `content/docs/meta.json` (cross-product top-level ordering) was never written.

### A3. Acceptance criteria for Workstream A
- `npm run build` passes with all 219 pages.
- Zero survivors when grepping ported output for `Note|Tip|Warning|Columns|AccordionGroup|CodeGroup|ParamField|ResponseField|Frame`.
- Every old URL resolves (A1).
- Codemod is idempotent (`diff -rq` clean on re-run).
- The 19 future-dated changelog entries are **deleted or re-dated**, and the Changelog nav entry points
  at the newest real entry. (Do not port the bug.)

---

## 6. Workstream B — Docs-generation agent

Replaces Mintlify's Agent/Automations. Reference: `reference-impl/pipeline/` (739-line driver, zero npm
deps, verified end-to-end against a sandbox git remote).

### B1. The cost/auth reality — **read this before designing**

Primary-sourced, and independently re-verified by a second agent that re-fetched every citation:

> **None of the three CLI subscriptions can drive unattended generation on a GitHub-hosted runner.
> All three require a separate metered API key in hosted CI.**

- **Claude Code Max** — OAuth token expires ~24h and `anthropics/claude-code-action` has no refresh
  input; the documented workaround is `anthropic_api_key`. (Upstream issue `anthropics/claude-code-action#727`, open.)
  This is *mechanically broken* for scheduled CI, not merely costly.
- **Codex** — OpenAI's Codex GitHub Action documents `OPENAI_API_KEY` as the only credential. No
  subscription path. (`openai/codex#34425` is an open feature request for one.)
- **Gemini** — `google-github-actions/run-gemini-cli` documents `GEMINI_API_KEY`.

**Therefore the pipeline must be two-mode:**

- **Mode 1 — `detect` + `notify` (DEFAULT, $0 marginal).** CI detects user-facing merged PRs via `gh`
  with **zero LLM calls** and notifies. The owner runs `npm run docs:sync` locally, where the CLI is
  already subscription-authenticated. This is the recommended default.
- **Mode 2 — `hosted` (opt-in, metered).** Runs the driver in CI with an API key.
  Estimated **~$0.02–0.19/PR, ~$1–10/month** at solo-team volume — directional, from 2026-07-22 list
  pricing, **not measured against a real bill**. Re-verify before budgeting.

A self-hosted runner on the owner's machine is a third option worth evaluating: it gets CI ergonomics
with subscription auth. Not prototyped.

### B2. Bugs found in the reference implementation — must fix

- **P1 — spurious PRs from unchanged content.** `pipeline/docs-agent.mjs:93`, `FILE_BLOCK_RE`:
  the `\r?\n===END===` consumes the file's trailing newline, so parsed content never ends with `\n`.
  The identical-content check at `docs-agent.mjs:524-528` (`existing === fb.content`) is therefore
  **always false** for a page the model faithfully reproduced unchanged — which is exactly what the
  driver's own prompt instructs it to do. Demonstrated: a byte-identical page opened a PR with a real
  commit. Fix the marker regex to preserve the trailing newline, and add a regression test that feeds
  back a file's exact on-disk bytes and asserts **no PR**.
- **P1 — hosted mode cannot open the cross-repo PR.** `pipeline/docs-agent.yml:181` sets
  `GH_TOKEN: ${{ github.token }}`, which is scoped to the *product* repo, but `docs-agent.mjs:562,639`
  run `gh pr list/create --repo <docs-repo>`. `DOCS_REPO_PAT` is wired into `actions/checkout`
  (line 152) but never into `GH_TOKEN`. The workflow's own comment at lines 148-151 states exactly why
  this is needed. Pass the PAT as `GH_TOKEN`.
- **P2 (probable, unconfirmed)** — the hosted job never sets `git config user.name/user.email` before
  `git commit` (`docs-agent.mjs:599`). `actions/checkout` does not set an identity and hosted runners
  typically lack one. Set it explicitly.

### B3. Behaviour that is already correct — preserve it
Verified by adversarial execution against a sandbox: lockfile/test exclusion; bounded timeout
(SIGTERM→SIGKILL); loud non-zero failure on empty stdout, non-zero backend exit, timeout, and malformed
output — **none of which open an empty PR**; legitimate no-op paths exit 0 without a PR; duplicate-PR
guard; debug logs written to a temp dir (never `process.cwd()`, so a stray `git add -A` can't sweep them
into a real commit).

### B4. Merge-path requirement (do not repeat the Mintlify failure)
- Enable `allow_auto_merge` on the docs repo.
- The pipeline opens **draft** PRs, batched **one per product per run** — never one PR per changed page.
- Add `actions/stale` so a backlog can never silently reach 178 again.
- Human review stays on until the pipeline has earned trust.

---

## 7. Workstream C — Search + search analytics

### C1. Search
Use Fumadocs' built-in static search (`app/api/search/route.ts`, already scaffolded). At 219 pages this
is free and needs no server. Do **not** introduce Algolia/Typesense/Meilisearch.

### C2. Analytics — use **PostHog**
**Rationale, from the existing stack (verified):**
- PostHog is **already wired in `axiomlayer`** — see
  `apps/axiom-layer/src/components/analytics/posthog-provider.tsx` (with a colocated test). It reverse-
  proxies through `b.axiomancer.io` to survive ad-blockers and has a `before_send` PII-redaction hook.
  **Copy this pattern; do not write a new one.**
- Amplitude is used in `axiom-locus` / `axiom-overwatch`; the marketing site has posthog + amplitude +
  mixpanel + sentry installed. PostHog is the one already doing product analytics in the product app.
- **Sentry is the wrong tool here** — it is error/perf monitoring, not product analytics. Don't use it
  for search telemetry.

**Implementation:** wrap Fumadocs' `SearchDialog` in a custom client component using
`useDocsSearch()` from `fumadocs-core/search/client`, which returns `{ search, setSearch, query }`.
Fire:
- `docs_search` — `{ query, resultCount, product }`, debounced (~500ms) so keystrokes aren't events.
- `docs_search_no_results` — when `query.data === 'empty'`. **This is the event that matters** — it is
  the direct replacement for the one Mintlify analytic worth keeping.
- `docs_search_result_click` — `{ query, url, position }`.

**Privacy:** search queries are free text and may contain customer identifiers. Apply the same
redaction discipline as `posthog-provider.tsx`. Do not enable session replay on the docs site.

**Acceptance:** a weekly PostHog insight listing top zero-result queries. That list is the input to the
next docs-writing cycle — it closes the loop that Mintlify's analytics used to close.

---

## 8. Cutover

**0. Burn down the ~7,000 remaining credits FIRST — but gated on a working merge path.**
   Order matters: (a) enable `allow_auto_merge` on the docs repo and flip
   `Update from code changes` to `automerge` only after one trusted run; (b) triage/close the 178-PR
   backlog so new output is visible; (c) run **one** `Update from code changes` automation and
   **measure the actual credit delta** — it is undocumented whether a batched run bills per-run or
   per-page-touched, and that swings the budget by an order of magnitude; (d) scale to the remaining
   products within the measured budget, reviewing and merging as you go.
   Rough ceiling if billing is per-run at ~180 credits/run: ~38 runs. Do not plan against that number
   until step (c) has measured it.
   Everything merged here is plain MDX and ports through the codemod — it is not throwaway work.
   **Stop generating the moment review falls behind.** Unmerged output is worth zero and recreates the
   exact failure this migration is meant to end.

1. Build and deploy to a preview domain; run the full URL diff (§A1) against the live Mintlify sitemap.
2. Port products in order: `layer` → `codex` → `locus` → `overwatch` → `routeshift` → `changelog`.
   (`layer` is already done in the PoC; `routeshift` carries the only `CodeGroup`.)
3. Verify `llms.txt` / `llms-full.txt` are non-empty and comparable to today's (current `llms-full.txt`
   is ~1.05 MB).
4. Cut `docs.axiomancer.io` DNS to Vercel.
5. **Keep the Mintlify deployment alive but unpublished for one billing cycle** as rollback.
6. Only after a green cycle: cancel Mintlify.

**Do not delete the 178 open PRs before cutover** — some contain content that never landed
(`layer/integrations/workday.mdx`, `microsoft-teams.mdx`, `assets.mdx` from PR #532 are missing from
`master` today). Triage for salvage first, then bulk-close.

---

## 9. Reference implementation

`./reference-impl/` — extracted from a working PoC, adversarially verified.

| Path | Lines | State |
|---|---|---|
| `tools/mintlify-to-fumadocs.mjs` | 396 | works; bugs B1/B2 |
| `tools/docsjson-to-meta.mjs` | 216 | works single-tab; multi-tab unexercised |
| `tools/lib/shared.mjs` | 129 | contains the B1 regex |
| `pipeline/docs-agent.mjs` | 739 | works; 2×P1 |
| `pipeline/docs-agent.yml` | 205 | YAML-valid; GH_TOKEN bug |
| `pipeline/README.md` | 256 | auth/cost research |
| `site-components/*` | — | shims, MDX registration, source config, package.json |

**Proven by execution, not assertion:** `npm run build` passed twice from clean, 102/102 static pages,
TypeScript clean; all 30 `layer` routes generated at correct URLs including `/layer` (not `/layer/index`);
`fd-step`/`fd-steps`/`data-accordion-value` markup present in rendered HTML; codemod idempotent.

Treat this as a **starting point, not a deliverable** — it is 30 of 219 pages and carries the four
listed bugs.

---

## 10. Cost basis (owner-supplied, as of 2026-07-22)

- **Mintlify Pro: $550/month = $6,600/year.**
- **Credit balance: ~7,000 credits remaining.**

Replacement run-cost: Vercel hosting (docs is another project on an existing account), generation via
already-authenticated local CLI ($0 marginal), PostHog free tier. Realistic incremental spend is
**~$0/month**, or ~$1–10/month if hosted generation mode (§6/B1) is enabled.

**Payback is immediate** — every month on Mintlify past cutover costs $550, so the migration should be
time-boxed rather than perfected. Re-verify the price against the current invoice before quoting it.

### Pre-migration credit burn-down (recommended — see §8 step 0)
Credits are use-it-or-lose-it and die with the subscription. Generated pages are **MDX in the repo**, so
anything produced now survives the migration and gets ported by the codemod. This is free content — but
only if it is **merged**. Review throughput, not credits, is the binding constraint (the 178-PR backlog
is the proof). Burn credits only behind a working merge path.

---

## 11. Deadline

**The startup discount ends September 2026** (owner-stated 2026-07-22) — roughly two months of
runway from spec date. Consequences for sequencing:

- Step 0 (credit burn-down, §8) and Workstream A (the port) **run concurrently**, not sequentially.
  There is not enough runway to finish one before starting the other, and they don't conflict:
  burn-down produces MDX in `smynkr/axiom-docs`, and the codemod re-runs over whatever has landed
  at port time.
- Target cutover **before** the September renewal so no month is paid at undiscounted rate.
- Time-box the port. At $550/month, polish that delays cutover costs more than it's worth — ship
  and iterate on the live site.

## 12. Open questions for the owner

1. Port the Intercom widget, or drop it?
3. Are the 19 future-dated changelog entries a roadmap that was mislabelled as history, or agent
   hallucination? Determines delete vs re-date.
4. Mode 1 (local `docs:sync`) vs a self-hosted runner — worth prototyping the runner?
