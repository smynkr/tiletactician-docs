import defaultMdxComponents from 'fumadocs-ui/mdx';
import { Accordion, Accordions } from 'fumadocs-ui/components/accordion';
import { Step, Steps } from 'fumadocs-ui/components/steps';
import { Tab, Tabs } from 'fumadocs-ui/components/tabs';
import type { MDXComponents } from 'mdx/types';
import { Update } from './mintlify-shims';
import { Mermaid } from './brand/mermaid';
import { ProcessFlow } from './brand/process-flow';
import { ProductPreview } from './brand/product-preview';

// defaultMdxComponents already registers Callout/Card/Cards (see
// fumadocs-ui/dist/mdx.js) — the migration codemod (tools/mintlify-to-fumadocs.mjs)
// maps Mintlify's Note/Tip/Warning -> Callout and Columns -> Cards, so those
// need no extra registration here. Everything below is what Mintlify content
// needs beyond the Fumadocs defaults.
export function getMDXComponents(extra: MDXComponents = {}): MDXComponents {
  return {
    ...defaultMdxComponents,
    ...extra,
    Accordion,
    Accordions,
    Step,
    Steps,
    Tab,
    Tabs,
    Update,
    Mermaid,
    ProcessFlow,
    ProductPreview,
  };
}
