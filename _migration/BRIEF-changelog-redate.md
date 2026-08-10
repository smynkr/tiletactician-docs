# BRIEF — Changelog re-date: fix the 18 future-dated pages

An investigation (`_migration/fixtures/changelog-verdicts.md` — READ IT FULLY FIRST) proved all 42
`<Update>` items in the 18 changelog pages dated 2026-08-01..2026-11-28 are REAL shipped work that a
docs agent stamped with bogus future dates. Owner decision: **re-date to true ship dates, delete
nothing, merge the two duplicate write-ups.** Today is 2026-07-22; after this task no changelog page
may carry a date later than 2026-07-22.

## Ground rules
- Work on the SOURCE pages `changelog/*.mdx` (repo root). After editing sources, regenerate
  `content/docs/` by running `node _migration/tools/run-migration.mjs` — never hand-edit the
  generated copies.
- You have NO network access and cannot run git commits (the orchestrator commits).
- The verdicts table's "True ship date" column is authoritative. Where a file's items have several
  true dates, place each `<Update>` block on its own true date.

## Steps
1. For each of the 18 future-dated source files: move its `<Update>` blocks to the source file for
   the TRUE date. **Collisions are expected** (e.g. `changelog/2026-04-18.mdx`, `2026-04-19.mdx`,
   `2026-04-20.mdx` already exist): append the moved blocks into the existing page for that date,
   keeping that page's structure/frontmatter; do not duplicate page titles. If no page exists for a
   true date, create one matching the sibling pages' format (frontmatter + `<Update>` blocks).
   Update each moved block's `label`/date text to the true date. Then delete the now-empty
   future-dated source file.
2. **Duplicates (verdicts table):** item #32 (2026-10-24 "virtual card ownership") restates #27 —
   drop #32, do not move it. Item #20 (2026-09-12 tiered AIS retention) restates #18 (2026-09-05) —
   keep ONE merged write-up on the true date (2026-04-19), preferring the more accurate/detailed text.
3. **Framing fix (verdict #17):** the "Configurable AIS coverage settings" text presents an operator
   environment flag as a self-service setting. Reword minimally so it is honest (operator-configurable
   deployment setting), keeping it on its true date.
4. **Redirects:** the 18 removed slugs (`/changelog/2026-08-01` … `/changelog/2026-11-28`) are live,
   indexed URLs today. Add `redirects()` entries in `next.config.mjs` — permanent redirect from each
   removed slug to the page now holding its content (the true-date page that received most of that
   file's items).
5. Regenerate (`node _migration/tools/run-migration.mjs`), then `npm run build` — must pass. Confirm
   with a grep that no `content/docs/changelog/` page is dated after 2026-07-22 and the changelog
   nav still points at the newest real entry.
6. Write `_migration/reports/changelog-redate-report.md`: per-file disposition (moved where, merged
   with what), the redirect map, duplicate/framing handling, build proof. Honest failure reporting
   beats false success.
