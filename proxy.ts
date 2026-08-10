import { NextRequest, NextResponse } from 'next/server';
import { isMarkdownPreferred, rewritePath } from 'fumadocs-core/negotiation';
import { docsContentRoute, docsRoute } from '@/lib/shared';

const { rewrite: rewriteDocs } = rewritePath(
  `${docsRoute}{/*path}`,
  `${docsContentRoute}{/*path}/content.md`,
);
const { rewrite: rewriteSuffix } = rewritePath(
  `${docsRoute}{/*path}.md`,
  `${docsContentRoute}{/*path}/content.md`,
);

export default function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  // With docsRoute='' (root serving) the suffix pattern matches ANY .md path —
  // including the canonical /llms.mdx/... content URLs themselves, which would
  // be double-rewritten into 404s. Exempt internal routes before rewriting.
  if (
    pathname.startsWith(docsContentRoute) ||
    pathname.startsWith('/api/') ||
    pathname.startsWith('/og/') ||
    pathname.startsWith('/_next/')
  ) {
    return NextResponse.next();
  }

  const result = rewriteSuffix(pathname);
  if (result) {
    return NextResponse.rewrite(new URL(result, request.nextUrl));
  }

  if (isMarkdownPreferred(request)) {
    const result = rewriteDocs(request.nextUrl.pathname);

    if (result) {
      return NextResponse.rewrite(new URL(result, request.nextUrl));
    }
  }

  return NextResponse.next();
}
