import { CHANGELOG_SLUG, getPageMarkdownUrl, source } from '@/lib/source';
import { getMDXComponents } from '@/components/mdx';
import { PageFeedback } from '@/components/page-feedback';
import { RelatedGuides } from '@/components/related-guides';
import { getRelatedGuides } from '@/lib/page-context';
import { gitConfig } from '@/lib/shared';
import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
  MarkdownCopyButton,
  ViewOptionsPopover,
} from 'fumadocs-ui/layouts/docs/page';
import { buttonVariants } from 'fumadocs-ui/components/ui/button';
import { createRelativeLink } from 'fumadocs-ui/mdx';
import { Rss } from 'lucide-react';
import { PRODUCTS } from '@/components/brand/products';
import { ProductIdentityMark } from '@/components/brand/product-identity';
import { Constellation } from '@/components/brand/constellation';

type SourcePage = NonNullable<ReturnType<typeof source.getPage>>;

/**
 * `page.path` is relative to the generated `content/docs/` dir and mirrors
 * the flat canonical source path 1:1 — except the changelog index, which the
 * migration codemod moves from root `changelog.mdx` to `changelog/index.mdx`.
 * Map that one case back so the link targets the canonical file.
 */
function canonicalSourcePath(page: SourcePage): string {
  return page.path === 'changelog/index.mdx' ? 'changelog.mdx' : page.path;
}

export function DocsContentPage({ page }: { page: SourcePage }) {
  const MDX = page.data.body;
  const markdownUrl = getPageMarkdownUrl(page).url;
  // Long aggregate pages cap the right-rail table of contents at h2. The hub
  // does this so its card sections don't crowd the rail; the changelog index
  // does it because its h3 subsections ("New features" / "Updates" / "Fixes")
  // repeat verbatim under every week and are meaningless out of context, so a
  // depth-3 rail lists the same four labels many times over. Per-week pages
  // keep depth 3 — their subsections are unique and short.
  const isLongIndex = page.url === '/getting-started' || page.url === '/changelog';
  const maxTocDepth = isLongIndex ? 2 : 3;
  const toc = page.data.toc.filter((item) => item.depth >= 2 && item.depth <= maxTocDepth);
  // The accent identity nameplate renders only on a product's own index page
  // (/overwatch), never a deep page (/overwatch/live-map). Exact equality on
  // `match` is deliberate: a prefix match would leak the nameplate onto every
  // deep page, which the brand keeps quiet.
  const product = PRODUCTS.find((entry) => entry.match === page.url);
  // The RSS subscribe affordance lives on the changelog index only — that is
  // where a reader decides to follow releases; dated entries stay quiet.
  const isChangelogIndex = page.url === '/changelog';
  // The changelog keeps its own quiet reading surface — no feedback prompt on
  // its index or dated entries.
  const isChangelog = page.slugs[0] === CHANGELOG_SLUG;
  const related = isChangelog ? null : getRelatedGuides(source.getPageTree(), page);

  return (
    <DocsPage toc={toc} full={page.data.full} className={product ? 'ax-index-stage' : undefined}>
      {product ? (
        <Constellation count={44} linkDistance={130} className="ax-constellation ax-index-constellation" />
      ) : null}
      {product ? <ProductIdentityMark product={product} /> : null}
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription className="mb-0">{page.data.description}</DocsDescription>
      <div className="ax-page-actions flex flex-row flex-wrap items-center gap-2 border-b border-fd-border pb-6">
        <MarkdownCopyButton markdownUrl={markdownUrl} />
        <ViewOptionsPopover
          markdownUrl={markdownUrl}
          githubUrl={`https://github.com/${gitConfig.user}/${gitConfig.repo}/blob/${gitConfig.branch}/${canonicalSourcePath(page)}`}
        />
        {isChangelogIndex ? (
          <a
            href="/changelog/feed.xml"
            title="Subscribe to the changelog RSS feed"
            className={buttonVariants({
              color: 'secondary',
              size: 'sm',
              className: 'gap-2 [&_svg]:size-3.5 [&_svg]:text-fd-muted-foreground',
            })}
          >
            <Rss aria-hidden="true" />
            Subscribe
          </a>
        ) : null}
      </div>
      <DocsBody>
        <MDX components={getMDXComponents({ a: createRelativeLink(source, page) })} />
      </DocsBody>
      <RelatedGuides data={related} />
      {isChangelog ? null : <PageFeedback key={page.url} />}
    </DocsPage>
  );
}
