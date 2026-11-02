import { test, expect } from 'vitest';
import bundled from '../../dictionary/brands.json';
import { normalizeSettings, loadSettings, saveSettings } from '../../src/lib/settings.js';
import { memStorage } from './memStorage.js';

test('hiding a brand removes it from selection', () => {
  const s = normalizeSettings({ hiddenBrandIds: ['paf'], selectedBrandIds: ['paf', 'anotheroffice'], categoryKey: 'fit' }, bundled);
  expect(s).toEqual({ hiddenBrandIds: ['paf'], selectedBrandIds: ['anotheroffice'], categoryKey: 'fit' });
});
test('unknown ids and category dropped', () => {
  const s = normalizeSettings({ hiddenBrandIds: ['nope'], selectedBrandIds: ['gone', 'paf'], categoryKey: 'zzz' }, bundled);
  expect(s).toEqual({ hiddenBrandIds: [], selectedBrandIds: ['paf'], categoryKey: 'all' });
});
test('defaults when storage empty', async () => {
  expect(normalizeSettings(undefined, bundled)).toEqual({ hiddenBrandIds: [], selectedBrandIds: [], categoryKey: 'all' });
  expect(await loadSettings(memStorage(), bundled)).toEqual({ hiddenBrandIds: [], selectedBrandIds: [], categoryKey: 'all' });
});
test('save then load roundtrip', async () => {
  const st = memStorage();
  await saveSettings(st, { hiddenBrandIds: ['fafter'], selectedBrandIds: ['paf'], categoryKey: 'review' });
  expect(await loadSettings(st, bundled)).toEqual({ hiddenBrandIds: ['fafter'], selectedBrandIds: ['paf'], categoryKey: 'review' });
});
