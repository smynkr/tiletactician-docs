import { defineConfig, defineDocs } from 'fumadocs-mdx/config';
import { remarkCodeTab } from 'fumadocs-core/mdx-plugins';
import { metaSchema, pageSchema } from 'fumadocs-core/source/schema';

// You can customize Zod schemas for frontmatter and `meta.json` here
// see https://fumadocs.dev/docs/mdx/collections
export const docs = defineDocs({
  dir: 'content/docs',
  docs: {
    schema: pageSchema,
    postprocess: {
      includeProcessedMarkdown: true,
    },
  },
  meta: {
    schema: metaSchema,
  },
});

export default defineConfig({
  mdxOptions: {
    // Adjacent ```lang tab="Label" fences render as tabbed code blocks
    // (CodeBlockTabs components, registered via fumadocs-ui/mdx defaults).
    // The 'fumadocs' preset already ships remarkCodeTab; it is registered
    // explicitly so the tab="…" fence syntax content relies on survives a
    // preset change. Re-running the plugin is a no-op: converted groups are
    // marked (_code_tab_visited) and fence meta is consumed on the first pass.
    remarkPlugins: (plugins) => [...plugins, remarkCodeTab],
  },
});
