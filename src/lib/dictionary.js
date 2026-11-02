/**
 * @typedef {{ key: string, name: string, ids: string[], excludeIds?: string[] }} Category
 * @typedef {{ id: string, name: string }} Group
 * @typedef {{ id: string, name: string, nameEn?: string, group: string,
 *   searchTerms: string[], matchPatterns: string[], exclude?: string[], note?: string }} Brand
 * @typedef {{ schemaVersion: 1, version: string, updatedAt: string,
 *   categories: Category[], groups: Group[], brands: Brand[] }} Dictionary
 */

export const SCHEMA_VERSION = 1;
export const DEFAULT_CATEGORY_KEY = 'all';

const isStr = (v) => typeof v === 'string' && v.length > 0;
const isStrArr = (v, allowEmpty = true) =>
  Array.isArray(v) && (allowEmpty || v.length > 0) && v.every(isStr);

function isValidRegex(src) {
  try {
    new RegExp(src, 'iu');
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {unknown} raw
 * @returns {Dictionary | null}
 */
export function validateDictionary(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const d = /** @type {any} */ (raw);
  if (d.schemaVersion !== SCHEMA_VERSION) return null;
  if (!isStr(d.version) || !isStr(d.updatedAt) || Number.isNaN(Date.parse(d.updatedAt))) return null;

  if (!Array.isArray(d.categories) || d.categories.length === 0) return null;
  const catKeys = new Set();
  for (const c of d.categories) {
    if (!c || !isStr(c.key) || !isStr(c.name) || !isStrArr(c.ids)) return null;
    if (c.excludeIds !== undefined && !isStrArr(c.excludeIds)) return null;
    if (catKeys.has(c.key)) return null;
    catKeys.add(c.key);
  }
  // settings fall back to 'all', so it must exist
  if (!catKeys.has(DEFAULT_CATEGORY_KEY)) return null;

  if (!Array.isArray(d.groups)) return null;
  const groupIds = new Set();
  for (const g of d.groups) {
    if (!g || !isStr(g.id) || !isStr(g.name)) return null;
    groupIds.add(g.id);
  }

  if (!Array.isArray(d.brands)) return null;
  const brandIds = new Set();
  for (const b of d.brands) {
    if (!b || !isStr(b.id) || !isStr(b.name) || !groupIds.has(b.group)) return null;
    if (brandIds.has(b.id)) return null;
    brandIds.add(b.id);
    if (!isStrArr(b.searchTerms, false) || !isStrArr(b.matchPatterns, false)) return null;
    if (!b.matchPatterns.every(isValidRegex)) return null;
    if (b.exclude !== undefined && !isStrArr(b.exclude)) return null;
  }
  return d;
}

/**
 * @param {Dictionary} current
 * @param {Dictionary | null} incoming
 * @returns {Dictionary}
 */
export function pickNewer(current, incoming) {
  if (!incoming || !validateDictionary(incoming)) return current;
  return Date.parse(incoming.updatedAt) > Date.parse(current.updatedAt) ? incoming : current;
}
