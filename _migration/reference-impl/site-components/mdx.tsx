import defaultMdxComponents from 'fumadocs-ui/mdx';
import { Accordion, Accordions } from 'fumadocs-ui/components/accordion';
import { Step, Steps } from 'fumadocs-ui/components/steps';
import { Tab, Tabs } from 'fumadocs-ui/components/tabs';
import type { MDXComponents } from 'mdx/types';
import { Update } from './mintlify-shims';

// defaultMdxComponents already registers Callout/Card/Cards (see
// fumadocs-ui/dist/mdx.js) — the migration codemod (tools/mintlify-to-fumadocs.mjs)
// maps Mintlify's Note/Tip/Warning -> Callout and Columns -> Cards, so those
// need no extra registration here. Everything below is what Mintlify content
// needs that the default set doesn't already cover.
export function getMDXComponents(components?: MDXComponents) {
  return {
    ...defaultMdxComponents,
    Accordion,
    Accordions,
    Step,
    Steps,
    Tab,
    Tabs,
    Update,
    ...components,
  } satisfies MDXComponents;
}

export const useMDXComponents = getMDXComponents;

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>;
}
