import assert from 'node:assert/strict';
import test from 'node:test';
import { PRODUCTS } from '../_migration/tools/lib/shared.mjs';
import config from '../next.config.mjs';

test('redirects every legacy product index route to its Fumadocs root', async () => {
  const redirects = await config.redirects();

  for (const product of PRODUCTS) {
    assert.deepEqual(
      redirects.find((redirect) => redirect.source === `/${product}/index`),
      {
        source: `/${product}/index`,
        destination: `/${product}`,
        permanent: true,
      },
    );
  }
});
