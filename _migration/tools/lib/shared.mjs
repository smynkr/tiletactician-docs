import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const filename = fileURLToPath(import.meta.url);
const dirname = path.dirname(filename);

export const REPO_ROOT = path.resolve(dirname, '..', '..', '..');
export const CONTENT_DOCS_DIR = path.join(REPO_ROOT, 'content', 'docs');
export const DEFAULT_MINTLIFY_DIR = REPO_ROOT;
export const PRODUCTS = ['tiletactician'];
export const CONTENT_COLLECTIONS = [...PRODUCTS];
export const UNMAPPED_ICON_REPORT = path.join(REPO_ROOT, '_migration', 'reports', 'unmapped-icons.txt');

const requireFromRepo = createRequire(path.join(REPO_ROOT, 'package.json'));

export function requireFromSite(packageName) {
  return requireFromRepo(packageName);
}

export async function importFromSite(packageName, subpath = 'index.js') {
  const modulePath = path.join(REPO_ROOT, 'node_modules', packageName, subpath);
  return import(pathToFileURL(modulePath).href);
}

// This list is deliberately explicit. Never fall back to a kebab-to-Pascal
// conversion: a matching Lucide export can be a semantically wrong icon (for
// example, its Apple is fruit, not the company logo).
const GENERIC_LUCIDE_ICONS = {
  anchor: 'Anchor',
  book: 'Book',
  'book-open': 'BookOpen',
  'circle-help': 'CircleQuestionMark',
  brain: 'Brain',
  'building-2': 'Building2',
  'calendar-clock': 'CalendarClock',
  'chart-line': 'ChartLine',
  clock: 'Clock',
  cloud: 'Cloud',
  compass: 'Compass',
  flame: 'Flame',
  database: 'Database',
  'file-text': 'FileText',
  'flask-conical': 'FlaskConical',
  gavel: 'Gavel',
  history: 'History',
  globe: 'Globe',
  'grid-2x2': 'Grid2x2',
  house: 'House',
  key: 'Key',
  landmark: 'Landmark',
  layers: 'Layers',
  'layout-dashboard': 'LayoutDashboard',
  leaf: 'Leaf',
  'life-buoy': 'LifeBuoy',
  mail: 'Mail',
  link: 'Link',
  map: 'Map',
  'map-pin': 'MapPin',
  'notebook-text': 'NotebookText',
  newspaper: 'Newspaper',
  package: 'Package',
  plug: 'Plug',
  radar: 'Radar',
  rocket: 'Rocket',
  'scan-line': 'ScanLine',
  rss: 'Rss',
  route: 'Route',
  scissors: 'Scissors',
  settings: 'Settings',
  'share-2': 'Share2',
  workflow: 'Workflow',
  shield: 'Shield',
  'shield-check': 'ShieldCheck',
  ship: 'Ship',
  sparkles: 'Sparkles',
  store: 'Store',
  target: 'Target',
  terminal: 'Terminal',
  trophy: 'Trophy',
  utensils: 'UtensilsCrossed',
  'triangle-alert': 'TriangleAlert',
};

const BRAND_ICONS = new Set(['apple', 'atlassian', 'aws', 'google', 'microsoft', 'slack']);

export function mapGenericLucideIcon(mintlifyName) {
  const mapped = GENERIC_LUCIDE_ICONS[mintlifyName];
  if (!mapped) return null;

  // Explicit mapping still has to agree with the installed Lucide version.
  return requireFromSite('lucide-react').icons[mapped] ? mapped : null;
}

export function isBrandIcon(mintlifyName) {
  return BRAND_ICONS.has(mintlifyName);
}

export async function walkMdxFiles(directory) {
  const results = [];
  async function walk(current) {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(fullPath);
      else if (entry.isFile() && entry.name.endsWith('.mdx')) results.push(fullPath);
    }
  }
  await walk(directory);
  return results.sort();
}

export async function ensureDir(directory) {
  await fs.mkdir(directory, { recursive: true });
}
