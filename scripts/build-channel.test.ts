import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildChannel } from './build-channel.ts';

test('development defaults to stable, and preview requires an explicit channel', () => {
  assert.equal(buildChannel(undefined), 'stable');
  assert.equal(buildChannel('stable'), 'stable');
  assert.equal(buildChannel('preview'), 'preview');
  for (const value of ['debug', 'development', 'production', '', 'Preview', null]) {
    assert.throws(() => buildChannel(value));
  }
});
