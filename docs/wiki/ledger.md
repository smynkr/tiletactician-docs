---
title: Durable ledger
category: current-state
updated: 2026-08-10
summary: Dated durable facts and their source anchors
nav_order: 130
sources: [".codex/harness-memory.json", "README.md", "package.json", "next.config.mjs", "docs.json", "_migration/tools/lib/shared.mjs", "components/brand/products.ts", "app/global.css", "public/logo.svg"]
---

# Durable ledger


## 2026-08-11 — Harness-memory conformance (audit FAIL → PASS)

- Added `docs/wiki/_schema.md` (schema + routing + capture contract; group_id
  boundary, content-boundary section, memory gates, Hindsight/Mem Palace
  fully-archived marker). The wiki previously had only index/current-state/
  ledger and failed the harness-memory audit on the missing schema and the
  missing archived-memory marker.
- AGENTS.md: added the Hindsight and Mem Palace fully-archived marker to
  Memory routing.
- Regenerated `docs/AGENT_SOT.md` + `docs/wiki/_sources.json`
  (`npm run memory:generate`); `npm run memory:check` passes and
  `audit-repo.mjs` reports PASS.

Re-establish with:

```bash
npm run memory:check
```
## 2026-08-11 — Review-lane fixes: identity regeneration and a11y

- content/docs regenerated: meta.json title is now TileTactician (llms.txt and
  search breadcrumbs were still "Axiomancer Labs"). Infolitico's generated
  tree also carried unprefixed links the migration rewrites — now in sync.
- FocusDeadEndHeading span -> div (valid HTML); 404 heading focus.
- Billing copy: 50 monthly credits is a Crossplay Pro entitlement (tiletactician).

Re-establish with:

```bash
npm run memory:check
```


## 2026-08-11 — Brand-completion and truth polish pass

Post-launch polish (one commit, deployed to main): removed every remaining
Axiom/other-brand surface and grounded the docs against the product repo.

- **Axiom leftovers removed:** the Open Graph card (`app/opengraph-image.tsx`)
  still rendered the Axiomancer "physical world, quantified" card (cyan
  signal, six-product row) — now the TileTactician card (void `#0A0A0F`,
  amber `#F59E0B`, tile mark, "Every legal play, ranked by score."); per-page
  metadata `siteName` was `Axiomancer Docs`; the 404 was Axiom-flavored
  ("signal not found", cyan constellation, "Back to the hub") — now
  board-metaphor ("tile not on the board", amber glow, "Back to the docs
  home"); `app/icon.svg` was the Infolitico flame mark — now the tile mark;
  `constellation.tsx` defaulted to cyan; `global.css` carried cyan
  badge/glow utilities plus dead Axiom rules (live badge, feed, word-in,
  five product accents) — amber now, dead rules removed.
- **Wrong-product leaks:** search-dialog and page-feedback support mailtos
  pointed at `support@menuwright.com` — now `support@tiletactician.com`;
  migration tooling comments and one test name referenced MenuWright.
- **Gate repair:** `npm run memory:check` failed (`.agents/checkpoints`
  missing, `docs/wiki/_sources.json` stale) — directory + gitignore added,
  memory surfaces regenerated; the gate now passes.
- **Content grounded against `smynkr/Crossplay-Pro`:** the FAQ's "pricing
  announced at launch" replaced with the app's live mechanics (Vision scan
  credits, 50/month, credit packs, ad-supported rack scans, Crossplay Pro
  $2.99/mo or $19.99/yr); board-scanning now documents the credit gate and
  the real "Show Scan" reference overlay (the docs previously described a
  nonexistent camera-projection "Live Board Overlay"); getting-started
  "New Board" → the real "Manual Entry"/"Scan Board" home actions; blank
  toggle "(the `?` button)" → the real "BLANK" label; the fabricated
  "Settings → Tile Distribution" removed (distribution is a fixed 100-tile
  bag for both formats).
- **Duplication:** every page's body led with a sentence identical to its
  frontmatter description, which `DocsDescription` already renders — ledes
  removed from all nine pages.
- Verified: migration deterministic, 22 link/contract tests, links:check,
  types:check, production build, and browser QA (desktop + 390px, dark
  theme, search empty state, 404, OG card render). Note for sibling repos:
  `menuwright-docs`, `infolitico-docs`, and `dontdiefishing-docs` carry the
  same unrebranded Axiom OG card and wrong-product mailto leaks; fixing them
  is a cross-repo follow-up (the shared template's
  `app/opengraph-image.tsx`, `components/page-feedback.tsx`, and
  `components/docs-search-dialog.tsx` all need the same treatment).

Re-establish with:

```bash
node _migration/tools/run-migration.mjs
npm run test:links
npm run links:check
npm run types:check
npm run build
npm run memory:check
```

## 2026-08-10 — Standalone TileTactician docs site rebuilt on the shared template

- New public repo `smynkr/tiletactician-docs` (Fumadocs, same template as
  `menuwright-docs` / `infolitico-docs` / `dontdiefishing-docs`): canonical
  `tiletactician/` MDX, deterministic generation, fail-closed contract tests,
  related-guide wayfinding, clean-URL rewrites, and TileTactician brand
  (amber `#F59E0B` signal on a `#0A0A0F` void, custom tile mark).
- The previous site (`docs-tiletactician` Vercel project, source not in any
  accessible repo) served nine Fumadocs pages; all nine were ported
  verbatim to the new site (getting-started, board-entry, board-scanning,
  rack-analysis, endgame, tile-bag, share-extension, faq, changelog) plus a
  new landing page. Brand accent taken from the old site's theme
  (`--color-tt-accent: #f59e0b`) and the app's dark-first UI
  (`#0a0a0f` splash, `userInterfaceStyle: dark`).
- Evidence asset: `public/screenshots/tiletactician.png` is a live capture of
  the public product landing at tiletactician.com (CrossPlayer Pro).
- Deployed on the pre-existing `docs-tiletactician` Vercel project (Node 24)
  with `docs.tiletactician.com`; verified live: clean routes, related guides,
  OG/twitter templating, llms.txt, sitemap, desktop and 390px layouts, theme
  toggle.
- docs-agent: `pipeline/docs-agent.yml` in this repo is product-parameterized;
  the `Crossplay-Pro` product repo is the wiring target for the workflow
  (workflow + `DOCS_AGENT_GLM_API_BASE`/`DOCS_AGENT_GLM_MODEL` variables, with
  `DOCS_REPO_PAT`/`GLM_API_KEY` secrets pending owner setup, same as the other
  three product repos).

Re-establish with:

```bash
node _migration/tools/run-migration.mjs
npm run test:links
npm run links:check
npm run types:check
npm run build
npm run memory:check
```
