---
title: Wiki schema
category: schema
updated: 2026-08-11
summary: Wiki schema, routing, and capture contract
nav_order: 10
---

# Wiki schema

Each page has `title`, `category`, and `updated` frontmatter. Content pages
also list repository-relative `sources`. Use wikilinks for relationships so
the deterministic linter can check the graph.

`docs/wiki/_sources.json` is a generated inventory of those source paths,
their wiki consumers, and their SHA-256 digests. The all-PR memory gate
compares it with live repository content so an anchored source change cannot
silently bypass memory review. Regenerate it with `npm run memory:generate`;
do not edit it by hand.

`docs/wiki/` is the canonical durable memory for repository facts, decisions,
runbooks, and false narratives. It does not store credentials, personal data,
or volatile external state. Put a command that can re-check a volatile claim
in a re-verify list rather than recording its value here.

The source order is live systems > dated [[ledger]] > session checkpoint > wiki
synthesis > Graphiti > scratch. Update this wiki before a Graphiti episode;
record the page, heading, revision provenance, and re-verification command.
Every Graphiti read and write uses exactly `group_id=tiletactician-docs`; it never
overrides the wiki.


Hindsight and Mem Palace are fully archived. Do not query them, write them, use them
for orientation/resume, or accept them as gate satisfaction. Historical exports are
inert evidence only.
## Content boundary

Flat MDX in `tiletactician/` plus `docs.json` are canonical; `content/docs/` is
generated output — never edit it directly. After canonical-content edits run
`node _migration/tools/run-migration.mjs`, `npm run test:links`,
`npm run types:check`, `npm run build`.

## Memory gates

Regenerate derived surfaces (`docs/AGENT_SOT.md`, `docs/wiki/_sources.json`)
with `npm run memory:generate`, then verify with `npm run memory:check` (wiki
lint, reindex, source inventory, SOT sync, harness-memory audit). Never
hand-edit generated files.
