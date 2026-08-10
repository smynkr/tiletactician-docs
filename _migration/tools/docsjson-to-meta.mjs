#!/usr/bin/env node
// Builds Fumadocs meta.json files from the existing Mintlify navigation.

import path from 'node:path';
import fs from 'node:fs/promises';
import { CONTENT_DOCS_DIR, DEFAULT_MINTLIFY_DIR, PRODUCTS, ensureDir, mapGenericLucideIcon } from './lib/shared.mjs';

function parseArgs(argv) {
  const args = { src: DEFAULT_MINTLIFY_DIR, dest: CONTENT_DOCS_DIR, product: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--product') args.product = argv[++index];
    else if (arg === '--src') args.src = path.resolve(argv[++index]);
    else if (arg === '--dest') args.dest = path.resolve(argv[++index]);
  }
  return args;
}

function titleCase(slug) {
  return slug.split('-').map((word) => word[0].toUpperCase() + word.slice(1)).join(' ');
}
function dirOf(relativePath) {
  const index = relativePath.lastIndexOf('/');
  return index === -1 ? '' : relativePath.slice(0, index);
}
function baseOf(relativePath) {
  const index = relativePath.lastIndexOf('/');
  return index === -1 ? relativePath : relativePath.slice(index + 1);
}
function separator(label, icon) {
  const mapped = icon && mapGenericLucideIcon(icon);
  return mapped ? `---[${mapped}]${label}---` : `---${label}---`;
}

// Root-folder switcher metadata per product (the sidebar product switcher).
// Mintlify's docs.json navigation has no equivalent for Fumadocs root folders,
// so this is the source of truth for the switcher — kept here so the codemod
// regenerates each product's root meta.json idempotently (LAY-721: previously
// these fields were added only to the generated files and a codemod re-run
// stripped them). Icons are Mintlify names; mapGenericLucideIcon maps them to
// Lucide exports (layers→Layers, radar→Radar, ...).
const PRODUCT_ROOT_META = {
  tiletactician: { icon: 'grid-2x2', description: 'TileTactician Scrabble and Crossplay board analysis — every legal play, ranked by score, in real time.' },
};

class MetaBuilder {
  constructor(title) {
    this.metas = new Map([['', { title, icon: undefined, pages: [], titleLocked: true, lastLabel: null }]]);
  }
  get(directory) {
    if (!this.metas.has(directory)) this.metas.set(directory, { title: titleCase(baseOf(directory)), icon: undefined, pages: [], titleLocked: false, lastLabel: null });
    return this.metas.get(directory);
  }
  ensureParents(directory) {
    let current = '';
    for (const part of directory ? directory.split('/') : []) {
      const parent = this.get(current);
      current = current ? `${current}/${part}` : part;
      if (!parent.pages.includes(part)) parent.pages.push(part);
      this.get(current);
    }
  }
  add(pagePath, label, icon) {
    const directory = dirOf(pagePath);
    const page = baseOf(pagePath);
    this.ensureParents(directory);
    const meta = this.get(directory);
    if (label && !meta.titleLocked) {
      meta.title = label;
      meta.icon = icon;
    }
    meta.titleLocked = true;
    if (label && meta.title !== label && meta.lastLabel !== label) meta.pages.push(separator(label, icon));
    meta.lastLabel = label ?? null;
    meta.pages.push(page);
  }
  process(items, product, label, icon) {
    for (const item of items) {
      if (typeof item === 'string') this.add(item.replace(new RegExp(`^${product}/`), ''), label, icon);
      else if (item && Array.isArray(item.pages)) this.process(item.pages, product, item.group, item.icon);
    }
  }
  async write(destination, product) {
    const rootMeta = PRODUCT_ROOT_META[String(product).toLowerCase()];
    for (const [directory, meta] of this.metas) {
      const json = { title: meta.title };
      if (directory === '' && rootMeta) {
        // Product root: emit the root-folder switcher metadata in the same key
        // order as the existing generated files (title, root, icon, description,
        // pages) so the output stays byte-identical.
        json.root = true;
        const rootIcon = mapGenericLucideIcon(rootMeta.icon);
        if (rootIcon) json.icon = rootIcon;
        json.description = rootMeta.description;
      } else {
        const icon = meta.icon && mapGenericLucideIcon(meta.icon);
        if (icon) json.icon = icon;
      }
      if (meta.pages.length) json.pages = meta.pages;
      const target = path.join(destination, directory, 'meta.json');
      await ensureDir(path.dirname(target));
      await fs.writeFile(target, `${JSON.stringify(json, null, 2)}\n`, 'utf8');
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.product || !PRODUCTS.includes(args.product)) throw new Error(`--product must be one of ${PRODUCTS.join(', ')}`);
  const docsJson = JSON.parse(await fs.readFile(path.join(args.src, 'docs.json'), 'utf8'));
  const product = docsJson.navigation.products.find((entry) => entry.product.toLowerCase() === args.product);
  if (!product) throw new Error(`No navigation entry for ${args.product}.`);
  const builder = new MetaBuilder(product.product);
  const multiTab = product.tabs.length > 1;
  for (const tab of product.tabs) {
    for (const group of tab.groups ?? []) {
      builder.process(group.pages ?? [], args.product, multiTab ? `${tab.tab} — ${group.group}` : group.group, group.icon);
    }
  }
  await builder.write(path.join(args.dest, args.product), args.product);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
