# Axiom Docs — Agent Source of Truth (AGENT_SOT)

<!-- GENERATED FROM docs/wiki/ BY scripts/sot_wiki/wiki_to_agent_sot.py — DO NOT EDIT BY HAND.
     Regenerate: python3 scripts/sot_wiki/wiki_to_agent_sot.py --out docs/AGENT_SOT.md -->

**Audience: agents.** This is a generated index; [`docs/wiki/`](wiki/) is canonical.

## Read FIRST — source-of-truth precedence

Use live systems to verify volatile claims. `docs/wiki/` is the canonical
durable memory. For durable context, use [`wiki/ledger.md`](wiki/ledger.md) and [`wiki/current-state.md`](wiki/current-state.md).
The canonical order is live systems > dated wiki ledger > session checkpoint >
wiki synthesis > Graphiti episodic context > scratch files. Graphiti calls use
only `group_id=tiletactician-docs` and never override the wiki.

## Active alerts

See [`wiki/index.md`](wiki/index.md) for current cross-cutting alerts.

## Wiki pages

| Topic | Page | What it answers |
|---|---|---|
| Wiki schema | [`wiki/_schema.md`](wiki/_schema.md) | Wiki schema, routing, and capture contract |
| Current state | [`wiki/current-state.md`](wiki/current-state.md) | Current repository-owned topology and content boundary |
| Durable ledger | [`wiki/ledger.md`](wiki/ledger.md) | Dated durable facts and their source anchors |
