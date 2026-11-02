import { test, expect } from 'vitest';
import bundled from '../../dictionary/brands.json';
import { getDictionary, refreshDictionary } from '../../src/lib/dictionaryStore.js';
import { memStorage } from './memStorage.js';

const newer = { ...bundled, version: '2099.01.01', updatedAt: '2099-01-01T00:00:00+09:00' };
const textFetch = (body, status = 200) => async () => ({ ok: status < 400, status, text: async () => body });
const loadBundled = async () => structuredClone(bundled);
const NOW = 1_800_000_000_000;

test('refresh stores newer valid dictionary', async () => {
  const st = memStorage();
  expect(await refreshDictionary(st, textFetch(JSON.stringify(newer)), NOW, loadBundled)).toBe('updated');
  expect(st.data.dictionary.version).toBe('2099.01.01');
  expect(st.data.dictionaryCheckedAt).toBe(NOW);
});
test('refresh ignores malformed json', async () => {
  const st = memStorage();
  expect(await refreshDictionary(st, textFetch('{'), NOW, loadBundled)).toBe('failed');
  expect(st.data.dictionary).toBeUndefined();
});
test('refresh ignores wrong schemaVersion', async () => {
  const st = memStorage();
  expect(await refreshDictionary(st, textFetch(JSON.stringify({ ...newer, schemaVersion: 2 })), NOW, loadBundled)).toBe('failed');
  expect(st.data.dictionary).toBeUndefined();
});
test('refresh fails on http error', async () => {
  const st = memStorage();
  expect(await refreshDictionary(st, textFetch('', 404), NOW, loadBundled)).toBe('failed');
});
test('refresh unchanged when not newer', async () => {
  const st = memStorage();
  expect(await refreshDictionary(st, textFetch(JSON.stringify(bundled)), NOW, loadBundled)).toBe('unchanged');
  expect(st.data.dictionary).toBeUndefined();
});
test('getDictionary prefers newer stored', async () => {
  const st = memStorage({ dictionary: newer });
  expect((await getDictionary(st, loadBundled)).version).toBe('2099.01.01');
});
test('getDictionary falls back to bundled when stored is invalid', async () => {
  const st = memStorage({ dictionary: { schemaVersion: 1, junk: true } });
  expect((await getDictionary(st, loadBundled)).version).toBe(bundled.version);
});
