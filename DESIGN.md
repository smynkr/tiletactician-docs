# Design

## Source of truth

- **Status:** Active
- **Last refreshed:** 2026-08-10
- **Primary product surface:** TileTactician (CrossPlayer Pro) — Scrabble and
  NYT Crossplay board analysis at `docs.tiletactician.com`.
- **Evidence reviewed:** the pre-rebuild docs site (`docs.tiletactician.com`
  — nine pages), the product landing at `tiletactician.com`, the product repo
  `smynkr/Crossplay-Pro` (`app.json` dark-first UI, `#0a0a0f` splash), the old
  site's theme tokens (`--color-tt-accent: #f59e0b`), and the shared template
  (menuwright-docs / infolitico-docs / dontdiefishing-docs).
- **Decision record:** standalone product docs sites design doc in
  `axiom-docs/docs/superpowers/specs/2026-08-10-standalone-product-docs-sites-design.md`.

## Brand

- **Personality:** Precise, calm, game-board-at-night, quietly premium —
  the app is dark-first, so the docs are too.
- **Trust signals:** Truthful product-specific routes, evidence-backed product
  previews, changelog visibility, copyable code, explicit external-link
  semantics, restrained motion.
- **Avoid:** Generic SaaS gradients, noisy decoration, marketing language that
  outpaces the documentation, tiny action targets, competing navigation trees.

## Product goals

- **Goals:** Get a player from install to first ranked analysis fast; explain
  how scoring, ranking, scanning, and endgame solving actually behave; make
  deep reference work reliable (search, copy, navigation).
- **Non-goals:** Replace the product landing at tiletactician.com; add a
  second design system; change routes or generated-content boundaries.
- **Success signals:** Faster guide selection [inferred]; clearer primary
  action recognition [inferred]; comfortable mobile and keyboard interaction
  [confirmed requirement]; no regression in technical-page reading flow
  [confirmed requirement].

## Personas and jobs

- **Primary personas:** Players entering a board mid-game; players learning
  tournament strategy (coach mode, blunder bar); players debugging an import
  or score mismatch; returning readers checking what changed.
- **User jobs:** Install and run a first analysis; enter or scan a board
  accurately; understand why a score or ranking differs from expectation;
  use the Share Extension; learn endgame and bag-tracking strategy.
- **Key contexts of use:** On-device at the table (mobile), desktop reference
  checks, keyboard-first search/navigation, AI-assisted documentation
  workflows.

## Information architecture

- **Primary navigation:** Fumadocs sidebar with four groups — Get started
  (landing, getting-started), Game analysis (board-entry, board-scanning,
  rack-analysis, endgame, tile-bag), App (share-extension), Support (faq,
  changelog).
- **Core routes/screens:** `/` (landing), the nine clean page URLs, `/llms.txt`,
  `/llms-full.txt`, per-page markdown routes, and search.
- **Content hierarchy:** Landing hero/evidence → guide cards; technical page
  title/actions → body → feedback → adjacent-page navigation.

## Design principles

1. **Signal before spectacle:** one clear action and one clear hierarchy
   before any visual effect.
2. **Instrument, do not decorate:** every visual treatment needs a wayfinding
   or trust purpose.
3. **Product identity, shared template:** the amber signal differentiates the
   product while the template keeps the shell coherent across the four
   standalone docs sites.
4. **Parity across input modes:** pointer, keyboard, touch, reduced-motion,
   and screen-reader users receive equivalent information and affordances.
5. **Preserve technical flow:** technical pages prioritize scanability, code
   access, and route stability.

## Visual language

- **Color:** Dark void `#0A0A0F` by default (the app's own splash
  background); paper-like light theme; amber `#F59E0B` as the single signal
  color (links, accents, rings); neutral borders for structure.
- **Typography:** Inter for body/UI, JetBrains Mono for code/data, Playfair
  Display only for the page-title display moment.
- **Spacing/layout rhythm:** Deliberate section rhythm, readable content
  width, compact but comfortable controls, cards with clear primary/secondary
  hierarchy.
- **Shape/radius/elevation:** Restrained rounded surfaces, hairline borders,
  one accent edge, shallow layered elevation.
- **Motion:** Interactions are short and purposeful; decorative motion is
  disabled/minimized under `prefers-reduced-motion: reduce`.
- **Imagery/iconography:** Evidence-backed product screenshot
  (`public/screenshots/tiletactician.png` — live capture of the product
  landing), the tile mark (`public/logo.svg` / `favicon.svg`), Lucide icons
  for semantics.

## Components

- **Reused from the shared template:** `ProductPreview`, `ProcessFlow`,
  `Mermaid` (fail-closed fallback), `RelatedGuides`, `DocsSearchDialog`,
  `PageFeedback`, `Intercom` (shared workspace `okr3tqrw`, parity with the
  other docs sites), Fumadocs page actions, `fd-*` theme variables.
- **Product-specific:** `components/brand/products.ts` carries the single
  identity source (name, `#F59E0B` accent, Grid2x2 icon, product-site
  destination); `app/global.css` carries the amber theme; the Open Graph
  card (`app/opengraph-image.tsx`) and the 404 page render the same identity
  (void, amber signal, tile mark).
- **Removed vs the Axiom stack:** Axiom hub components, product grid, and
  the Axiom brand surfaces (cyan signal, constellation copy, Axiomancer
  metadata). PostHog plumbing is shared with the other docs sites and is
  live on the deployed site via `NEXT_PUBLIC_POSTHOG_KEY`.

## Accessibility

- **Target standard:** WCAG 2.2 AA intent for contrast, keyboard access,
  semantics, and target sizing.
- **Keyboard/focus behavior:** Visible `focus-visible` rings; focus-within
  card parity; no hover-only actions; preserve search/sidebar/page-action
  keyboard flows.
- **Contrast/readability:** Amber must not be the only state signal; muted
  copy remains readable against both themes; code and tables retain
  scanability.
- **Reduced motion:** disable/minimize decorative animation and
  utility-class transforms when `prefers-reduced-motion: reduce` is active.

## Responsive behavior

- **Supported breakpoints:** desktop documentation layouts and narrow mobile
  widths including 390px; Fumadocs mobile drawer behavior remains
  authoritative.
- **Layout adaptations:** cards stack on narrow screens; hero highlights
  wrap; compact links use comfortable touch targets.
- **Touch/hover differences:** touch must not require hover to reveal
  meaning.

## Content voice

- **Tone:** Direct, evidence-first, calm, technically credible.
- **Terminology:** "TileTactician" for the app brand, "CrossPlayer Pro" for
  the product repo/site identity where it appears; distinguish documentation
  links from product-site links.
- **Microcopy rules:** one clear action label per card; secondary links use
  concise nouns; avoid claims unsupported by the app (pricing lives in the
  app — Crossplay Pro subscription and Vision scan credits are documented as
  in-app behavior, not as a promise; performance figures come from the docs
  and the product repo).

## Implementation constraints

- **Framework/styling system:** Next.js App Router, React, Fumadocs, Tailwind
  utilities, `app/global.css`.
- **Design-token constraints:** reuse `fd-*` variables and the amber signal;
  do not add a parallel token system.
- **Performance constraints:** keep decorative canvas bounded; avoid new
  client-side state or heavyweight dependencies for presentational polish.
- **Compatibility constraints:** canonical flat MDX in `tiletactician/` +
  `docs.json` remain authoritative; `content/docs/` is generated; keep the
  clean-URL rewrite list in `next.config.mjs` in sync with canonical routes.
- **Test/screenshot expectations:** run migration, links, types, and
  production build; inspect desktop/mobile browser states and reduced motion
  before completion.

## Open questions

None for the approved rebuild scope.
