import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import { baseOptions } from '@/lib/layout.shared';
import { source } from '@/lib/source';

/**
 * Root-page layout for the docs chrome (sidebar, nav, TOC rail). Mirrors
 * app/[...slug]/layout.tsx so the landing page at `/` renders inside the
 * same DocsLayout as every product page — it is the product index page
 * served without a URL prefix.
 */
export default function HomeLayout({ children }: { children: React.ReactNode }) {
  return <DocsLayout tree={source.getPageTree()} {...baseOptions()}>{children}</DocsLayout>;
}
