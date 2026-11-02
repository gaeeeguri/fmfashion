/** @typedef {{ hiddenBrandIds: string[], selectedBrandIds: string[], categoryKey: string }} Settings */

const KEY = 'settings';

/**
 * @param {any} raw
 * @param {import('./dictionary.js').Dictionary} dict
 * @returns {Settings}
 */
export function normalizeSettings(raw, dict) {
  const brandIds = new Set(dict.brands.map((b) => b.id));
  const ids = (v) => (Array.isArray(v) ? [...new Set(v.filter((x) => brandIds.has(x)))] : []);
  const hiddenBrandIds = ids(raw?.hiddenBrandIds);
  const hidden = new Set(hiddenBrandIds);
  const selectedBrandIds = ids(raw?.selectedBrandIds).filter((x) => !hidden.has(x));
  const categoryKey = dict.categories.some((c) => c.key === raw?.categoryKey) ? raw.categoryKey : 'all';
  return { hiddenBrandIds, selectedBrandIds, categoryKey };
}

/** @param {{ get: Function }} storage  chrome.storage.sync (or a stand-in) */
export async function loadSettings(storage, dict) {
  const got = await storage.get(KEY);
  return normalizeSettings(got[KEY], dict);
}

/** @param {{ set: Function }} storage @param {Settings} settings */
export async function saveSettings(storage, settings) {
  await storage.set({ [KEY]: settings });
}
