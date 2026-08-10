---
title: Durable ledger
category: current-state
updated: 2026-08-10
summary: Dated durable facts and their source anchors
nav_order: 130
sources: [".codex/harness-memory.json", "README.md", "package.json", "next.config.mjs", "docs.json", "_migration/tools/lib/shared.mjs", "components/brand/products.ts", "app/global.css", "public/logo.svg"]
---

# Durable ledger

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
