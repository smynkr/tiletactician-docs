'use client';

import { useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { captureDocsEvent } from './posthog-provider';

const buttonClass =
  'inline-flex h-8 items-center rounded-full border border-fd-border bg-fd-secondary px-4 text-[13px] font-semibold text-fd-secondary-foreground transition-colors duration-150 hover:border-fd-primary/50 hover:text-fd-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fd-ring focus-visible:ring-offset-2 focus-visible:ring-offset-fd-background';

/**
 * A single yes/no signal on whether the page helped, captured through the
 * same redacted PostHog pipeline as search telemetry. Rendered at the end of
 * the article on every docs page except the changelog (DocsContentPage owns
 * the placement), so content quality has a feedback loop. It must live INSIDE
 * <DocsPage>: the docs layout is a named-area CSS grid, and a sibling of the
 * page component is an unplaced grid item that auto-flows into the top row —
 * rendering the widget above the title.
 */
export function PageFeedback() {
  const pathname = usePathname();
  const [vote, setVote] = useState<'yes' | 'no' | null>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);

  function submit(helpful: boolean) {
    if (vote) return;
    setVote(helpful ? 'yes' : 'no');
    captureDocsEvent('docs_page_feedback', { path: pathname, helpful });
    // The buttons unmount on vote; move focus to the confirmation so keyboard
    // users don't get dropped back to the top of the page.
    requestAnimationFrame(() => statusRef.current?.focus());
  }

  return (
    <div className="not-prose border-t border-fd-border pt-6">
      {vote === null ? (
        <div
          role="group"
          aria-label="Page feedback"
          className="flex flex-wrap items-center gap-x-4 gap-y-3"
        >
          <span className="ax-metric-label">Was this page helpful?</span>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => submit(true)} className={buttonClass}>
              Yes
            </button>
            <button type="button" onClick={() => submit(false)} className={buttonClass}>
              No
            </button>
          </div>
        </div>
      ) : null}
      {/* The live region must exist before its content changes, otherwise most
          screen readers skip the announcement; keep it mounted, empty until voted. */}
      <p
        ref={statusRef}
        role="status"
        tabIndex={vote === null ? undefined : -1}
        className="text-sm leading-6 text-fd-muted-foreground focus-visible:outline-none"
      >
        {vote === 'yes'
          ? 'Thanks — good to know this page hit the mark.'
          : vote === 'no'
            ? (
              <>
                Thanks for the signal. If something is wrong or missing,{' '}
                <a
                  href="mailto:support@menuwright.com"
                  className="font-medium text-fd-primary underline-offset-4 transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fd-ring"
                >
                  tell us what you needed
                </a>
                .
              </>
            )
            : null}
      </p>
    </div>
  );
}
