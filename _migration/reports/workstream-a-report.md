# Workstream A+C migration report

## Result

The Mintlify corpus is ported into a root-served Fumadocs site. The final production build is green and generates all 219 documentation pages.

## Requirements completed

- **R1–R2:** `lib/source.ts` uses `loader({ baseUrl: '/' })`; `app/[...slug]/page.tsx` is a required catch-all and `(home)/page.tsx` renders `source.getPage([])`. The codemod retains existing site-absolute links and does not rewrite a `/docs` prefix.
- **R3:** `BrandIcon` maps every source `Card icon` value through a curated brand/generic allow-list. Google, Atlassian, and Apple use the installed `@icons-pack/react-simple-icons`; AWS, Microsoft, and Slack use local brand marks because their exports are absent from the installed package. Unknown values remove the icon and append to `unmapped-icons.txt`. The report has no unknown values. `layer/integrations/overview` contains all 13 migrated cards.
- **R4:** The only `CodeGroup`, `routeshift/api/chat-completions`, becomes `Tabs` with cURL, SDK, and OpenAI Python tabs. Product `meta.json` generation supports the multi-tab Overwatch, Locus, and RouteShift navigation; the root meta preserves `docs.json` product ordering.
- **R5–R6:** All 64 changelog pages, including future-dated entries, are ported unchanged in date. The Changelog navigation target is `/changelog/2026-07-19-weekly`, the newest entry dated on or before 2026-07-22. The local `Update` shim renders labels and tags.
- **R7:** The root layout loads the Intercom widget with the public app ID from `docs.json` (`okr3tqrw`).
- **R8:** The custom client search dialog uses `useDocsSearch()` and emits debounced `docs_search`, zero-result `docs_search_no_results`, and `docs_search_result_click` events. The PostHog provider uses the `https://b.axiomancer.io` proxy, redacts emails/tokens before sending, has no session replay configuration, and is a quiet no-op when `NEXT_PUBLIC_POSTHOG_KEY` is unset.
- **R9:** `_migration/tools/run-migration.mjs` regenerates 219 pages from the untouched source corpus through a staging directory. The forbidden Mintlify-component grep is empty. A second generated output was byte-identical (`diff -rq` clean).
- **R10:** URL parity is recorded in `url-parity.md`: 152 live sitemap paths, 219 built documentation paths, and **0 regressions**. The 67 additions are documented, including all required historical/future changelog pages.
- **R11:** Production HTTP checks returned non-empty LLM routes: `/llms.txt` is 50,138 bytes; `/llms-full.txt` is 1,619,593 bytes.

## Verification evidence

```text
npm run types:check
✓ Types generated successfully

npm run build
✓ Compiled successfully
✓ Generating static pages using 10 workers (662/662)
```

Production-server HTTP checks:

```text
/                                  200  155689 bytes
/layer/integrations/overview       200  215726 bytes
/routeshift/api/chat-completions   200  204023 bytes
/changelog/2026-07-19-weekly       200  194551 bytes
/llms.txt                          200   50138 bytes
/llms-full.txt                     200 1619593 bytes
```

## Migration-only repairs and limitations

- The immutable source corpus contains two changelog pages with an unclosed `Update` wrapper and two literal `{...}` prose placeholders. The codemod repairs these only in generated output so MDX can render; source files were not edited.
- Next reports a non-fatal Fumadocs dynamic-font warning for the command-key glyph during static generation; it does not affect build completion or page rendering.
- The workspace exposes `.git` as read-only. Setting the requested local commit identity and creating the brief's logical commits were therefore not possible in this environment. No push was attempted.
