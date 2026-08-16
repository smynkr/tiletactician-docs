import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import { baseOptions } from '@/lib/layout.shared';
import { ScrollProgress } from '@/components/scroll-progress';
import { source } from '@/lib/source';

export default function Layout({ children }: LayoutProps<'/[...slug]'>) {
  return <DocsLayout tree={source.getPageTree()} {...baseOptions()}>
      <ScrollProgress />
      {children}
    </DocsLayout>;
}
