import type * as PageTree from 'fumadocs-core/page-tree';
import { findParent, findPath } from 'fumadocs-core/page-tree';
import type { ReactNode } from 'react';

export interface RelatedGuide {
  url: string;
  title: string;
  description: string;
}

export interface RelatedGuidesData {
  root: RelatedGuide;
  previous?: RelatedGuide;
  next?: RelatedGuide;
}

function text(value: ReactNode | undefined): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

function asGuide(node: PageTree.Node | undefined): RelatedGuide | undefined {
  if (!node || node.type !== 'page' || !node.url) return undefined;
  const title = text(node.name);
  if (!title) return undefined;
  return {
    url: node.url,
    title,
    description: text(node.description),
  };
}

/** The product's own index page (`/overwatch`), wherever it sits in the tree. */
function isProductIndex(node: PageTree.Node, product: string): boolean {
  return node.type === 'page' && node.url === `/${product}`;
}

function isCuratedEntry(page: { url: string; slugs: string[] }): boolean {
  const product = page.slugs[0];
  return (
    page.url === '/getting-started' ||
    !product ||
    product === 'changelog' ||
    page.url === `/${product}` ||
    page.url === `/${product}/getting-started`
  );
}

function isCuratedUrl(url: string): boolean {
  return isCuratedEntry({ url, slugs: url.split('/').filter(Boolean) });
}

export function getRelatedGuides(
  tree: PageTree.Root,
  page: { url: string; slugs: string[] },
): RelatedGuidesData | null {
  if (isCuratedEntry(page)) return null;

  const product = page.slugs[0];
  if (!product) return null;

  // Fail closed: a page that cannot be located in the source tree gets no
  // wayfinding block at all — never a bare root card for an unknown route.
  const path = findPath(tree.children, (node) => node.type === 'page' && node.url === page.url);
  if (!path) return null;

  const productFolder = path.find(
    (node): node is PageTree.Folder => node.type === 'folder' && Boolean(node.root),
  );
  if (!productFolder) return null;

  const root =
    asGuide(productFolder.index) ??
    asGuide(productFolder.children.find((node) => isProductIndex(node, product)));
  if (!root || root.url === page.url) return null;

  const parent = findParent(tree, page.url);
  // A folder's index page lives at `parent.index`, not in `children`; include
  // it first so a section index gets its own previous/next neighbourhood.
  // (The tree root also matches `findParent`'s return type but carries no index.)
  const index = parent && 'index' in parent ? parent.index : undefined;
  const siblings = parent
    ? [index, ...parent.children].filter((n): n is PageTree.Node => Boolean(n))
    : [];
  // Deduplicate pages by URL: a folder that lists its index both as
  // `folder.index` and as a child must not produce a self-referential
  // previous/next pair.
  const seenUrls = new Set<string>();
  const uniqueSiblings: PageTree.Node[] = [];
  for (const node of siblings) {
    if (node.type === 'page') {
      if (seenUrls.has(node.url)) continue;
      seenUrls.add(node.url);
    }
    uniqueSiblings.push(node);
  }
  const peers = uniqueSiblings.filter(
    (node): node is PageTree.Item =>
      node.type === 'page' && node.url !== root.url && !isCuratedUrl(node.url),
  );
  const currentIndex = peers.findIndex((item) => item.url === page.url);
  if (currentIndex < 0) return { root };

  // An out-of-range neighbour is `undefined`, which `asGuide` passes through,
  // so the first and last guide in a folder simply have no previous / next.
  const previous = asGuide(peers[currentIndex - 1]);
  const next = asGuide(peers[currentIndex + 1]);
  return {
    root,
    ...(previous ? { previous } : {}),
    ...(next ? { next } : {}),
  };
}
