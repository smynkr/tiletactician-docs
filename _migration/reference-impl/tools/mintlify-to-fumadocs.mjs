#!/usr/bin/env node
// Mintlify -> Fumadocs MDX codemod.
//
// Usage:
//   node mintlify-to-fumadocs.mjs --product layer [--src <mintlify-docs-dir>] [--dest <fumadocs content/docs dir>]
//
// Reads every .mdx page under <src>/<product>/**, rewrites it into
// Fumadocs-shaped MDX (component names, props, internal links), and writes
// the result under <dest>/<product>/** with the same relative paths (so
// site-absolute Mintlify links keep working 1:1 after the /docs prefix).
//
// Component mapping implemented (this is the FULL, exhaustive list — the
// corpus census turned up nothing else):
//   <Note>            -> <Callout>
//   <Tip>              -> <Callout type="info">
//   <Warning>          -> <Callout type="warn">
//   <Card>             -> Fumadocs <Card>, icon mapped to a lucide-react
//                          component when an exact name match exists,
//                          otherwise dropped (never emits a broken icon).
//   <Columns cols={n}> -> <Cards> (cols dropped; Fumadocs Cards has no such prop)
//   <AccordionGroup>   -> <Accordions>
//   <Accordion>        -> <Accordion> unchanged, but a bare <Accordion> with
//                          no <AccordionGroup>/<Accordions> parent is wrapped
//                          in a synthesized <Accordions> (Fumadocs requires it)
//   <Steps>/<Step>     -> <Steps>/<Step>; Step's `title` prop is dropped (the
//                          real fumadocs-ui Step takes no title prop) and
//                          reinserted as an `### <title>` heading, the
//                          documented Fumadocs convention for step titles.
//   <CodeGroup>        -> <Tabs> with one <Tab value="..."> per code fence,
//                          value taken from the fence's meta string
//                          ("```bash cURL" -> value "cURL").
//   <Update label tags> -> left as-is; resolved at render time by the local
//                          `Update` shim registered in components/mdx.tsx.
//
// Internal links: any href/markdown-link starting with /<product>/... or
// /changelog is rewritten to /docs/<product>/... (see rewriteHref() in
// tools/lib/shared.mjs for the "/index" stripping rule, which mirrors
// Fumadocs' own slug generation).
//
// Frontmatter: title/description are passed through verbatim; tag/mode (the
// only other frontmatter keys anywhere in the corpus) are passed through too
// — Fumadocs' pageSchema silently strips unrecognized keys, so this is inert
// but preserves round-trip fidelity.

import path from 'node:path';
import fs from 'node:fs/promises';
import {
  SITE_DIR,
  CONTENT_DOCS_DIR,
  DEFAULT_MINTLIFY_DIR,
  PRODUCTS,
  importFromSite,
  requireFromSite,
  mapLucideIcon,
  rewriteHref,
  walkMdxFiles,
  ensureDir,
} from './lib/shared.mjs';

const KNOWN_COMPONENTS = new Set([
  'Note',
  'Tip',
  'Warning',
  'Card',
  'Cards',
  'Columns',
  'Accordion',
  'AccordionGroup',
  'Accordions',
  'Steps',
  'Step',
  'CodeGroup',
  'Tabs',
  'Tab',
  'Update',
]);

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

function printHelp() {
  console.log(`Mintlify -> Fumadocs codemod

  --product <name>   Required. One of: ${PRODUCTS.join(', ')}
  --src <dir>         Mintlify docs root (default: ${DEFAULT_MINTLIFY_DIR})
  --dest <dir>        Fumadocs content/docs root (default: ${CONTENT_DOCS_DIR})
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.product) {
    printHelp();
    process.exit(args.help ? 0 : 1);
  }
  if (!PRODUCTS.includes(args.product)) {
    console.error(`Unknown product "${args.product}". Expected one of: ${PRODUCTS.join(', ')}`);
    process.exit(1);
  }

  const srcDir = path.join(args.src, args.product);
  const destDir = path.join(args.dest, args.product);

  const [{ unified }, { default: remarkParse }, { default: remarkGfm }, { default: remarkMdx }, { default: remarkStringify }, { visit }] =
    await Promise.all([
      importFromSite('unified'),
      importFromSite('remark-parse'),
      importFromSite('remark-gfm'),
      importFromSite('remark-mdx'),
      importFromSite('remark-stringify'),
      importFromSite('unist-util-visit'),
    ]);
  const yaml = requireFromSite('yaml');

  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMdx)
    .use(remarkStringify, { bullet: '-', fences: true, incrementListMarker: true });

  const stats = {
    filesWritten: 0,
    iconsMapped: [],
    iconsDropped: [],
    codeGroupsConverted: 0,
    bareAccordionsWrapped: 0,
    unknownComponents: new Set(),
  };

  const files = await walkMdxFiles(srcDir);
  if (files.length === 0) {
    console.error(`No .mdx files found under ${srcDir}`);
    process.exit(1);
  }

  for (const absSrcFile of files) {
    const rel = path.relative(srcDir, absSrcFile);
    const raw = await fs.readFile(absSrcFile, 'utf8');
    const { frontmatter, body } = splitFrontmatter(raw, yaml);

    const tree = processor.parse(body);
    const neededIcons = new Set();

    visit(tree, (node) => {
      if (node.type === 'link') {
        node.url = rewriteHref(node.url);
        return;
      }
      if (node.type !== 'mdxJsxFlowElement' && node.type !== 'mdxJsxTextElement') return;
      if (!node.name) return; // fragments (<>...</>) — nothing to do

      transformElement(node, { rewriteHref, mapLucideIcon, neededIcons, stats, file: rel });
    });

    // CodeGroup -> Tabs needs to see the parsed children, run separately
    // (it replaces the node's own children shape, unlike the simple
    // rename-in-place transforms above).
    visit(tree, (node) => {
      if ((node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') && node.__codeGroup) {
        convertCodeGroupToTabs(node);
        stats.codeGroupsConverted++;
      }
    });

    wrapBareAccordions(tree, stats);

    if (neededIcons.size > 0) {
      const names = [...neededIcons].sort();
      tree.children.unshift({
        type: 'mdxjsEsm',
        value: `import { ${names.join(', ')} } from 'lucide-react';`,
      });
    }

    const outBody = processor.stringify(tree);
    const outFrontmatter = yaml.stringify(frontmatter);
    const out = `---\n${outFrontmatter}---\n\n${outBody.trimStart()}\n`;

    const destFile = path.join(destDir, rel);
    await ensureDir(path.dirname(destFile));
    await fs.writeFile(destFile, out, 'utf8');
    stats.filesWritten++;
  }

  console.log(`\nPorted ${stats.filesWritten} page(s) from ${srcDir} -> ${destDir}`);
  if (stats.iconsMapped.length) {
    console.log(`Icons mapped to lucide-react: ${[...new Set(stats.iconsMapped)].sort().join(', ')}`);
  }
  if (stats.iconsDropped.length) {
    console.log(`Icons dropped (no lucide match): ${[...new Set(stats.iconsDropped)].sort().join(', ')}`);
  }
  if (stats.codeGroupsConverted) {
    console.log(`<CodeGroup> -> <Tabs> conversions: ${stats.codeGroupsConverted}`);
  }
  if (stats.bareAccordionsWrapped) {
    console.log(`Bare <Accordion> runs wrapped in synthesized <Accordions>: ${stats.bareAccordionsWrapped}`);
  }
  if (stats.unknownComponents.size) {
    console.warn(
      `WARNING: encountered component(s) outside the known census — passed through unchanged: ${[...stats.unknownComponents].join(', ')}`,
    );
  }
}

function splitFrontmatter(raw, yaml) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
  if (!m) return { frontmatter: {}, body: raw };
  const frontmatter = yaml.parse(m[1]) ?? {};
  const body = raw.slice(m[0].length);
  return { frontmatter, body };
}

function getStringAttr(node, name) {
  const attr = node.attributes?.find((a) => a.type === 'mdxJsxAttribute' && a.name === name);
  if (!attr) return undefined;
  return typeof attr.value === 'string' ? attr.value : undefined;
}

function removeAttr(node, name) {
  node.attributes = node.attributes.filter((a) => !(a.type === 'mdxJsxAttribute' && a.name === name));
}

function setAttr(node, name, value) {
  removeAttr(node, name);
  node.attributes.unshift({ type: 'mdxJsxAttribute', name, value });
}

function transformElement(node, ctx) {
  const { mapLucideIcon: mapIcon, neededIcons, stats, file } = ctx;

  switch (node.name) {
    case 'Note': {
      node.name = 'Callout';
      break;
    }
    case 'Tip': {
      node.name = 'Callout';
      setAttr(node, 'type', 'info');
      break;
    }
    case 'Warning': {
      node.name = 'Callout';
      setAttr(node, 'type', 'warn');
      break;
    }
    case 'Columns': {
      node.name = 'Cards';
      removeAttr(node, 'cols');
      break;
    }
    case 'AccordionGroup': {
      node.name = 'Accordions';
      break;
    }
    case 'Step': {
      const title = getStringAttr(node, 'title');
      if (title !== undefined) {
        removeAttr(node, 'title');
        node.children = node.children || [];
        node.children.unshift({ type: 'heading', depth: 3, children: [{ type: 'text', value: title }] });
      }
      break;
    }
    case 'CodeGroup': {
      // Marked for a second pass (needs the already-parsed `code` children,
      // which is easiest to do as its own visit rather than inline here).
      node.__codeGroup = true;
      break;
    }
    case 'Card':
    case 'Accordion':
    case 'Accordions':
    case 'Cards':
    case 'Steps':
    case 'Update':
    case 'Tabs':
    case 'Tab':
      break; // name unchanged; attribute handling (icon/href) below is generic
    default:
      stats.unknownComponents.add(`${node.name} (${file})`);
  }

  // Generic href rewrite — applies to Card today, and to anything else that
  // ever grows an href prop.
  for (const attr of node.attributes ?? []) {
    if (attr.type === 'mdxJsxAttribute' && attr.name === 'href' && typeof attr.value === 'string') {
      attr.value = ctx.rewriteHref(attr.value);
    }
  }

  // Card icon: Mintlify passes a bare icon-name string; Fumadocs' Card wants
  // a ReactNode. Map to a lucide-react component when the name matches
  // exactly, otherwise drop the prop rather than emit something broken.
  if (node.name === 'Card') {
    const iconName = getStringAttr(node, 'icon');
    if (iconName !== undefined) {
      const mapped = mapIcon(iconName);
      if (mapped) {
        setAttr(node, 'icon', { type: 'mdxJsxAttributeValueExpression', value: `<${mapped} />` });
        neededIcons.add(mapped);
        stats.iconsMapped.push(iconName);
      } else {
        removeAttr(node, 'icon');
        stats.iconsDropped.push(iconName);
      }
    }
  }
}

/**
 * <CodeGroup>
 *   ```bash cURL
 *   ...
 *   ```
 *   ```ts SDK
 *   ...
 *   ```
 * </CodeGroup>
 * ->
 * <Tabs items={["cURL", "SDK"]}>
 *   <Tab value="cURL">```bash ... ```</Tab>
 *   <Tab value="SDK">```ts ... ```</Tab>
 * </Tabs>
 */
function convertCodeGroupToTabs(node) {
  delete node.__codeGroup;
  node.name = 'Tabs';

  const codeChildren = (node.children ?? []).filter((c) => c.type === 'code');
  const labels = codeChildren.map((c, i) => (c.meta && c.meta.trim()) || c.lang || `Tab ${i + 1}`);

  node.attributes = [
    { type: 'mdxJsxAttribute', name: 'items', value: { type: 'mdxJsxAttributeValueExpression', value: JSON.stringify(labels) } },
  ];
  node.children = codeChildren.map((codeNode, i) => ({
    type: 'mdxJsxFlowElement',
    name: 'Tab',
    attributes: [{ type: 'mdxJsxAttribute', name: 'value', value: labels[i] }],
    children: [codeNode],
  }));
}

/**
 * Fumadocs requires every <Accordion> to live inside an <Accordions>. Most
 * of the corpus already wraps them in <AccordionGroup> (renamed to
 * <Accordions> above), but a handful of pages use bare, ungrouped
 * <Accordion> elements. This walks every node's children list and wraps any
 * *consecutive run* of bare <Accordion> siblings in a synthesized
 * <Accordions>, without re-entering nodes that are already an <Accordions>
 * (real or synthesized) to avoid double-wrapping.
 */
function wrapBareAccordions(root, stats) {
  function visitChildren(node) {
    if (!Array.isArray(node.children)) return;

    const newChildren = [];
    let run = [];
    const flushRun = () => {
      if (run.length === 0) return;
      newChildren.push({ type: 'mdxJsxFlowElement', name: 'Accordions', attributes: [], children: run });
      stats.bareAccordionsWrapped++;
      run = [];
    };

    for (const child of node.children) {
      const isBareAccordion =
        (child.type === 'mdxJsxFlowElement' || child.type === 'mdxJsxTextElement') && child.name === 'Accordion';
      if (isBareAccordion) {
        run.push(child);
        continue;
      }
      flushRun();
      newChildren.push(child);
      const isAlreadyGrouped =
        (child.type === 'mdxJsxFlowElement' || child.type === 'mdxJsxTextElement') && child.name === 'Accordions';
      if (!isAlreadyGrouped) visitChildren(child);
    }
    flushRun();
    node.children = newChildren;
  }
  visitChildren(root);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
