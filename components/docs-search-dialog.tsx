'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useDocsSearch } from 'fumadocs-core/search/client';
import { fetchClient } from 'fumadocs-core/search/client/fetch';
import {
  SearchDialog,
  SearchDialogClose,
  SearchDialogContent,
  SearchDialogHeader,
  SearchDialogIcon,
  SearchDialogInput,
  SearchDialogList,
  SearchDialogOverlay,
  useSearch,
} from 'fumadocs-ui/components/dialog/search';
import type { DefaultSearchDialogProps } from 'fumadocs-ui/components/dialog/search-default';
import { PRODUCTS as SITE_PRODUCTS } from './brand/products';
import { captureDocsSearch } from './posthog-provider';

const PRODUCTS = new Set([
  ...SITE_PRODUCTS.map((product) => product.match.replace(/^\//, '')),
  'changelog',
]);

function currentProduct() {
  const segment = window.location.pathname.split('/').filter(Boolean)[0];
  return segment && PRODUCTS.has(segment) ? segment : 'root';
}

const shortcutClass =
  'inline-flex items-center gap-1.5 rounded-full border border-fd-border bg-fd-secondary px-3 py-1.5 text-xs font-semibold text-fd-secondary-foreground transition-colors hover:border-fd-primary/50 hover:text-fd-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fd-ring';

function SearchEmpty({ query, searching }: { query: string; searching: boolean }) {
  const { onOpenChange } = useSearch();
  return (
    <div className="flex flex-col items-center px-4 py-10 text-center">
      <p className="text-sm leading-6 text-fd-muted-foreground">
        {searching && query ? (
          'Searching…'
        ) : query ? (
          <>
            No matches for{' '}
            <span className="font-medium text-fd-foreground">&ldquo;{query}&rdquo;</span>. Jump to
            a product guide instead:
          </>
        ) : (
          'Jump to a product guide:'
        )}
      </p>
      {searching && query ? null : (
        <>
          <div className="mt-4 flex max-w-md flex-wrap justify-center gap-2">
            {SITE_PRODUCTS.map((product) => (
              <Link
                key={product.name}
                href={`${product.match}/getting-started`}
                onClick={() => onOpenChange(false)}
                className={shortcutClass}
              >
                <span
                  aria-hidden="true"
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ background: product.accent }}
                />
                {product.name}
              </Link>
            ))}
          </div>
          <p className="mt-5 text-xs leading-5 text-fd-muted-foreground">
            Still stuck? Email{' '}
            <a
              href="mailto:support@tiletactician.com"
              className="font-medium text-fd-primary underline-offset-4 transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fd-ring"
            >
              support@tiletactician.com
            </a>
          </p>
        </>
      )}
    </div>
  );
}

export function DocsSearchDialog({ api = '/api/search', delayMs = 500, ...props }: DefaultSearchDialogProps) {
  const { search, setSearch, query } = useDocsSearch({ client: fetchClient({ api }), delayMs });
  const lastSearchEvent = useRef('');

  // useDocsSearch only flips query.isLoading once its debounce fires, so a
  // freshly typed query keeps the stale "empty" result for delayMs before the
  // fetch starts. Mirror that window so the empty state never asserts "No
  // matches" for a search still in flight. debouncing is set DURING RENDER (not
  // in an effect) so it is already true on the first paint after a keystroke —
  // a passive effect would lag a frame and flash "No matches"; the effect below
  // then clears it once the debounce window elapses.
  const [debouncing, setDebouncing] = useState(false);
  const [prevSearch, setPrevSearch] = useState(search);
  if (search !== prevSearch) {
    setPrevSearch(search);
    setDebouncing(search.trim().length > 0);
  }
  useEffect(() => {
    if (!search.trim()) return;
    const timer = setTimeout(() => setDebouncing(false), delayMs);
    return () => clearTimeout(timer);
  }, [search, delayMs]);
  const searching = debouncing || query.isLoading;

  useEffect(() => {
    const searchQuery = search.trim();
    if (!searchQuery) {
      // Reset the dedup signature so re-searching the same term after
      // clearing the input still emits analytics.
      lastSearchEvent.current = '';
      return;
    }
    if (query.isLoading || query.data === undefined) return;
    const resultCount = query.data === 'empty' ? 0 : query.data.length;
    const signature = `${searchQuery}\u0000${resultCount}`;
    if (signature === lastSearchEvent.current) return;
    lastSearchEvent.current = signature;

    captureDocsSearch('docs_search', { query: searchQuery, resultCount, product: currentProduct() });
    if (query.data === 'empty') captureDocsSearch('docs_search_no_results', { query: searchQuery, product: currentProduct() });
  }, [query.data, query.isLoading, search]);

  return (
    <SearchDialog
      search={search}
      onSearchChange={setSearch}
      isLoading={query.isLoading}
      onSelect={(item) => {
        if (item.type === 'action') return;
        const position = query.data === 'empty' || !query.data ? 0 : query.data.findIndex((result) => result.id === item.id) + 1;
        captureDocsSearch('docs_search_result_click', { query: search.trim(), url: item.url, position });
      }}
      {...props}
    >
      <SearchDialogOverlay />
      <SearchDialogContent>
        <SearchDialogHeader>
          <SearchDialogIcon />
          <SearchDialogInput />
          <SearchDialogClose />
        </SearchDialogHeader>
        <SearchDialogList
          items={query.data === 'empty' ? [] : query.data}
          Empty={() => <SearchEmpty query={search.trim()} searching={searching} />}
        />
      </SearchDialogContent>
    </SearchDialog>
  );
}
