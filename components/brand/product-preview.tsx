import type { LucideIcon } from 'lucide-react';

export interface ProductPreviewHighlight {
  text: string;
  /** Marker icon as a lucide component (same shape as PRODUCTS `icon`). */
  icon?: LucideIcon;
}

interface ProductPreviewProps {
  src: string;
  alt: string;
  caption: string;
  accent: string;
  highlights: Array<ProductPreviewHighlight | string>;
}

/** A product screenshot paired with the few facts readers need before diving in. */
export function ProductPreview({ src, alt, caption, accent, highlights }: ProductPreviewProps) {
  return (
    <figure className="not-prose my-8 overflow-hidden rounded-2xl border border-fd-border bg-fd-card shadow-2xl shadow-black/10">
      <div className="grid lg:grid-cols-[minmax(0,1.6fr)_minmax(15rem,0.8fr)]">
        <div className="relative border-b border-fd-border lg:border-r lg:border-b-0">
          <div aria-hidden="true" className="absolute inset-x-0 top-0 h-0.5" style={{ backgroundColor: accent }} />
          <img
            src={src}
            alt={alt}
            className="aspect-[16/10] h-full w-full object-cover object-top"
            loading="eager"
            fetchPriority="high"
            decoding="async"
          />
        </div>
        <div className="flex flex-col justify-between p-5 sm:p-6">
          <ul className="space-y-4" aria-label={`${caption} highlights`}>
            {highlights.map((highlight) => {
              const item = typeof highlight === 'string' ? { text: highlight } : highlight;
              const Icon = item.icon;
              return (
                <li key={item.text} className="flex gap-3 text-sm leading-6 text-fd-muted-foreground">
                  {Icon ? (
                    <span
                      aria-hidden="true"
                      className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border"
                      style={{ borderColor: `${accent}66`, color: accent, backgroundColor: `${accent}14` }}
                    >
                      <Icon className="size-3" />
                    </span>
                  ) : (
                    <span
                      aria-hidden="true"
                      className="mt-2 h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: accent }}
                    />
                  )}
                  <span>{item.text}</span>
                </li>
              );
            })}
          </ul>
          <div className="mt-6 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.12em] text-fd-muted-foreground">
            <span aria-hidden="true" className="h-px w-7" style={{ backgroundColor: accent }} />
            Product preview
          </div>
        </div>
      </div>
      <figcaption className="border-t border-fd-border px-5 py-3 text-sm leading-6 text-fd-muted-foreground sm:px-6">
        {caption}
      </figcaption>
    </figure>
  );
}
