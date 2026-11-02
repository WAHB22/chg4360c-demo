import test from 'node:test';
import assert from 'node:assert/strict';
import { checkKey } from '../api/_auth.js';

const req = key => ({ headers: key == null ? {} : { 'x-app-key': key } });
function withEnv(env, fn) {
  const old = { APP_KEY: process.env.APP_KEY, APP_KEY_A: process.env.APP_KEY_A };
  for (const [k, v] of Object.entries(env)) v == null ? delete process.env[k] : (process.env[k] = v);
  try { fn(); } finally { for (const [k, v] of Object.entries(old)) v == null ? delete process.env[k] : (process.env[k] = v); }
}

test('APP_KEY alone works as before and fails closed', () => {
  withEnv({ APP_KEY: 'main-key', APP_KEY_A: null }, () => {
    assert.equal(checkKey(req('main-key')), true);
    assert.equal(checkKey(req('other')), false);
    assert.equal(checkKey(req(null)), false);
    assert.equal(checkKey(req('')), false);
  });
  withEnv({ APP_KEY: null, APP_KEY_A: null }, () => assert.equal(checkKey(req('anything')), false));
});

test('APP_KEY_A is accepted as a second key, and either key alone is enough', () => {
  withEnv({ APP_KEY: 'b-key', APP_KEY_A: 'a-key' }, () => {
    assert.equal(checkKey(req('b-key')), true);
    assert.equal(checkKey(req('a-key')), true);
    assert.equal(checkKey(req('c-key')), false);
  });
  withEnv({ APP_KEY: null, APP_KEY_A: 'a-key' }, () => {
    assert.equal(checkKey(req('a-key')), true);
    assert.equal(checkKey(req('')), false);
  });
});
