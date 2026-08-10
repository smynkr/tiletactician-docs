import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { remarkGfm } from "fumadocs-core/mdx-plugins/remark-gfm";
import { mapGenericLucideIcon } from "../_migration/tools/lib/shared.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const canonicalRoots = ["tiletactician"];

const localRequire = createRequire(import.meta.url);
const requireFromFumadocs = createRequire(localRequire.resolve("fumadocs-core/package.json"));
const { createProcessor } = await import(pathToFileURL(requireFromFumadocs.resolve("@mdx-js/mdx")).href);
const mdxProcessor = createProcessor({ remarkPlugins: [remarkGfm] });

function collectMdx(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) return collectMdx(file);
    return entry.isFile() && entry.name.endsWith(".mdx") ? [file] : [];
  });
}

function canonicalRoute(file) {
  const relative = path.relative(root, file).replaceAll(path.sep, '/').replace(/\.mdx$/, '');
  return relative.endsWith('/index') ? relative.slice(0, -6) : relative;
}

function navigationPages(value, insidePages = false) {
  if (Array.isArray(value)) return value.flatMap((item) => navigationPages(item, insidePages));
  if (!value || typeof value !== 'object') {
    return typeof value === 'string' && insidePages ? [value] : [];
  }
  return Object.entries(value).flatMap(([key, child]) => {
    if (key === 'pages') return navigationPages(child, true);
    if (key === 'page' && typeof child === 'string') return [child];
    return navigationPages(child, false);
  });
}

test('canonical product pages have metadata and navigation coverage', () => {
  const docs = JSON.parse(fs.readFileSync(path.join(root, 'docs.json'), 'utf8'));
  const navRoutes = new Set(
    navigationPages(docs.navigation).map((page) => page.replace(/^\/+/, '').replace(/\/index$/, '')),
  );
  const canonicalFiles = canonicalRoots.flatMap((sourceRoot) => collectMdx(path.join(root, sourceRoot)));

  // Fail closed: a misspelled or missing product root must not silently yield
  // zero files and pass the loop below.
  assert.ok(canonicalFiles.length > 0, 'canonical source inventory must not be empty');
  for (const sourceRoot of canonicalRoots) {
    assert.ok(
      collectMdx(path.join(root, sourceRoot)).length > 0,
      `${sourceRoot}/ must contain at least one canonical MDX page`,
    );
  }

  for (const file of canonicalFiles) {
    const relative = path.relative(root, file);
    const route = canonicalRoute(file);
    const metadata = parseFrontmatter(fs.readFileSync(file, "utf8"));
    assert.match(metadata.title ?? "", /\S/, `${relative} needs a non-empty title`);
    assert.match(metadata.description ?? "", /\S/, `${relative} needs a non-empty description`);
    if (!relative.startsWith(`changelog${path.sep}`)) {
      assert.equal(navRoutes.has(route), true, `${relative} is missing from docs.json navigation`);
    }
  }


  for (const product of canonicalRoots.filter((sourceRoot) => sourceRoot !== 'changelog')) {
    const indexFile = path.join(root, product, 'index.mdx');
    const onboardingFile = path.join(root, product, 'getting-started.mdx');
    assert.equal(fs.existsSync(indexFile), true, `${product}/index.mdx must exist as canonical source`);
    assert.equal(fs.existsSync(onboardingFile), true, `${product}/getting-started.mdx must exist as canonical source`);
    assert.equal(navRoutes.has(product), true, `${product}/index.mdx must be navigable`);
    assert.equal(navRoutes.has(`${product}/getting-started`), true, `${product}/getting-started.mdx must be navigable`);
  }

  // Inverse direction: every navigation route must resolve to a canonical
  // source file, so docs.json cannot point at missing pages.
  for (const route of navRoutes) {
    const file = path.join(root, `${route}.mdx`);
    const indexFile = path.join(root, route, 'index.mdx');
    assert.equal(
      fs.existsSync(file) || fs.existsSync(indexFile),
      true,
      `${route} is listed in docs.json navigation but has no canonical MDX source`,
    );
  }
});

const { parse: parseYaml } = localRequire('yaml');

function parseFrontmatter(text) {
  const match = text.match(/^---\s*\n([\s\S]*?)\n---(?:\s*\n|$)/);
  if (!match) return {};
  let parsed;
  try {
    parsed = parseYaml(match[1]);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  return Object.fromEntries(
    Object.entries(parsed)
      .filter(([, value]) => typeof value === 'string' || typeof value === 'number')
      .map(([key, value]) => [key, typeof value === 'number' ? String(value) : value]),
  );
}

function staticAttributeValue(attribute) {
  if (typeof attribute.value === "string") return attribute.value;
  if (attribute.value?.type !== "mdxJsxAttributeValueExpression") return null;
  const expression = attribute.value.data?.estree?.body?.[0]?.expression;
  if (expression?.type === "Literal" && typeof expression.value === "string") return expression.value;
  if (expression?.type === "TemplateLiteral" && expression.expressions.length === 0) {
    const cooked = expression.quasis[0]?.value?.cooked;
    if (typeof cooked === "string") return cooked;
  }
  return null;
}

/** Return true when an MDX document contains a legacy typed warning Callout. */
export function hasLegacyWarningCallout(text) {
  const tree = mdxProcessor.parse(text);
  const legacyTypes = new Set(["warn", "warning", "danger", "error"]);
  let found = false;
  const visit = (node) => {
    if (found || !node || typeof node !== "object") return;
    if ((node.type === "mdxJsxFlowElement" || node.type === "mdxJsxTextElement") && node.name === "Callout") {
      const type = (node.attributes ?? []).find((attribute) => attribute.type === "mdxJsxAttribute" && attribute.name === "type");
      const value = type && staticAttributeValue(type);
      if (typeof value === "string" && legacyTypes.has(value.trim().toLowerCase())) found = true;
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(tree);
  return found;
}



test("canonical warning callouts use Mintlify's semantic component", () => {
  const legacy = [];
  for (const sourceRoot of canonicalRoots) {
    for (const file of collectMdx(path.join(root, sourceRoot))) {
      const text = fs.readFileSync(file, "utf8");
      if (hasLegacyWarningCallout(text)) legacy.push(path.relative(root, file));
    }
  }
  for (const rootFile of ["tiletactician/getting-started.mdx"]) {
    const text = fs.readFileSync(path.join(root, rootFile), "utf8");
    if (hasLegacyWarningCallout(text)) legacy.push(rootFile);
  }
  assert.deepEqual(legacy, []);
});

test("legacy warning Callout detection is structural and ignores inert MDX", () => {
  const cases = [
    ['<Callout type="warn">legacy</Callout>', true],
    ['<Callout type = "warning">legacy</Callout>', true],
    ["<Callout type={'danger'}>legacy</Callout>", true],
    ["<Callout type={'w\\u0061rn'}>legacy</Callout>", true],
    ['<Callout type={"\\x77arn"}>legacy</Callout>', true],
    ['<Callout type="  warn  ">legacy</Callout>', true],
    ["<Callout type={'  warning  '}>legacy</Callout>", true],
    ["<Callout type={`d\\u0061nger`}>legacy</Callout>", true],
    ["<Callout type={`${kind}`}>dynamic</Callout>", false],
    ['<Callout title="x" type="ERROR">legacy</Callout>', true],
    ['<Callout\n  title="x > y"\n  type = {"warn"}\n>legacy</Callout>', true],
    ['```mdx\n<Callout type="warn">example</Callout>\n```', false],
    ['{/* <Callout type="warn">example</Callout> */}\n<Warning>semantic</Warning>', false],
    ['<Callout type={severity}>dynamic</Callout>', false],
    ['<Warning>semantic</Warning>', false],
  ];
  for (const [source, expected] of cases) assert.equal(hasLegacyWarningCallout(source), expected, source);
});

test("product identity accents are unique", () => {
  const source = fs.readFileSync(path.join(root, 'components', 'brand', 'products.ts'), 'utf8');
  const accents = [...source.matchAll(/accent:\s*'#([0-9A-Fa-f]{6})'/g)].map((match) => match[1].toLowerCase());
  assert.ok(accents.length >= 1, `expected at least one product accent, found ${accents.length}`);
  assert.equal(new Set(accents).size, accents.length, 'product accents must be unique so the hub legend and cards stay distinguishable');
});

test("migration maps semantic generic card icons", () => {
  assert.equal(mapGenericLucideIcon("book"), "Book");
  assert.equal(mapGenericLucideIcon("terminal"), "Terminal");
  assert.equal(mapGenericLucideIcon("utensils"), "UtensilsCrossed");
});