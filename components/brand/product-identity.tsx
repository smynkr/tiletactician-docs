import type { ProductIdentity } from './products';

/**
 * The product-index nameplate: a lit emblem in the product's accent sitting
 * above the page title, so the threshold into each product carries its
 * identity color — the one thing the brand-neutral title block otherwise
 * lacks. The emblem mirrors the hub card icon and the product-app brand mark
 * (accent-tinted tile + glyph) and sits on a soft, steady accent halo: a point
 * of light in the void, the brand's core metaphor. The halo is deliberately
 * steady, not pulsing — in this brand a pulse means live telemetry (the live
 * badge), so a breathing emblem would mislabel a static identity as a live
 * signal. A trailing accent hairline completes the nameplate and echoes the
 * hub card's accent edge.
 *
 * Rendered only on the product index pages (the caller matches
 * product.match against the page url); deep pages, the hub, and the changelog
 * stay quiet. The whole lockup is decorative — the Playfair h1 below it already
 * names the product to assistive tech — so it is hidden from the accessibility
 * tree. Server-only: no client JS, no hydration surface.
 */
export function ProductIdentityMark({ product }: { product: ProductIdentity }) {
  const { accent, icon: Icon } = product;
  return (
    <div aria-hidden="true" className="not-prose mb-5 flex items-center gap-3">
      <span className="relative inline-flex">
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -inset-1.5 rounded-2xl blur-md"
          style={{ background: `radial-gradient(circle, ${accent}40, transparent 70%)` }}
        />
        <span
          className="relative flex h-10 w-10 items-center justify-center rounded-xl border"
          style={{ color: accent, borderColor: `${accent}40`, background: `${accent}12` }}
        >
          <Icon className="h-5 w-5" strokeWidth={1.8} />
        </span>
      </span>
      <span
        aria-hidden="true"
        className="h-px w-24 sm:w-32"
        style={{ background: `linear-gradient(to right, ${accent}66, transparent)` }}
      />
    </div>
  );
}
