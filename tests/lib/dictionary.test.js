import { test, expect } from 'vitest';
import bundled from '../../dictionary/brands.json';
import { validateDictionary, pickNewer } from '../../src/lib/dictionary.js';

test('bundled dictionary is valid', () => expect(validateDictionary(bundled)).not.toBeNull());
test('rejects wrong schemaVersion', () => expect(validateDictionary({ ...bundled, schemaVersion: 2 })).toBeNull());
test('rejects brand without searchTerms', () => {
  const d = structuredClone(bundled);
  delete d.brands[0].searchTerms;
  expect(validateDictionary(d)).toBeNull();
});
test('rejects invalid regex in matchPatterns', () => {
  const d = structuredClone(bundled);
  d.brands[0].matchPatterns = ['('];
  expect(validateDictionary(d)).toBeNull();
});
test('rejects brand with unknown group', () => {
  const d = structuredClone(bundled);
  d.brands[0].group = 'nope';
  expect(validateDictionary(d)).toBeNull();
});
test('rejects duplicate brand id', () => {
  const d = structuredClone(bundled);
  d.brands.push({ ...d.brands[0] });
  expect(validateDictionary(d)).toBeNull();
});
test('rejects non-object', () => expect(validateDictionary('x')).toBeNull());
test('pickNewer prefers later updatedAt', () => {
  const n = { ...bundled, updatedAt: '2099-01-01T00:00:00+09:00' };
  expect(pickNewer(bundled, n)).toBe(n);
});
test('pickNewer keeps current when incoming null or older', () => {
  expect(pickNewer(bundled, null)).toBe(bundled);
  expect(pickNewer(bundled, { ...bundled, updatedAt: '2000-01-01T00:00:00+09:00' })).toBe(bundled);
});
