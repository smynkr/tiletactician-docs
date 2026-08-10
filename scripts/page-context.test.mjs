import assert from 'node:assert/strict';
import test from 'node:test';
import { getRelatedGuides } from '../lib/page-context.ts';

const tree = {
  name: 'Axiom Docs',
  children: [
    {
      type: 'folder',
      root: true,
      name: 'Overwatch',
      index: { type: 'page', url: '/overwatch', name: 'Overwatch', description: 'Maritime intelligence.' },
      children: [
        { type: 'page', url: '/overwatch', name: 'Overwatch', description: 'Maritime intelligence.' },
        { type: 'page', url: '/overwatch/getting-started', name: 'Get started', description: 'Start here.' },
        { type: 'page', url: '/overwatch/faq', name: 'FAQ', description: 'Frequently asked questions.' },
        {
          type: 'folder',
          name: 'API reference',
          children: [
            { type: 'page', url: '/overwatch/api/overview', name: 'Overview', description: 'API overview.' },
            { type: 'page', url: '/overwatch/api/ports', name: 'Ports', description: 'Port endpoints.' },
            { type: 'page', url: '/overwatch/api/vessels', name: 'Vessels', description: 'Vessel endpoints.' },
          ],
        },
        {
          type: 'folder',
          name: 'Reference',
          children: [{ type: 'page', url: '/overwatch/reference', name: 'Reference', description: 'Single guide.' }],
        },
        {
          type: 'folder',
          name: 'Advanced',
          index: { type: 'page', url: '/overwatch/advanced', name: 'Advanced', description: 'Advanced guide.' },
          children: [{ type: 'page', url: '/overwatch/advanced/metrics', name: 'Metrics', description: 'Metric endpoints.' }],
        },
      ],
    },
    {
      type: 'folder',
      root: true,
      name: 'Locus',
      index: { type: 'page', url: '/locus', name: 'Locus', description: 'Territory intelligence.' },
      children: [{ type: 'page', url: '/locus', name: 'Locus', description: 'Territory intelligence.' }],
    },
    {
      type: 'folder',
      name: 'Changelog',
      children: [
        { type: 'page', url: '/changelog', name: 'Changelog', description: 'Release notes.' },
        { type: 'page', url: '/changelog/2026-08-01-weekly', name: 'Weekly', description: 'Weekly notes.' },
      ],
    },
    { type: 'page', url: '/getting-started', name: 'Getting started', description: 'The hub.' },
  ],
};

test('selects product root and same-section neighbors in navigation order', () => {
  assert.deepEqual(getRelatedGuides(tree, { url: '/overwatch/api/overview', slugs: ['overwatch', 'api', 'overview'] }), {
    root: { url: '/overwatch', title: 'Overwatch', description: 'Maritime intelligence.' },
    next: { url: '/overwatch/api/ports', title: 'Ports', description: 'Port endpoints.' },
  });

  assert.deepEqual(getRelatedGuides(tree, { url: '/overwatch/api/vessels', slugs: ['overwatch', 'api', 'vessels'] }), {
    root: { url: '/overwatch', title: 'Overwatch', description: 'Maritime intelligence.' },
    previous: { url: '/overwatch/api/ports', title: 'Ports', description: 'Port endpoints.' },
  });

  // A folder index page (parent.index) is not isolated from its section.
  assert.deepEqual(getRelatedGuides(tree, { url: '/overwatch/advanced', slugs: ['overwatch', 'advanced'] }), {
    root: { url: '/overwatch', title: 'Overwatch', description: 'Maritime intelligence.' },
    next: { url: '/overwatch/advanced/metrics', title: 'Metrics', description: 'Metric endpoints.' },
  });

  // A middle peer yields both neighbours (exercises the three-card layout).
  assert.deepEqual(getRelatedGuides(tree, { url: '/overwatch/api/ports', slugs: ['overwatch', 'api', 'ports'] }), {
    root: { url: '/overwatch', title: 'Overwatch', description: 'Maritime intelligence.' },
    previous: { url: '/overwatch/api/overview', title: 'Overview', description: 'API overview.' },
    next: { url: '/overwatch/api/vessels', title: 'Vessels', description: 'Vessel endpoints.' },
  });
});

test('omits automatic wayfinding on curated entry points and changelog pages', () => {
  assert.equal(getRelatedGuides(tree, { url: '/overwatch', slugs: ['overwatch'] }), null);
  assert.equal(getRelatedGuides(tree, { url: '/overwatch/getting-started', slugs: ['overwatch', 'getting-started'] }), null);
  assert.equal(getRelatedGuides(tree, { url: '/getting-started', slugs: ['getting-started'] }), null);
  assert.equal(getRelatedGuides(tree, { url: '/changelog', slugs: ['changelog'] }), null);
  assert.equal(getRelatedGuides(tree, { url: '/changelog/2026-08-01-weekly', slugs: ['changelog', '2026-08-01-weekly'] }), null);
});

test('returns a root-only block for a section with no page peers', () => {
  assert.deepEqual(getRelatedGuides(tree, { url: '/overwatch/reference', slugs: ['overwatch', 'reference'] }), {
    root: { url: '/overwatch', title: 'Overwatch', description: 'Maritime intelligence.' },
  });
});

test('never emits a curated entry point as a previous/next peer', () => {
  // getting-started sits beside /overwatch/faq in the root folder; it must
  // not surface as "Previous guide: Get started".
  assert.deepEqual(getRelatedGuides(tree, { url: '/overwatch/faq', slugs: ['overwatch', 'faq'] }), {
    root: { url: '/overwatch', title: 'Overwatch', description: 'Maritime intelligence.' },
  });
});

test('returns null for a route that does not exist in the source tree', () => {
  assert.equal(getRelatedGuides(tree, { url: '/locus/unknown', slugs: ['locus', 'unknown'] }), null);
});
