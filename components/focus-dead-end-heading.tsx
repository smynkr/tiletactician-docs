'use client';

import { useEffect, useRef, type ReactNode } from 'react';

/**
 * Moves focus to the wrapped h1 on mount so client-side navigation into a
 * dead-end (404) does not strand keyboard and screen-reader users on a stale
 * control from the previous page. The heading becomes programmatically
 * focusable; its outline is suppressed because the recovery actions below it
 * remain the visible focus targets.
 */
export function FocusDeadEndHeading({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const heading = ref.current?.querySelector('h1');
    if (!heading) return;
    heading.setAttribute('tabindex', '-1');
    heading.focus({ preventScroll: true });
  }, []);

  return (
    <span ref={ref} className="[&_h1]:outline-none">
      {children}
    </span>
  );
}
