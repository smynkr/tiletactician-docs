#!/usr/bin/env node

/** Validate links, fragments, navigation routes, and public assets in canonical MDX. */
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { remarkGfm } from "fumadocs-core/mdx-plugins/remark-gfm";
import { remarkHeading } from "fumadocs-core/mdx-plugins/remark-heading";

// Resolve the MDX parser from the direct Fumadocs dependency that owns it. This
// stays correct whether npm hoists @mdx-js/mdx or nests it under fumadocs-core.
const localRequire = createRequire(import.meta.url);
const requireFromFumadocs = createRequire(localRequire.resolve("fumadocs-core/package.json"));
const { createProcessor } = await import(pathToFileURL(requireFromFumadocs.resolve("@mdx-js/mdx")).href);
const headingProcessor = createProcessor({ remarkPlugins: [remarkGfm] });
const addFumadocsHeadingIds = remarkHeading();

export const sourceRoots = ["tiletactician"];
export const sourceFiles = [];
const assetExtensions = new Set([".avif", ".csv", ".css", ".gif", ".ico", ".jpeg", ".jpg", ".json", ".map", ".mov", ".mp3", ".mp4", ".pdf", ".png", ".svg", ".txt", ".webmanifest", ".webp", ".woff", ".woff2", ".xml", ".zip"]);
const appRoutes = new Set(["/llms.txt", "/llms-full.txt", "/robots.txt", "/sitemap.xml", "/opengraph-image", ]);
const appRoutePrefixes = ["/api/", "/_next/", "/llms.mdx/docs/", "/og/docs/"];

function collect(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) return collect(file);
    return entry.isFile() && entry.name.endsWith(".mdx") ? [file] : [];
  });
}

export function routeFor(root, file) {
  const rel = path.relative(root, file).replaceAll(path.sep, "/");
  const withoutExt = rel.replace(/\.mdx$/, "");
  const route = withoutExt.endsWith("/index") ? withoutExt.slice(0, -6) : withoutExt;
  return `/${route}`.replace(/\/+/g, "/").replace(/\/$/, "") || "/";
}

export function normalize(value) {
  const pathname = value.split(/[?#]/, 1)[0].replace(/\/+/g, "/");
  const withoutIndex = pathname.replace(/\/index\/?$/, "/");
  return withoutIndex.replace(/\/$/, "") || "/";
}

/** Resolve a document-relative target the way a browser resolves it from the served URL. */
export function resolveTarget(root, file, rawTarget) {
  if (ignored(rawTarget) || rawTarget.startsWith("/") || rawTarget.startsWith("#")) return rawTarget;
  const servedRoute = routeFor(root, file) || "/";
  const resolved = new URL(rawTarget, `https://docs.invalid${servedRoute}`);
  return resolved.pathname + resolved.search + resolved.hash;
}

function visit(node, visitor) {
  visitor(node);
  if (Array.isArray(node.children)) node.children.forEach((child) => visit(child, visitor));
}

function parseDocument(text) {
  const lines = text.split("\n");
  const closingFrontmatter = lines[0]?.trim() === "---"
    ? lines.findIndex((line, index) => index > 0 && line.trim() === "---")
    : -1;
  const lineOffset = closingFrontmatter >= 0 ? closingFrontmatter + 1 : 0;
  const body = lineOffset > 0 ? lines.slice(lineOffset).join("\n") : text;
  const tree = headingProcessor.parse(body);
  const file = { data: {} };
  addFumadocsHeadingIds(tree, file);
  return {
    headings: new Set((file.data.toc ?? []).map((entry) => entry.url.slice(1))),
    lineOffset,
    tree,
  };
}

function attributeTarget(attribute) {
  if (typeof attribute.value === "string") return { kind: "static", value: attribute.value };
  if (attribute.value?.type !== "mdxJsxAttributeValueExpression") return { kind: "dynamic" };
  const value = attribute.value.value.trim();
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      return { kind: "static", value: JSON.parse(value) };
    } catch {
      return { kind: "dynamic" };
    }
  }
  if (value.startsWith("'") && value.endsWith("'")) {
    return { kind: "static", value: value.slice(1, -1).replaceAll("\\'", "'") };
  }
  if (value.startsWith("`") && value.endsWith("`")) {
    const template = value.slice(1, -1);
    if (!/(^|[^\\])\$\{/.test(template)) {
      return { kind: "static", value: template.replaceAll("\\`", "`") };
    }
  }
  return { kind: "dynamic" };
}

function targets(document) {
  const definitions = new Map();
  const found = [];
  visit(document.tree, (node) => {
    if (node.type === "definition") definitions.set(node.identifier, node.url);
  });
  visit(document.tree, (node) => {
    let value = null;
    if (node.type === "link" || node.type === "image") value = node.url;
    if (node.type === "linkReference" || node.type === "imageReference") value = definitions.get(node.identifier);
    if (typeof value === "string") {
      found.push({ value, line: document.lineOffset + (node.position?.start.line ?? 1) });
    }
    if (node.type !== "mdxJsxFlowElement" && node.type !== "mdxJsxTextElement") return;
    for (const attribute of node.attributes ?? []) {
      if (attribute.type !== "mdxJsxAttribute" || (attribute.name !== "href" && attribute.name !== "src")) continue;
      const target = attributeTarget(attribute);
      const line = document.lineOffset + (attribute.position?.start.line ?? node.position?.start.line ?? 1);
      if (target.kind === "static") {
        found.push({ value: target.value, line });
      } else {
        found.push({ failure: `non-static JSX ${attribute.name} cannot be validated; use a literal URL`, line });
      }
    }
  });
  return found;
}

function ignored(value) {
  return !value || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(value);
}

function location(root, file, line) {
  return `${path.relative(root, file)}:${line}`;
}

function parseNav(value, insidePages = false) {
  if (!value || typeof value === "string") return typeof value === "string" && insidePages ? [value] : [];
  if (Array.isArray(value)) return value.flatMap((item) => parseNav(item, insidePages));
  if (typeof value === "object") {
    return Object.entries(value).flatMap(([key, child]) => {
      if (key === "pages") return parseNav(child, true);
      if (key === "page" && typeof child === "string") return [child];
      return child && typeof child === "object" ? parseNav(child, false) : [];
    });
  }
  return [];
}

export function check({ root = process.cwd() } = {}) {
  const files = sourceFiles.filter((file) => fs.existsSync(path.join(root, file))).map((file) => path.join(root, file));
  for (const dir of sourceRoots) files.push(...collect(path.join(root, dir)));
  const routeFiles = new Map([["/", null]]);
  const routeCollisions = [];
  const routeSources = new Map();
  for (const file of [...files].sort()) {
    const route = routeFor(root, file);
    const sources = routeSources.get(route) ?? [];
    sources.push(file);
    routeSources.set(route, sources);
    if (!routeFiles.has(route)) routeFiles.set(route, file);
  }
  for (const [route, sources] of routeSources) {
    if (sources.length > 1) {
      routeCollisions.push(`duplicate canonical route ${route}: ${sources.map((file) => path.relative(root, file).replaceAll(path.sep, "/")).join(", ")}`);
    }
  }
  // `/` renders the product index (app/(home)/page.tsx) without
  // replacing fragments, so root links must validate against that canonical
  // document's headings.
  const rootIndex = routeFiles.get("/tiletactician") ?? routeFiles.get("/getting-started");
  if (rootIndex) routeFiles.set("/", rootIndex);
  const docsPath = path.join(root, "docs.json");
  const navRoutes = [];
  const navHrefs = [];
  if (fs.existsSync(docsPath)) {
    const docs = JSON.parse(fs.readFileSync(docsPath, "utf8"));
    for (const page of parseNav(docs.navigation)) {
      if (typeof page === "string") {
        const route = normalize(`/${page}`);
        navRoutes.push(route);
        if (!routeFiles.has(route)) routeFiles.set(route, undefined);
      }
    }
    const walkHrefs = (value) => {
      if (Array.isArray(value)) return value.forEach(walkHrefs);
      if (!value || typeof value !== "object") return;
      if (typeof value.href === "string") navHrefs.push(value.href);
      Object.values(value).forEach(walkHrefs);
    };
    walkHrefs(docs);
  }
  const documents = new Map(files.map((file) => [file, parseDocument(fs.readFileSync(file, "utf8"))]));
  const headingMap = new Map([...routeFiles].map(([route, file]) => [route, file && documents.get(file)?.headings]));
  const failures = [...routeCollisions];
  for (const route of navRoutes) if (routeFiles.get(route) === undefined) failures.push(`docs.json: navigation route ${route} has no canonical MDX source`);
  const publicRoot = path.resolve(root, "public");
  const isAppRoute = (route) => appRoutes.has(route) || appRoutePrefixes.some((prefix) => route.startsWith(prefix));
  const checkTarget = (file, rawTarget, line) => {
    if (ignored(rawTarget)) return;
    let target = rawTarget;
    target = resolveTarget(root, file, target);
    const [pathname, fragment] = target.split("#", 2);
    const route = normalize(pathname || routeFor(root, file));
    const ext = path.extname(pathname.split("?")[0]).toLowerCase();
    if (isAppRoute(route)) return;
    if (assetExtensions.has(ext)) {
      const candidate = path.resolve(publicRoot, `.${pathname.split("?", 1)[0]}`);
      if (candidate === publicRoot || !candidate.startsWith(`${publicRoot}${path.sep}`) || !fs.existsSync(candidate)) failures.push(`${location(root, file, line)}: missing public asset ${rawTarget}`);
      return;
    }
    if (!routeFiles.has(route) || routeFiles.get(route) === undefined) failures.push(`${location(root, file, line)}: unresolved route ${rawTarget}`);
    else if (fragment && !headingMap.get(route)?.has(fragment)) failures.push(`${location(root, file, line)}: unresolved fragment ${rawTarget}`);
  };
  for (const file of files) {
    for (const target of targets(documents.get(file))) {
      if (target.failure) failures.push(`${location(root, file, target.line)}: ${target.failure}`);
      else checkTarget(file, target.value, target.line);
    }
  }
  for (const href of navHrefs) checkTarget(docsPath, href, 1);
  return { files, routes: routeFiles, failures };
}

export function isCliInvocation({ moduleUrl = import.meta.url, argv1 = process.argv[1] } = {}) {
  return Boolean(argv1) && moduleUrl === pathToFileURL(argv1).href;
}

if (isCliInvocation()) {
  const rootArg = process.argv.indexOf("--root");
  const root = rootArg >= 0 ? path.resolve(process.argv[rootArg + 1]) : process.cwd();
  const result = check({ root });
  if (result.failures.length) {
    console.error(`Found ${result.failures.length} unresolved documentation link${result.failures.length === 1 ? "" : "s"}:`);
    result.failures.forEach((failure) => console.error(`  ${failure}`));
    process.exitCode = 1;
  } else console.log(`Internal documentation links are valid (${result.files.length} sources, ${result.routes.size} routes).`);
}
