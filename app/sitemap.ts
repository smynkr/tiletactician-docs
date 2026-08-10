import type { MetadataRoute } from 'next';
import { source } from '@/lib/source';

const BASE = 'https://docs.tiletactician.com';

export default function sitemap(): MetadataRoute.Sitemap {
  const pages = source
    .getPages()
    // / 308-redirects to /getting-started; a redirecting URL must not be
    // submitted in the sitemap, and getting-started takes the top slot.
    .filter((page) => page.url !== '/')
    .map((page) => ({
      url: `${BASE}${page.url}`,
      changeFrequency: 'weekly' as const,
      priority: page.url === '/getting-started' ? 1 : page.slugs.length <= 1 ? 0.8 : 0.6,
    }));

  return pages;
}
