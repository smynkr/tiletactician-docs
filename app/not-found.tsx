import Link from 'next/link';
import { Constellation } from '@/components/brand/constellation';
import { OpenSearchButton } from '@/components/brand/open-search-button';
import { FocusDeadEndHeading } from '@/components/focus-dead-end-heading';

export default function NotFound() {
  return (
    <main className="relative flex min-h-[70vh] flex-col items-center justify-center overflow-hidden px-6 text-center">
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_70%_50%_at_50%_0%,rgba(245,158,11,0.07),transparent_60%)]"
      />
      <Constellation className="absolute inset-0 -z-10 h-full w-full" count={50} />

      <div className="ax-metric-label mb-4">tile not on the board</div>
      <FocusDeadEndHeading>
        <h1 className="font-display text-6xl font-semibold tracking-[-0.02em] text-fd-card-foreground sm:text-7xl">
          404
        </h1>
      </FocusDeadEndHeading>
      <p className="mt-4 max-w-md text-base leading-relaxed text-fd-muted-foreground">
        This page isn&apos;t on the board. The coordinates you requested
        don&apos;t match any tile in the current layout — check the URL, or
        search for what you meant.
      </p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        {/* A lost reader's best recovery is to search for what they meant, so
            the primary action opens the shared docs search dialog. */}
        <OpenSearchButton className="ax-glow inline-flex items-center gap-2 rounded-full bg-fd-primary px-6 py-3 text-sm font-semibold text-fd-primary-foreground transition-transform duration-200 hover:scale-[1.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fd-ring focus-visible:ring-offset-2 focus-visible:ring-offset-fd-background" />
        <Link
          href="/"
          className="inline-flex items-center gap-2 rounded-full border border-fd-border bg-fd-secondary px-6 py-3 text-sm font-semibold text-fd-secondary-foreground transition-colors duration-200 hover:border-fd-primary/50 hover:text-fd-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fd-ring focus-visible:ring-offset-2 focus-visible:ring-offset-fd-background"
        >
          Back to the docs home
        </Link>
      </div>
    </main>
  );
}
