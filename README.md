# TileTactician Docs

Standalone Fumadocs documentation site for [TileTactician](https://tiletactician.com),
served at [docs.tiletactician.com](https://docs.tiletactician.com).

- **Canonical content:** flat MDX in `tiletactician/` + `docs.json` (navigation).
- **Generated output:** `content/docs/` via `node _migration/tools/run-migration.mjs`
  (deterministic; unmapped Card icons fail generation).
- **Clean URLs:** `/` and `/getting-started` … `/changelog` rewrite onto the
  `tiletactician/*` routes (`next.config.mjs`).
- **Automation:** the `Crossplay-Pro` product repo drafts doc PRs into this
  repository via the docs-agent pipeline (`pipeline/docs-agent.yml`).
- **Gates:** `npm run test:links`, `npm run links:check`, `npm run types:check`,
  `npm run build`, `npm run memory:check`.

## Development

```bash
npm ci
npm run dev
```

## Docs PRs from product changes

See `pipeline/README.md` for the docs-agent driver and the workflow template
installed in the product repo.
