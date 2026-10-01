import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildChannel } from './build-channel.ts';

test('an undesignated build is dev, and stable and preview require an explicit channel', () => {
  assert.equal(buildChannel(undefined), 'dev');
  assert.equal(buildChannel('dev'), 'dev');
  assert.equal(buildChannel('stable'), 'stable');
  assert.equal(buildChannel('preview'), 'preview');
  for (const value of ['debug', 'development', 'production', '', 'Preview', null]) {
    assert.throws(() => buildChannel(value));
  }
});
