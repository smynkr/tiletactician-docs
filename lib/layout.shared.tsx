import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import { NavTitle } from '@/components/nav-title';
import { gitConfig } from './shared';

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: <NavTitle />,
      url: 'https://tiletactician.com',
    },
    githubUrl: `https://github.com/${gitConfig.user}/${gitConfig.repo}`,
  };
}
