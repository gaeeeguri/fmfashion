// The merged list of the last run, kept on fmkorea's origin so opening a post from the results (or
// coming back) shows the same list without sending the searches again (spec §11.3).
const STORE_KEY = 'fmf-results';
export const SNAPSHOT_TTL_MS = 30 * 60 * 1000;

/**
 * Same selection, same hidden brands, same dictionary → the snapshot still describes this list.
 * @param {{ hash: string, hiddenBrandIds: string[], dictVersion: number | string }} p
 */
export function snapshotKey({ hash, hiddenBrandIds, dictVersion }) {
  return JSON.stringify([hash, [...hiddenBrandIds].sort(), dictVersion]);
}

/** @param {Pick<Storage, 'setItem'>} storage */
export function saveSnapshot(storage, key, data, now = Date.now()) {
  try {
    storage.setItem(STORE_KEY, JSON.stringify({ key, savedAt: now, data }));
  } catch {
    // quota or blocked storage: the next page view just searches again
  }
}

/** @param {Pick<Storage, 'getItem'>} storage */
export function loadSnapshot(storage, key, now = Date.now()) {
  try {
    const v = JSON.parse(storage.getItem(STORE_KEY) ?? 'null');
    if (!v || v.key !== key || !(now - v.savedAt <= SNAPSHOT_TTL_MS)) return null;
    return v.data ?? null;
  } catch {
    return null;
  }
}
