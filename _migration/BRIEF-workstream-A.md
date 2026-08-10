# BRIEF — Workstream A+C: Fumadocs site build + full 219-page port

You are implementing the site-migration workstream of a Mintlify→Fumadocs migration.
Read `_migration/SPEC.md` §2 (ground truth), §4 (architecture), §5 (Workstream A), §7 (Workstream C)
before writing code. The spec's findings are verified — do NOT re-derive them.

## Workspace layout (already prepared for you)
- Repo root = a Next.js Fumadocs app (scaffolded from `create-fumadocs-app`, template
  `+next+fuma-docs-mdx`, search=orama, og-image=next-og). `node_modules` is installed —
  **you have NO network access; never run npm install**. If a dependency is genuinely missing,
  write the exact package list to `_migration/reports/MISSING-DEPS.txt`, commit what you have, and stop.
  `posthog-js` and `@icons-pack/react-simple-icons` are preinstalled for R3/R8.
- Original Mintlify content (the codemod SOURCE — leave in place, never edit):
  `./layer ./overwatch ./locus ./routeshift ./codex ./changelog ./index.mdx ./changelog.mdx ./docs.json`
- `_migration/reference-impl/tools/` — the codemod to port (works, carries known bugs below).
- `_migration/reference-impl/site-components/` — shims, MDX component registration, source config,
  package.json fragments from the verified PoC. Integrate them into the scaffold.
- `_migration/reference-impl/pipeline/` — NOT yours; another lane owns it. Do not touch.
- `_migration/fixtures/live-sitemap.xml` — the live site's sitemap (ground truth for R10).
- `_migration/fixtures/posthog-provider.reference.tsx` — the PII-redaction/reverse-proxy PostHog
  pattern to replicate for R8.

Git: you are on branch `fumadocs-migration`. Commit in logical units as you go
(`git config user.name "codex-lane" / user.email "codex@local"` first). NEVER push. NEVER touch
`master`. Do not delete the original Mintlify content dirs.

## Requirements

**R1 — Serve at ROOT (URL preservation, required).** `loader({ baseUrl: '/' })` in `lib/source.ts`.
Use a **required** catch-all `app/[...slug]/page.tsx` (an optional catch-all collides with
`(home)/page.tsx`). `/` must render the ported `index.mdx` content — implement `(home)/page.tsx` to
render the root docs page via the same source loader (e.g. `source.getPage([])`). Every existing URL
(`/layer/integrations/aws` etc.) must resolve byte-identically — no `/docs` prefix anywhere.

**R2 — Delete internal-link rewriting entirely** (spec bug B1 is designed out by R1). Strip the
`REWRITE_RE` logic from the ported `lib/shared.mjs`; internal links stay `/layer/...` verbatim.

**R3 — Fix spec bug B2 (Card icons).** Replace the naive kebab→PascalCase lucide lookup with:
(a) a curated brand-icon map using `@icons-pack/react-simple-icons` for brand names appearing in the
corpus (`aws`, `atlassian`, `google`, `microsoft`, `slack`, `apple`, `github`, `okta`, etc. — grep the
corpus for actual `icon=` values and cover ALL of them); (b) lucide only for generic concepts, via an
explicit allow-map — never a blind name match; (c) unknown icon → render card without icon + append a
line to `_migration/reports/unmapped-icons.txt`. Acceptance: `layer/integrations/overview` renders all
13 cards with correct brand marks; `apple` is the Apple logo, not a fruit.

**R4 — Close the codemod's unexercised paths.**
- `CodeGroup → Tabs`: the corpus's only occurrence is `routeshift/api/chat-completions.mdx` — port it
  and verify the rendered output has working tabs.
- Multi-tab nav in `docsjson-to-meta.mjs`: `overwatch`, `locus`, `routeshift` have `Documentation` +
  `API reference` tabs in `docs.json`; generate correct per-product `meta.json` for them (only
  single-tab `layer` was ever exercised).
- Root `content/docs/meta.json`: cross-product top-level ordering derived from `docs.json`.

**R5 — Changelog.** Port all 64 changelog pages INCLUDING the 19 future-dated ones **as-is** (a
separate investigation decides their fate — do not re-date or delete them in this lane). But do NOT
port the nav bug: the Changelog nav/anchor entry must point at the newest entry dated ≤ 2026-07-22,
not at `/changelog/2026-11-28`.

**R6 — `Update` label shim** for changelog entries (reference-impl has one — port/adapt it).

**R7 — Intercom widget (owner decision: PORT).** Read `integrations.intercom.appId` from `docs.json`.
Add a small client component that loads the standard Intercom snippet with that appId on all pages.
Hardcoding the appId value into the component is fine (it is public), but leave a comment naming its
source. No other Intercom config.

**R8 — PostHog search analytics (spec §7 C2).** Wrap the search dialog with a client component using
`useDocsSearch()` from `fumadocs-core/search/client`. Events:
- `docs_search` — `{ query, resultCount, product }`, debounced ~500ms (keystrokes are not events).
- `docs_search_no_results` — fired when `query.data === 'empty'`. This is the event that matters.
- `docs_search_result_click` — `{ query, url, position }`.
Replicate the reference fixture's pattern: reverse-proxy host (`https://b.axiomancer.io`),
`before_send` PII redaction of emails/tokens in properties, no autocapture beyond what the reference
does, **no session replay**. Key from `NEXT_PUBLIC_POSTHOG_KEY`; the component must no-op cleanly
when the env var is unset (local/CI builds must not error or warn loudly).

**R9 — Full-corpus port.** Run the (fixed) codemod over ALL products + changelog into `content/docs/`.
Acceptance, all mandatory:
- `npm run build` passes with all 219 pages.
- Zero survivors: `grep -rE '<(Note|Tip|Warning|Columns|AccordionGroup|CodeGroup|ParamField|ResponseField|Frame)[ >]' content/docs` → empty.
- Idempotent: re-run the codemod, `diff -rq` between first and second output is clean.

**R10 — URL parity (spec §A1 acceptance).** Extract every URL path from
`_migration/fixtures/live-sitemap.xml`; compare against the built route list. Write
`_migration/reports/url-parity.md`: every sitemap path missing from the build is listed loudly as a
REGRESSION; build-only paths listed as additions. Goal: zero regressions.

**R11 — `llms.txt` / `llms-full.txt`** routes render non-empty; note their sizes in the report
(live `llms-full.txt` is ~1.05 MB — same order of magnitude expected).

**R12 — Final report.** `_migration/reports/workstream-a-report.md`: what you did per requirement,
build output tail, grep/idempotency/parity proofs, anything unresolved. Honest about failures —
an accurate failure report beats a false success claim.

## Verification discipline
Run `npm run build` yourself and read its output; do not claim green without it. Test the actual
rendered HTML of at least: `layer/integrations/overview` (R3), `routeshift/api/chat-completions` (R4),
one changelog page (R5/R6), `/` (R1). `npx next start` + curl, or inspect the prerendered output in
`.next/server/app`.
