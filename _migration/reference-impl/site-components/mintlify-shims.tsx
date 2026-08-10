// Local shims for Mintlify components that have no Fumadocs equivalent.
//
// Registered in components/mdx.tsx so MDX content can use `<Update>` without
// an explicit per-file import, matching how the rest of the MDX component
// set (Callout, Card, Accordion, Steps, ...) resolves through the global
// MDX provider.

import type { ReactNode } from 'react';

export interface UpdateProps {
  /** e.g. "April 24, 2026" */
  label: string;
  /** e.g. ["Layer", "Fix"] */
  tags?: string[];
  children?: ReactNode;
}

/**
 * Renders a Mintlify-style changelog entry header (date + tag pills) above
 * the entry body. Mirrors `<Update label="..." tags={[...]}>` from the
 * Mintlify changelog pages 1:1 — see docs.json's `changelog/` product for
 * the source usage this backs.
 */
export function Update({ label, tags, children }: UpdateProps) {
  return (
    <div className="fd-update my-8 border-s-2 border-fd-border ps-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-fd-muted-foreground">{label}</span>
        {tags?.map((tag) => (
          <span
            key={tag}
            className="rounded-full border bg-fd-secondary px-2 py-0.5 text-xs font-medium text-fd-secondary-foreground"
          >
            {tag}
          </span>
        ))}
      </div>
      <div className="prose-no-margin">{children}</div>
    </div>
  );
}
