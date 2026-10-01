import assert from 'node:assert/strict';
import { test } from 'node:test';
import { developmentServerUrl } from './dev-server.ts';

test('only development builds can use a pinned worktree API URL', () => {
  assert.equal(developmentServerUrl('dev', 'http://llm:26080/'), 'http://llm:26080');
  assert.equal(developmentServerUrl('dev', undefined), '');
  assert.equal(developmentServerUrl('stable', 'http://llm:26080'), '');
  assert.equal(developmentServerUrl('preview', 'http://llm:26080'), '');
});

test('development server URLs must use HTTP or HTTPS', () => {
  assert.equal(developmentServerUrl('dev', 'https://catch.example/'), 'https://catch.example');
  assert.throws(() => developmentServerUrl('dev', 'file:///tmp/catch'));
  assert.throws(() => developmentServerUrl('dev', 'invalid'));
});
