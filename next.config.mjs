import { withSentryConfig } from '@sentry/nextjs';
import { createMDX } from 'fumadocs-mdx/next';

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  // The site serves local SVG wordmarks and plain MDX screenshots; it does not
  // need Next's native raster optimizer. Keep optimization disabled so
  // untrusted raster input cannot reach the optional Sharp decoder.
  images: { unoptimized: true },
  // Pin the workspace root: stray lockfiles in ~ and ~/Documents make Turbopack
  // infer a root above this repo and fail on ~'s offloaded node_modules symlink.
  turbopack: { root: import.meta.dirname },
  async redirects() {
    return [
      // Browsers probe /favicon.ico even though we serve /favicon.svg.
      { source: '/favicon.ico', destination: '/favicon.svg', permanent: true },
      // Mintlify served section indexes at /<section>/index; Fumadocs serves
      // them at /<section>. Keep old deep links and bookmarks working.
      { source: '/tiletactician/index', destination: '/tiletactician', permanent: true },
    ];
  },
  async rewrites() {
    return [
      // Clean standalone URLs: docs.tiletactician.com/<page> serves the
      // /tiletactician/<page> route. The canonical source keeps its product
      // prefix; the rewrite keeps the pretty URL in the address bar.
      { source: '/', destination: '/tiletactician' },
      { source: '/getting-started', destination: '/tiletactician/getting-started' },
      { source: '/board-entry', destination: '/tiletactician/board-entry' },
      { source: '/board-scanning', destination: '/tiletactician/board-scanning' },
      { source: '/rack-analysis', destination: '/tiletactician/rack-analysis' },
      { source: '/endgame', destination: '/tiletactician/endgame' },
      { source: '/tile-bag', destination: '/tiletactician/tile-bag' },
      { source: '/share-extension', destination: '/tiletactician/share-extension' },
      { source: '/faq', destination: '/tiletactician/faq' },
      { source: '/changelog', destination: '/tiletactician/changelog' },
    ];
  },
};

export default withSentryConfig(withMDX(config), { silent: true });
