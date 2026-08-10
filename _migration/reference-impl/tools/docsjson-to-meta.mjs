#!/usr/bin/env node
// Reads Mintlify's docs.json navigation for a given product and emits
// Fumadocs meta.json files (one per directory) that reproduce the same
// group ordering and titles.
//
// Fumadocs meta.json shape (verified against
// site/node_modules/fumadocs-core/dist/source/schema.d.ts +
// dist/loader-CoSFINvo.js — NOT guessed):
//   { "title"?: string, "icon"?: string, "pages"?: string[], ... }
// `pages` entries are resolved relative to the meta.json's own directory:
//   - a plain slug ("aws") references a sibling page/folder in this dir
//   - a folder name on its own ("integrations") pulls in that subfolder's
//     whole tree (using ITS OWN meta.json for title/icon/ordering)
//   - "---Label---" (or "---[icon]Label---") is a non-collapsible separator
//     rendered inline in the sidebar, with an optional lucide icon
//     (loader-CoSFINvo.js `separator` regex: /^---(?:\[(?<icon>...)])?(?<name>.+)---|^---$/,
//     and the icon goes through the exact same lucideIconsPlugin resolution
//     as page/folder icons — icon-BILaoXeg.js `iconPlugin` wires `file`,
//     `folder`, AND `separator` through the same resolver)
// There is no nested/inline group object in `pages` — grouping that doesn't
// correspond to a real subfolder can only be represented with a separator.
//
// Mintlify's docs.json, by contrast, lets a nav group reference pages from
// *anywhere* in the tree regardless of their physical folder (see the
// "Layer > Integrations > Discovery" group, whose 3 pages physically live
// directly under layer/, not under layer/integrations/). To reproduce that
// faithfully without moving files (which would break the
// /layer/... -> /docs/layer/... link-rewrite contract), each page is routed
// by its ACTUAL directory, and the innermost enclosing Mintlify group label
// becomes either:
//   - the title of a newly-created folder meta.json (first time that
//     directory is seen), or
//   - a "---Label---" separator inside whichever meta.json its dir already
//     resolves to (root or an existing subfolder)
// Pages emit in docs.json's own order, so the mixed-directory groups (like
// Integrations, which folds in fine, then Discovery, which doesn't) come out
// in the right relative position without any special-casing.

import path from 'node:path';
import fs from 'node:fs/promises';
import { CONTENT_DOCS_DIR, DEFAULT_MINTLIFY_DIR, PRODUCTS, mapLucideIcon, ensureDir } from './lib/shared.mjs';

function parseArgs(argv) {
  const args = { src: DEFAULT_MINTLIFY_DIR, dest: CONTENT_DOCS_DIR, product: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--product') args.product = argv[++i];
    else if (a === '--src') args.src = path.resolve(argv[++i]);
    else if (a === '--dest') args.dest = path.resolve(argv[++i]);
    else if (a === '--help' || a === '-h') args.help = true;
  }
  return args;
}

function titleCase(slug) {
  return slug
    .split('-')
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');
}

function stripProductPrefix(pagePath, product) {
  const prefix = `${product}/`;
  return pagePath.startsWith(prefix) ? pagePath.slice(prefix.length) : pagePath;
}

function dirOf(relPath) {
  const idx = relPath.lastIndexOf('/');
  return idx === -1 ? '' : relPath.slice(0, idx);
}

function baseOf(relPath) {
  const idx = relPath.lastIndexOf('/');
  return idx === -1 ? relPath : relPath.slice(idx + 1);
}

function separatorFor(label, icon) {
  const mapped = icon ? mapLucideIcon(icon) : null;
  return mapped ? `---[${mapped}]${label}---` : `---${label}---`;
}

class MetaBuilder {
  constructor(productTitle) {
    this.metas = new Map(); // dir -> { title, icon, pages: [], _lastLabel, _titled }
    // The product root's title is fixed up front and must never be
    // clobbered by a group label later (unlike subfolder metas, which start
    // as untitled placeholders — see ensureFolderChain).
    this.metas.set('', { title: productTitle, icon: undefined, pages: [], _lastLabel: null, _titled: true });
  }

  /** Get a dir's meta, creating an untitled placeholder if it doesn't exist yet. */
  getOrCreatePlaceholder(dir) {
    if (this.metas.has(dir)) return this.metas.get(dir);
    const meta = { title: titleCase(baseOf(dir)), icon: undefined, pages: [], _lastLabel: null, _titled: false };
    this.metas.set(dir, meta);
    return meta;
  }

  /** Make sure every ancestor directory of `dir` references its child folder exactly once. */
  ensureFolderChain(dir) {
    if (dir === '') return;
    const parts = dir.split('/');
    let cur = '';
    for (const part of parts) {
      const parentDir = cur;
      cur = cur === '' ? part : `${cur}/${part}`;
      const parentMeta = this.getOrCreatePlaceholder(parentDir);
      if (!parentMeta.pages.includes(part)) parentMeta.pages.push(part);
      this.getOrCreatePlaceholder(cur);
    }
  }

  emitPage(relPath, label, icon) {
    const dir = dirOf(relPath);
    const base = baseOf(relPath);
    this.ensureFolderChain(dir);
    const meta = this.getOrCreatePlaceholder(dir);

    // The first time a real page lands in a freshly-created (placeholder)
    // directory, its enclosing Mintlify group label/icon becomes that
    // directory's permanent title/icon — this is what turns e.g. the
    // "Integrations" group into the title of content/docs/layer/integrations/.
    // The product root is pre-titled (_titled: true from construction) and
    // is never eligible for this, so root keeps the product name.
    if (label && !meta._titled) {
      meta.title = label;
      meta.icon = icon;
    }
    meta._titled = true;

    // A label that differs from the dir's own title needs a visible
    // separator (e.g. root's "Get started"/"Features"/"Settings", or a
    // nested subgroup like "Identity & directory" inside the already-titled
    // "Integrations" folder). Skip repeats of the same label back-to-back.
    if (label && meta.title !== label && meta._lastLabel !== label) {
      meta.pages.push(separatorFor(label, icon));
    }
    meta._lastLabel = label ?? null;
    meta.pages.push(base);
  }

  /** Recursively process a Mintlify `pages` array (strings and nested {group,pages} objects). */
  process(pagesArr, product, enclosingLabel, enclosingIcon) {
    for (const item of pagesArr) {
      if (typeof item === 'string') {
        this.emitPage(stripProductPrefix(item, product), enclosingLabel, enclosingIcon);
      } else if (item && typeof item === 'object' && Array.isArray(item.pages)) {
        this.process(item.pages, product, item.group, item.icon);
      }
    }
  }

  toFiles(destProductDir) {
    const files = [];
    for (const [dir, meta] of this.metas) {
      const json = { title: meta.title };
      if (meta.icon) {
        const mapped = mapLucideIcon(meta.icon);
        if (mapped) json.icon = mapped;
      }
      if (meta.pages.length) json.pages = meta.pages;
      files.push({ dir: path.join(destProductDir, dir), content: json });
    }
    return files;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.product) {
    console.log('Usage: node docsjson-to-meta.mjs --product <name> [--src <mintlify-dir>] [--dest <content/docs dir>]');
    process.exit(args.help ? 0 : 1);
  }
  if (!PRODUCTS.includes(args.product)) {
    console.error(`Unknown product "${args.product}". Expected one of: ${PRODUCTS.join(', ')}`);
    process.exit(1);
  }

  const docsJsonPath = path.join(args.src, 'docs.json');
  const docsJson = JSON.parse(await fs.readFile(docsJsonPath, 'utf8'));

  const productEntry = docsJson.navigation.products.find((p) => p.product.toLowerCase() === args.product);
  if (!productEntry) {
    console.error(`Product "${args.product}" not found in ${docsJsonPath} navigation.products[]`);
    process.exit(1);
  }

  const builder = new MetaBuilder(productEntry.product);

  // Multiple tabs (e.g. "Documentation" + "API reference") each get their
  // own top-level group label so their pages don't collide; a single tab
  // (the common case, and the only one exercised for `layer`) contributes
  // directly to the product root with no extra nesting.
  const multiTab = productEntry.tabs.length > 1;
  for (const tab of productEntry.tabs) {
    for (const group of tab.groups ?? []) {
      const label = multiTab ? `${tab.tab} — ${group.group}` : group.group;
      builder.process(group.pages ?? [], args.product, label, group.icon);
    }
  }

  const destProductDir = path.join(args.dest, args.product);
  const files = builder.toFiles(destProductDir);

  for (const { dir, content } of files) {
    await ensureDir(dir);
    const metaPath = path.join(dir, 'meta.json');
    await fs.writeFile(metaPath, JSON.stringify(content, null, 2) + '\n', 'utf8');
    console.log(`wrote ${path.relative(args.dest, metaPath)}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
