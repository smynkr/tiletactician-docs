import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import { NavTitle } from '@/components/nav-title';
import { gitConfig } from './shared';

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: <NavTitle />,
      children: (
          <a
            href="https://tiletactician.com"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-lg border border-fd-border px-2.5 py-1 text-xs font-medium text-fd-muted-foreground transition-colors hover:border-fd-primary/50 hover:text-fd-primary"
          >
            tiletactician.com <span aria-hidden="true">↗</span>
          </a>
      ),
    },
    githubUrl: `https://github.com/${gitConfig.user}/${gitConfig.repo}`,
  };
}
