import type { MetadataRoute } from 'next';
import { source } from '@/lib/source';

const BASE = 'https://docs.tiletactician.com';

export default function sitemap(): MetadataRoute.Sitemap {
  const pages = source
    .getPages()
    // `/` is an internal rewrite to `/tiletactician` (the landing); a URL
    // that never appears in the address bar must not be submitted in the
    // sitemap, and the landing takes its own top-level slot.
    .filter((page) => page.url !== '/')
    .map((page) => ({
      url: `${BASE}${page.url}`,
      changeFrequency: 'weekly' as const,
      priority: page.url === '/getting-started' ? 1 : page.slugs.length <= 1 ? 0.8 : 0.6,
    }));

  return pages;
}
