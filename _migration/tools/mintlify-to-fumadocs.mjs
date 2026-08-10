#!/usr/bin/env node
// Deterministic Mintlify -> Fumadocs converter. It intentionally preserves
// site-absolute URLs because this site serves Fumadocs at `/`.

import path from 'node:path';
import fs from 'node:fs/promises';
import {
  CONTENT_COLLECTIONS,
  CONTENT_DOCS_DIR,
  DEFAULT_MINTLIFY_DIR,
  UNMAPPED_ICON_REPORT,
  ensureDir,
  importFromSite,
  isBrandIcon,
  mapGenericLucideIcon,
  requireFromSite,
  walkMdxFiles,
} from './lib/shared.mjs';

const KNOWN_COMPONENTS = new Set([
  'Note', 'Tip', 'Warning', 'Callout', 'Card', 'Cards', 'Columns', 'Accordion',
  'AccordionGroup', 'Accordions', 'Steps', 'Step', 'CodeGroup', 'Tabs', 'Tab', 'Update', 'code',
]);

function parseArgs(argv) {
  const args = { src: DEFAULT_MINTLIFY_DIR, dest: CONTENT_DOCS_DIR, collection: null, rootPage: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--collection') args.collection = argv[++index];
    else if (arg === '--root-page') {
      const value = argv[++index];
      if (!value || value.startsWith('--')) throw new Error('--root-page requires a value.');
      args.rootPage = value;
    }
    else if (arg === '--src') args.src = path.resolve(argv[++index]);
    else if (arg === '--dest') args.dest = path.resolve(argv[++index]);
    else if (arg === '--help' || arg === '-h') args.help = true;
  }
  return args;
}

function usage() {
  console.log(`Usage: node _migration/tools/mintlify-to-fumadocs.mjs --collection <${[...CONTENT_COLLECTIONS, 'root'].join('|')}> [--root-page <changelog|getting-started|ai-assistants>]`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.collection) {
    usage();
    process.exit(args.help ? 0 : 1);
  }
  if (![...CONTENT_COLLECTIONS, 'root'].includes(args.collection)) {
    throw new Error(`Unknown collection "${args.collection}".`);
  }
  if (args.rootPage && args.collection !== 'root') {
    throw new Error('--root-page is valid only with --collection root.');
  }
  if (args.rootPage && !['changelog', 'getting-started', 'ai-assistants'].includes(args.rootPage)) {
    throw new Error(`Unknown root page "${args.rootPage}".`);
  }

  const [{ unified }, { default: remarkParse }, { default: remarkGfm }, { default: remarkMdx }, { default: remarkStringify }, { visit }] = await Promise.all([
    importFromSite('unified'),
    importFromSite('remark-parse'),
    importFromSite('remark-gfm'),
    importFromSite('remark-mdx'),
    importFromSite('remark-stringify'),
    importFromSite('unist-util-visit'),
  ]);
  const yaml = requireFromSite('yaml');
  const processor = unified().use(remarkParse).use(remarkGfm).use(remarkMdx).use(remarkStringify, {
    bullet: '-', fences: true, incrementListMarker: true,
  });

  // 'root' carries the top-level pages; this standalone site has none
  // (the MenuWright folder is the whole site), so the map stays empty.
  const rootSourceFiles = {};
  const sourceFiles = args.collection === 'root'
    ? (args.rootPage ? [rootSourceFiles[args.rootPage]] : Object.values(rootSourceFiles))
    : await walkMdxFiles(path.join(args.src, args.collection));
  if (sourceFiles.length === 0) throw new Error(`No MDX files found for ${args.collection}.`);

  const stats = { filesWritten: 0, codeGroupsConverted: 0, bareAccordionsWrapped: 0, repairedUpdates: 0, literalTemplateMarkers: 0, unmappedIcons: new Set() };
  for (const sourceFile of sourceFiles) {
    const relativePath = args.collection === 'root'
      ? (path.basename(sourceFile) === 'changelog.mdx' ? path.join('changelog', 'index.mdx') : path.basename(sourceFile))
      : path.relative(path.join(args.src, args.collection), sourceFile);
    const raw = await fs.readFile(sourceFile, 'utf8');
    const { frontmatter, body } = splitFrontmatter(raw, yaml);
    const repaired = repairUnclosedUpdateTags(body);
    stats.repairedUpdates += repaired.repairs;
    const tree = processor.parse(repaired.body);
    const neededLucideIcons = new Set();
    let needsBrandIcon = false;

    visit(tree, (node) => {
      // The Mintlify corpus is static prose. Any text expression (for example
      // `{METRO}` or `{lat}`) is a literal placeholder/example, not runtime
      // JavaScript, so emit it as text for Fumadocs.
      if (node.type === 'mdxTextExpression') {
        node.type = 'text';
        node.value = `{${node.value}}`;
        stats.literalTemplateMarkers += 1;
        return;
      }
      if (node.type !== 'mdxJsxFlowElement' && node.type !== 'mdxJsxTextElement') return;
      if (!node.name) return;
      const iconResult = transformElement(node, { neededLucideIcons, relativePath, stats });
      needsBrandIcon ||= iconResult.needsBrandIcon;
    });
    visit(tree, (node) => {
      if ((node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') && node.__codeGroup) {
        convertCodeGroupToTabs(node);
        stats.codeGroupsConverted += 1;
      }
    });
    wrapBareAccordions(tree, stats);

    const imports = [];
    if (neededLucideIcons.size > 0) imports.push(`import { ${[...neededLucideIcons].sort().join(', ')} } from 'lucide-react';`);
    if (needsBrandIcon) imports.push(`import { BrandIcon } from '@/components/brand-icons';`);
    if (imports.length > 0) tree.children.unshift({ type: 'mdxjsEsm', value: imports.join('\n') });

    const out = `---\n${yaml.stringify(frontmatter)}---\n\n${processor.stringify(tree).trimStart().trimEnd()}\n`;
    const destinationFile = args.collection === 'root'
      ? path.join(args.dest, relativePath)
      : path.join(args.dest, args.collection, relativePath);
    await ensureDir(path.dirname(destinationFile));
    await fs.writeFile(destinationFile, out, 'utf8');
    stats.filesWritten += 1;
  }

  if (stats.unmappedIcons.size > 0) {
    await ensureDir(path.dirname(UNMAPPED_ICON_REPORT));
    await fs.appendFile(UNMAPPED_ICON_REPORT, `${[...stats.unmappedIcons].sort().join('\n')}\n`, 'utf8');
  }
  console.log(JSON.stringify({ collection: args.collection, ...stats, unmappedIcons: [...stats.unmappedIcons].sort() }));
}

function splitFrontmatter(raw, yaml) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
  if (!match) return { frontmatter: {}, body: raw };
  return { frontmatter: yaml.parse(match[1]) ?? {}, body: raw.slice(match[0].length) };
}

// Two archived changelog files start a new Mintlify `<Update>` before closing
// the previous one. The source is intentionally immutable; close the prior
// generated wrapper so every historical entry remains visible and valid MDX.
function repairUnclosedUpdateTags(body) {
  const lines = body.split(/\r?\n/);
  const output = [];
  let open = false;
  let repairs = 0;
  for (const line of lines) {
    if (/^<Update\b/.test(line) && !/\/>\s*$/.test(line)) {
      if (open) {
        output.push('</Update>');
        repairs += 1;
      }
      open = true;
    } else if (/^<\/Update>\s*$/.test(line)) {
      open = false;
    }
    output.push(line);
  }
  if (open) {
    output.push('</Update>');
    repairs += 1;
  }
  return { body: output.join('\n'), repairs };
}

function getStringAttribute(node, name) {
  const attr = node.attributes?.find((candidate) => candidate.type === 'mdxJsxAttribute' && candidate.name === name);
  return attr && typeof attr.value === 'string' ? attr.value : undefined;
}

function removeAttribute(node, name) {
  node.attributes = node.attributes.filter((attr) => !(attr.type === 'mdxJsxAttribute' && attr.name === name));
}

function setAttribute(node, name, value) {
  removeAttribute(node, name);
  node.attributes.unshift({ type: 'mdxJsxAttribute', name, value });
}

function transformElement(node, context) {
  switch (node.name) {
    case 'Note': node.name = 'Callout'; break;
    case 'Tip': node.name = 'Callout'; setAttribute(node, 'type', 'info'); break;
    case 'Warning': node.name = 'Callout'; setAttribute(node, 'type', 'warn'); break;
    case 'Columns': node.name = 'Cards'; removeAttribute(node, 'cols'); break;
    case 'AccordionGroup': node.name = 'Accordions'; break;
    case 'Step': {
      const title = getStringAttribute(node, 'title');
      if (title !== undefined) {
        removeAttribute(node, 'title');
        node.children ??= [];
        node.children.unshift({ type: 'heading', depth: 3, children: [{ type: 'text', value: title }] });
      }
      break;
    }
    case 'CodeGroup': node.__codeGroup = true; break;
    default:
      if (!KNOWN_COMPONENTS.has(node.name)) console.warn(`Unknown MDX component passed through: ${node.name} (${context.relativePath})`);
  }

  if (node.name !== 'Card') return { needsBrandIcon: false };
  const iconName = getStringAttribute(node, 'icon');
  if (iconName === undefined) return { needsBrandIcon: false };
  if (isBrandIcon(iconName)) {
    setAttribute(node, 'icon', { type: 'mdxJsxAttributeValueExpression', value: `<BrandIcon name="${iconName}" />` });
    return { needsBrandIcon: true };
  }
  const genericIcon = mapGenericLucideIcon(iconName);
  if (genericIcon) {
    setAttribute(node, 'icon', { type: 'mdxJsxAttributeValueExpression', value: `<${genericIcon} />` });
    context.neededLucideIcons.add(genericIcon);
    return { needsBrandIcon: false };
  }

  removeAttribute(node, 'icon');
  context.stats.unmappedIcons.add(`${context.relativePath}: ${iconName}`);
  return { needsBrandIcon: false };
}

function convertCodeGroupToTabs(node) {
  delete node.__codeGroup;
  const codeChildren = (node.children ?? []).filter((child) => child.type === 'code');
  const labels = codeChildren.map((child, index) => (child.meta && child.meta.trim()) || child.lang || `Tab ${index + 1}`);
  node.name = 'Tabs';
  node.attributes = [{ type: 'mdxJsxAttribute', name: 'items', value: { type: 'mdxJsxAttributeValueExpression', value: JSON.stringify(labels) } }];
  node.children = codeChildren.map((code, index) => ({
    type: 'mdxJsxFlowElement', name: 'Tab', attributes: [{ type: 'mdxJsxAttribute', name: 'value', value: labels[index] }], children: [code],
  }));
}

function wrapBareAccordions(root, stats) {
  function visitChildren(node) {
    if (!Array.isArray(node.children)) return;
    const children = [];
    let run = [];
    const flush = () => {
      if (run.length === 0) return;
      children.push({ type: 'mdxJsxFlowElement', name: 'Accordions', attributes: [], children: run });
      stats.bareAccordionsWrapped += 1;
      run = [];
    };
    for (const child of node.children) {
      const isElement = child.type === 'mdxJsxFlowElement' || child.type === 'mdxJsxTextElement';
      if (isElement && child.name === 'Accordion') {
        run.push(child);
        continue;
      }
      flush();
      children.push(child);
      if (!(isElement && child.name === 'Accordions')) visitChildren(child);
    }
    flush();
    node.children = children;
  }
  visitChildren(root);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
