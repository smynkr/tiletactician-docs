import Link from 'next/link';
import { ArrowLeft, ArrowRight, CornerUpLeft } from 'lucide-react';
import type { RelatedGuide, RelatedGuidesData } from '@/lib/page-context';

const DIRECTIONS = {
  back: {
    label: 'Documentation root',
    icon: CornerUpLeft,
    arrowClass: 'group-hover:-translate-x-0.5 group-focus-visible:-translate-x-0.5',
    accessibleLabel: (title: string, description?: string) =>
      `Documentation root: back to ${title}${description ? `. ${description}` : ''}`,
  },
  previous: {
    label: 'Previous guide',
    icon: ArrowLeft,
    arrowClass: 'group-hover:-translate-x-0.5 group-focus-visible:-translate-x-0.5',
    accessibleLabel: (title: string, description?: string) =>
      `Previous guide: ${title}${description ? `. ${description}` : ''}`,
  },
  next: {
    label: 'Next guide',
    icon: ArrowRight,
    arrowClass: 'group-hover:translate-x-0.5 group-focus-visible:translate-x-0.5',
    accessibleLabel: (title: string, description?: string) =>
      `Next guide: ${title}${description ? `. ${description}` : ''}`,
  },
} as const;

type GuideDirection = keyof typeof DIRECTIONS;

function GuideLink({ guide, direction }: { guide: RelatedGuide; direction: GuideDirection }) {
  const { label, icon: Icon, arrowClass, accessibleLabel } = DIRECTIONS[direction];

  return (
    <Link
      href={guide.url}
      aria-label={accessibleLabel(guide.title, guide.description)}
      className="group flex min-h-20 flex-col justify-between rounded-xl border border-fd-border bg-fd-card/70 p-4 transition-[border-color,background-color,transform] duration-200 hover:-translate-y-0.5 hover:border-fd-primary/45 hover:bg-fd-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fd-ring focus-visible:ring-offset-2 focus-visible:ring-offset-fd-background"
    >
      <span className="flex items-center justify-between gap-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-fd-muted-foreground">
        {label}
        <Icon aria-hidden="true" className={`size-4 text-fd-primary transition-transform duration-200 ${arrowClass}`} />
      </span>
      <span className="mt-3 min-w-0">
        <span className="block truncate font-medium text-fd-card-foreground">{guide.title}</span>
        {guide.description ? (
          <span className="mt-1 block line-clamp-2 text-sm leading-5 text-fd-muted-foreground">
            {guide.description}
          </span>
        ) : null}
      </span>
    </Link>
  );
}

/** One column per rendered card: the root link, plus previous / next if present. */
function gridColumnsClass(data: RelatedGuidesData): string {
  if (data.previous && data.next) return 'sm:grid-cols-3';
  if (data.previous || data.next) return 'sm:grid-cols-2';
  return 'sm:grid-cols-1';
}

export function RelatedGuides({ data }: { data: RelatedGuidesData | null }) {
  if (!data) return null;
  const gridClass = gridColumnsClass(data);

  return (
    <section
      aria-labelledby="related-guides-title"
      className="not-prose ax-related-guides my-10 border-t border-fd-border pt-8"
    >
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="related-guides-title" className="font-display text-xl font-semibold tracking-[-0.015em] text-fd-card-foreground">
          Continue in {data.root.title}
        </h2>
        <p className="text-sm text-fd-muted-foreground">Keep the thread moving.</p>
      </div>
      <div className={`grid gap-3 ${gridClass}`}>
        <GuideLink guide={data.root} direction="back" />
        {data.previous ? <GuideLink guide={data.previous} direction="previous" /> : null}
        {data.next ? <GuideLink guide={data.next} direction="next" /> : null}
      </div>
    </section>
  );
}
