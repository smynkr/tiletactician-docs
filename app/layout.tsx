import { RootProvider } from 'fumadocs-ui/provider/next';
import './global.css';
import { Inter, JetBrains_Mono, Playfair_Display } from 'next/font/google';
import { DocsSearchDialog } from '@/components/docs-search-dialog';
import { PostHogProvider } from '@/components/posthog-provider';
import type { Metadata } from 'next';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
});

const playfair = Playfair_Display({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-display',
});

// global.css declares `--font-mono: 'JetBrains Mono', …` but never loaded it,
// so code silently fell back to system mono. Load it like Inter/Playfair.
const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
});

const siteDescription =
  'TileTactician documentation — Scrabble and Crossplay board analysis: every legal play, ranked by score, in real time.';

export const metadata: Metadata = {
  metadataBase: new URL('https://docs.tiletactician.com'),
  applicationName: 'TileTactician Docs',
  title: {
    default: 'TileTactician Docs',
    template: '%s · TileTactician Docs',
  },
  description: siteDescription,
  category: 'technology',
  icons: {
    icon: '/favicon.svg',
    apple: '/favicon.svg',
  },
  openGraph: {
    type: 'website',
    siteName: 'TileTactician Docs',
    title: { default: 'TileTactician Docs', template: '%s · TileTactician Docs' },
    description: siteDescription,
  },
  twitter: {
    card: 'summary_large_image',
    title: { default: 'TileTactician Docs', template: '%s · TileTactician Docs' },
    description: siteDescription,
  },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className="scroll-smooth"
      suppressHydrationWarning
    >
      <body className={[inter.variable, playfair.variable, jetbrainsMono.variable].join(' ')}>
        <PostHogProvider>
          <RootProvider search={{ SearchDialog: DocsSearchDialog }}>
            {children}
          </RootProvider>
        </PostHogProvider>
      </body>
    </html>
  );
}
