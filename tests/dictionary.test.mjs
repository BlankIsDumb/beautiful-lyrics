import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyDictionary } from '../scripts/verify-dictionary.mjs';

test('dictionary artifact guard rejects missing, malformed and silently changed payloads', () => {
  const expected = {'base.dat.gz':'YWJj'};
  assert.doesNotThrow(() => verifyDictionary('const data={"base.dat.gz":"YWJj"};', expected));
  for (const code of ['const data={};', '{"base.dat.gz":"YW_j"}', '{"base.dat.gz":"YWJk"}']) {
    assert.throws(() => verifyDictionary(code, expected), /integrity failed/);
  }
});
