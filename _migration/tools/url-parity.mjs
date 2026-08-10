#!/usr/bin/env node
// Compare the actual Next prerender manifest with the captured live sitemap.

import fs from 'node:fs/promises';
import path from 'node:path';
import { REPO_ROOT, ensureDir } from './lib/shared.mjs';

const sitemapPath = path.join(REPO_ROOT, '_migration', 'fixtures', 'live-sitemap.xml');
const manifestPath = path.join(REPO_ROOT, '.next', 'prerender-manifest.json');
const reportPath = path.join(REPO_ROOT, '_migration', 'reports', 'url-parity.md');
const productPrefixes = new Set(['layer', 'overwatch', 'locus', 'routeshift', 'codex', 'changelog']);

function normalize(urlPath) {
  if (urlPath === '/') return urlPath;
  return urlPath.replace(/\/+$/, '');
}

function list(items) {
  return items.length === 0 ? '- None\n' : `${items.map((item) => `- \`${item}\``).join('\n')}\n`;
}

async function main() {
  const [sitemap, manifestText] = await Promise.all([fs.readFile(sitemapPath, 'utf8'), fs.readFile(manifestPath, 'utf8')]);
  const livePaths = new Set([...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => normalize(new URL(match[1]).pathname)));
  const manifest = JSON.parse(manifestText);
  const builtPaths = new Set(Object.keys(manifest.routes)
    .map(normalize)
    .filter((route) => route === '/' || productPrefixes.has(route.split('/')[1])));
  const regressions = [...livePaths].filter((route) => !builtPaths.has(route)).sort();
  const additions = [...builtPaths].filter((route) => !livePaths.has(route)).sort();

  const report = `# URL parity report\n\n` +
    `Generated from \`${path.relative(REPO_ROOT, sitemapPath)}\` and Next's built \`.next/prerender-manifest.json\`.\n\n` +
    `- Live sitemap paths: ${livePaths.size}\n` +
    `- Built documentation paths: ${builtPaths.size}\n` +
    `- Regressions: ${regressions.length}\n` +
    `- Build-only additions: ${additions.length}\n\n` +
    `## REGRESSIONS\n\n${regressions.length === 0 ? 'No sitemap paths are missing from the production build.\n' : `The following live URLs are missing from the production build:\n\n${list(regressions)}`}\n` +
    `## Build-only additions\n\n${list(additions)}`;
  await ensureDir(path.dirname(reportPath));
  await fs.writeFile(reportPath, report, 'utf8');
  console.log(JSON.stringify({ live: livePaths.size, built: builtPaths.size, regressions: regressions.length, additions: additions.length }));
  if (regressions.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
