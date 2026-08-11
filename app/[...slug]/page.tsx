import { DocsContentPage } from '@/components/docs-content-page';
import { CHANGELOG_SLUG, getPageImage, source } from '@/lib/source';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

export default async function Page(props: PageProps<'/[...slug]'>) {
  const { slug } = await props.params;
  const page = source.getPage(slug);
  if (!page) notFound();
  return <DocsContentPage page={page} />;
}

export function generateStaticParams() {
  // `/` is rendered by app/(home)/page.tsx; a required catch-all must only
  // generate non-empty slugs or Next would try to export `/` twice.
  // `/changelog/*` is owned by app/changelog/[[...slug]] (isolated layout, no
  // product switcher); exclude it here to avoid generating duplicate routes.
  return source
    .generateParams()
    .filter((params) => params.slug.length > 0 && params.slug[0] !== CHANGELOG_SLUG);
}

export async function generateMetadata(props: PageProps<'/[...slug]'>): Promise<Metadata> {
  const { slug } = await props.params;
  const page = source.getPage(slug);
  if (!page) notFound();
  return {
    title: page.data.title,
    description: page.data.description,
    openGraph: {
      type: 'website',
      siteName: 'TileTactician Docs',
      title: page.data.title,
      description: page.data.description,
      images: getPageImage(page).url,
    },
    twitter: {
      card: 'summary_large_image',
      title: page.data.title,
      description: page.data.description,
      images: getPageImage(page).url,
    },
  };
}
