// Shared helpers for the Mintlify -> Fumadocs migration codemods.
//
// The target site (docs-poc/site) is the only place in this workspace with the
// npm packages we need (unified/remark/mdast for AST work, `yaml` for
// frontmatter, `lucide-react` for icon-name validation). `tools/` itself has
// no node_modules, so every package is loaded by resolving straight into
// `site/node_modules` rather than via a bare specifier.

import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// tools/lib -> tools -> docs-poc
export const DOCS_POC_DIR = path.resolve(__dirname, '..', '..');
export const SITE_DIR = path.join(DOCS_POC_DIR, 'site');
export const CONTENT_DOCS_DIR = path.join(SITE_DIR, 'content', 'docs');

// Sibling of docs-poc/ inside the scratch workspace.
export const DEFAULT_MINTLIFY_DIR = path.resolve(DOCS_POC_DIR, '..', 'axiom-docs-fresh');

export const PRODUCTS = ['layer', 'overwatch', 'locus', 'routeshift', 'codex'];
// Path prefixes (site-absolute, Mintlify-style) that are safe to rewrite into
// the Fumadocs /docs/... route. Anything else (external URLs, mailto:,
// bare #anchors, unrecognized prefixes) is left untouched.
export const REWRITABLE_PREFIXES = [...PRODUCTS, 'changelog'];

/**
 * Require a CJS package that lives in site/node_modules (yaml, lucide-react).
 * `tools/` has no node_modules of its own, so a bare `require('yaml')` from
 * here would fail — resolution is rooted at site/package.json instead.
 */
export const requireFromSite = createRequire(path.join(SITE_DIR, 'package.json'));

/**
 * Import an ESM-only package that only exists in site/node_modules (unified,
 * remark-*, unist-util-visit, ...) via its absolute path.
 */
export async function importFromSite(pkg, sub = 'index.js') {
  const p = path.join(SITE_DIR, 'node_modules', pkg, sub);
  return import(pathToFileURL(p).href);
}

export function kebabToPascal(name) {
  return name
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join('');
}

let _lucideIcons;
/** Map of PascalCase lucide-react icon name -> component, for membership checks. */
export function getLucideIcons() {
  if (!_lucideIcons) {
    _lucideIcons = requireFromSite('lucide-react').icons;
  }
  return _lucideIcons;
}

/**
 * Map a Mintlify icon name (kebab-case, e.g. "book-open") to a real
 * lucide-react export name (e.g. "BookOpen"), or return null if there is no
 * exact match in the installed lucide-react version. Callers must drop the
 * icon rather than emit a name that doesn't exist.
 */
export function mapLucideIcon(mintlifyName) {
  if (!mintlifyName) return null;
  const icons = getLucideIcons();
  const pascal = kebabToPascal(mintlifyName);
  return icons[pascal] ? pascal : null;
}

const REWRITE_RE = new RegExp(
  `^\\/(?:${REWRITABLE_PREFIXES.join('|')})(?:\\/[^?#]*)?$|^\\/(?:${REWRITABLE_PREFIXES.join('|')})(?=[?#])`,
);

/**
 * Rewrite a Mintlify site-absolute link ("/layer/integrations/aws",
 * "/layer/integrations/microsoft-365#token-refresh", "/changelog") into the
 * Fumadocs docs route ("/docs/layer/integrations/aws", ...).
 *
 * Leaves everything else untouched: external URLs, mailto:, bare #anchors,
 * and any path that isn't one of the 5 products or /changelog.
 *
 * Also mirrors Fumadocs' own slug rule: a file named `index.mdx` maps to its
 * *folder's* URL (no trailing "/index" segment) — see
 * fumadocs-core/dist/source/plugins/slugs.js `getSlugs()`. So a Mintlify
 * link to "/layer/index" must become "/docs/layer", not "/docs/layer/index".
 */
export function rewriteHref(url) {
  if (typeof url !== 'string' || !REWRITE_RE.test(url)) return url;

  const m = /^(\/[^?#]*)?([?#].*)?$/.exec(url);
  if (!m) return url;
  let basePath = m[1] ?? '';
  const suffix = m[2] ?? '';

  // Strip a trailing "/index" (or a bare product path with nothing after it
  // is already correct as-is).
  basePath = basePath.replace(/\/index$/, '');

  return `/docs${basePath}${suffix}`;
}

export async function walkMdxFiles(dir) {
  const results = [];
  async function walk(current) {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && entry.name.endsWith('.mdx')) {
        results.push(full);
      }
    }
  }
  await walk(dir);
  results.sort();
  return results;
}

export async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}
