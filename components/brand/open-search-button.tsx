'use client';

import { Search } from 'lucide-react';
import { useSearchContext } from 'fumadocs-ui/contexts/search';

/**
 * Opens the shared docs search dialog from anywhere — the same open-state the
 * sidebar trigger and the ⌘K hotkey use (the provider-level search context, not
 * the dialog-internal `useSearch`, which throws outside the dialog tree and so
 * cannot back a standalone trigger). The context's default is a non-null object
 * with a no-op setter, so this renders safely during static generation and the
 * real setter is present at runtime under the RootProvider. Used on dead-end
 * surfaces like the 404 page, where searching is the fastest recovery for a
 * lost reader.
 */
export function OpenSearchButton({ className }: { className?: string }) {
  const { setOpenSearch } = useSearchContext();
  return (
    <button
      type="button"
      onClick={() => setOpenSearch(true)}
      aria-label="Search the documentation"
      className={className}
    >
      <Search className="h-4 w-4" strokeWidth={2} />
      Search the docs
    </button>
  );
}
