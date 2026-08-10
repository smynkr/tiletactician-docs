# Changelog re-date report

## Result

Re-dated the 42 fixture-verified updates from their 18 future-dated source
pages to the authoritative true ship dates. The two duplicate write-ups were
collapsed as directed, and the separate July 25 source page was also moved to
April 18 because the brief requires no changelog page after 2026-07-22.

The source corpus now has 421 `<Update>` blocks: the original 423 less the
two duplicate write-ups. No update content was removed except those two
duplicates.

## Per-file disposition

| Removed source | Destination(s) | Disposition |
|---|---|---|
| `2026-07-25` | `2026-04-18` | Moved all 3 updates. This page was outside the fixture's 18-page range but was authored April 18 and violated the cutoff. |
| `2026-08-01` | `2026-04-18` | Moved 1 update. |
| `2026-08-08` | `2026-04-18` | Moved 4 updates. |
| `2026-08-15` | `2026-04-18`, `2026-04-19` | Moved 7 updates to April 18 and the batch-upsert reliability update to April 19. |
| `2026-08-22` | `2026-04-19` | Moved 1 update. |
| `2026-08-29` | `2026-04-19` | Moved 1 update. |
| `2026-09-05` | `2026-04-19` | Moved 3 updates. Dropped the short AIS-retention write-up as the duplicate of item #20. |
| `2026-09-12` | `2026-04-18`, `2026-04-19` | Moved support chat and vessel-visit tracking to April 18; moved the detailed AIS-retention and platform-security updates to April 19. The source's destinations tie 2–2, so the redirect uses April 18 as the earlier destination. |
| `2026-09-19` | `2026-04-19` | Moved 1 update. |
| `2026-09-26` | `2026-04-19` | Moved 2 updates. |
| `2026-10-03` | `2026-04-19` | Moved 1 update. |
| `2026-10-10` | `2026-04-19` | Moved 1 update. |
| `2026-10-17` | `2026-04-19` | Moved 2 updates. |
| `2026-10-24` | `2026-04-19` | Moved encrypted Slack tokens and unified credential handling. Dropped item #32, the duplicate virtual-card ownership write-up. |
| `2026-10-31` | `2026-04-19` | Moved 1 update. |
| `2026-11-07` | `2026-04-19` | Moved 1 update. |
| `2026-11-14` | `2026-04-19` | Moved 1 update. |
| `2026-11-21` | `2026-04-20` | Moved 1 update. |
| `2026-11-28` | `2026-05-08`, `2026-05-01`, `2026-04-20`, `2026-05-07` | Moved GitHub governance and sidebar updates to May 8, Slack OAuth to May 1, vote tallies to April 20, and provider-authenticated virtual-card commits to May 7. |

All moved `<Update>` labels were changed to their destination dates. Existing
destination frontmatter and page structure were preserved.

## Duplicate and framing handling

- Item #20's detailed three-tier AIS retention text is the single retained
  write-up on April 19; item #18's shorter restatement was dropped.
- Item #32's virtual-card ownership text was dropped because it restates item
  #27 and does not describe a second fix.
- The AIS coverage entry now describes `AISSTREAM_BBOX_BUFFER_DEG` and
  `AISSTREAM_GLOBAL` as operator-configurable deployment environment
  settings, rather than implying a self-service dashboard setting.

## Redirect map

The removed slugs receive permanent redirects in `next.config.mjs`:

| Removed slug | Destination |
|---|---|
| `/changelog/2026-07-25` | `/changelog/2026-04-18` |
| `/changelog/2026-08-01` | `/changelog/2026-04-18` |
| `/changelog/2026-08-08` | `/changelog/2026-04-18` |
| `/changelog/2026-08-15` | `/changelog/2026-04-18` |
| `/changelog/2026-08-22` | `/changelog/2026-04-19` |
| `/changelog/2026-08-29` | `/changelog/2026-04-19` |
| `/changelog/2026-09-05` | `/changelog/2026-04-19` |
| `/changelog/2026-09-12` | `/changelog/2026-04-18` |
| `/changelog/2026-09-19` | `/changelog/2026-04-19` |
| `/changelog/2026-09-26` | `/changelog/2026-04-19` |
| `/changelog/2026-10-03` | `/changelog/2026-04-19` |
| `/changelog/2026-10-10` | `/changelog/2026-04-19` |
| `/changelog/2026-10-17` | `/changelog/2026-04-19` |
| `/changelog/2026-10-24` | `/changelog/2026-04-19` |
| `/changelog/2026-10-31` | `/changelog/2026-04-19` |
| `/changelog/2026-11-07` | `/changelog/2026-04-19` |
| `/changelog/2026-11-14` | `/changelog/2026-04-19` |
| `/changelog/2026-11-21` | `/changelog/2026-04-20` |
| `/changelog/2026-11-28` | `/changelog/2026-05-08` |

## Regeneration and build proof

- `node _migration/tools/run-migration.mjs`: passed; generated 219 pages,
  45 changelog pages, and anchor `/changelog/2026-07-19-weekly`.
- Generated changelog cutoff check: no `content/docs/changelog/*.mdx`
  filename is later than 2026-07-22.
- Generated update count: 421, matching the source count.
- `npm run build`: passed with Next.js 16.2.11. The build emitted the
  existing non-fatal dynamic-font download warning for the command-key glyph,
  but compiled, typechecked, generated all 605 static pages, and completed
  successfully.
