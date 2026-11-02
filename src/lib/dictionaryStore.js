import { validateDictionary, pickNewer } from './dictionary.js';

export const REMOTE_DICTIONARY_URL = 'https://raw.githubusercontent.com/gaeeeguri/fmfashion/main/dictionary/brands.json';
export const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** Loads the copy bundled with the extension. */
export async function loadBundledDictionary() {
  const res = await fetch(chrome.runtime.getURL('dictionary/brands.json'));
  return res.json();
}

/**
 * @param {{ get: Function }} storage  chrome.storage.local
 * @param {() => Promise<any>} [loadBundled]
 * @returns {Promise<import('./dictionary.js').Dictionary>}
 */
export async function getDictionary(storage, loadBundled = loadBundledDictionary) {
  const bundled = validateDictionary(await loadBundled());
  const { dictionary } = await storage.get('dictionary');
  if (!bundled) return validateDictionary(dictionary) ?? Promise.reject(new Error('no valid dictionary'));
  return pickNewer(bundled, validateDictionary(dictionary));
}

/**
 * @param {{ get: Function, set: Function }} storage  chrome.storage.local
 * @param {(url: string) => Promise<{ ok: boolean, text: () => Promise<string> }>} fetchFn
 * @param {number} now
 * @param {() => Promise<any>} [loadBundled]
 * @returns {Promise<'updated' | 'unchanged' | 'failed'>}
 */
export async function refreshDictionary(storage, fetchFn, now, loadBundled = loadBundledDictionary) {
  await storage.set({ dictionaryCheckedAt: now });
  let incoming;
  try {
    const res = await fetchFn(REMOTE_DICTIONARY_URL);
    if (!res.ok) return 'failed';
    incoming = validateDictionary(JSON.parse(await res.text()));
  } catch {
    return 'failed';
  }
  if (!incoming) return 'failed';
  const current = await getDictionary(storage, loadBundled);
  if (pickNewer(current, incoming) !== incoming) return 'unchanged';
  await storage.set({ dictionary: incoming });
  return 'updated';
}

/** @param {{ get: Function }} storage @param {number} now */
export async function isRefreshDue(storage, now) {
  const { dictionaryCheckedAt } = await storage.get('dictionaryCheckedAt');
  return !dictionaryCheckedAt || now - dictionaryCheckedAt > REFRESH_INTERVAL_MS;
}
