# TileTactician Docs agent guide

## Memory routing

1. Read `.codex/harness-memory.json`; the project is `tiletactician-docs` and
   the only permitted Graphiti group is `group_id=tiletactician-docs`.
2. Read generated `docs/AGENT_SOT.md`.
3. Follow it into canonical `docs/wiki/` before broad repository searches.

Precedence: live systems > dated wiki ledger > session checkpoint > wiki
synthesis > Graphiti episodic context > scratch files. `docs/wiki/` is the
canonical durable memory.

## Content invariant

Flat MDX in `tiletactician/` plus `docs.json` are canonical; `content/docs/` is
generated output — never edit it directly. After canonical-content edits, run:

```bash
node _migration/tools/run-migration.mjs
npm run test:links
npm run types:check
npm run build
```

The site serves clean URLs via `next.config.mjs` rewrites; keep the
`tiletactician/**` route prefix in canonical content and the rewrite list in
sync.

## Memory verification

```bash
python3 scripts/sot_wiki/wiki_lint.py docs/wiki
python3 scripts/sot_wiki/wiki_reindex.py --check docs/wiki
python3 scripts/sot_wiki/wiki_index.py --check docs/wiki/_sources.json docs/wiki
python3 scripts/sot_wiki/wiki_to_agent_sot.py --check docs/AGENT_SOT.md docs/wiki
python3 scripts/sot_wiki/audit_harness_memory.py --repo .
python3 -m unittest discover -s scripts/sot_wiki -p 'test_*.py'
```

The combined repository gate is `npm run memory:check`. Regenerate derived
memory surfaces with `npm run memory:generate`; never hand-edit
`docs/AGENT_SOT.md`.
