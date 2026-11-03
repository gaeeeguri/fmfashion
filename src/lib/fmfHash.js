const PREFIX = '#fmf=';
const FASHION = 'https://www.fmkorea.com/fashion';

/** @typedef {{ brandIds: string[], categoryKey: string }} FmfSelection */

/** @param {FmfSelection} sel */
export function encodeFmfHash({ brandIds, categoryKey }) {
  return `${PREFIX}b:${brandIds.map(encodeURIComponent).join(',')};c:${encodeURIComponent(categoryKey)}`;
}

/**
 * @param {string} hash e.g. `location.hash`
 * @returns {FmfSelection | null}
 */
export function parseFmfHash(hash) {
  if (!hash) return null;
  let raw = hash;
  if (!raw.startsWith(PREFIX)) {
    try {
      raw = decodeURIComponent(hash);
    } catch {
      return null;
    }
    if (!raw.startsWith(PREFIX)) return null;
    // whole-string-encoded input: the parts are plain from here on
    return fromParts(raw.slice(PREFIX.length), (x) => x);
  }
  const body = raw.slice(PREFIX.length);
  if (!body.includes(':') && body.includes('%')) return fromParts(safeDecode(body), (x) => x);
  return fromParts(body, safeDecode);
}

function fromParts(body, dec) {
  const out = { brandIds: [], categoryKey: 'all' };
  for (const part of body.split(';')) {
    const i = part.indexOf(':');
    if (i < 0) continue;
    const k = part.slice(0, i);
    const v = part.slice(i + 1);
    if (k === 'b') out.brandIds = v.split(',').filter(Boolean).map(dec);
    else if (k === 'c' && v) out.categoryKey = dec(v);
  }
  return out;
}

function safeDecode(x) {
  try {
    return decodeURIComponent(x);
  } catch {
    return x;
  }
}

/**
 * Where the popup's 보기 goes: reuse the current tab when it is already on fmkorea.
 * @param {string | undefined} tabUrl
 * @param {string} hash
 * @returns {{ action: 'update' | 'create', url: string }}
 */
export function goTarget(tabUrl, hash) {
  const onFm = typeof tabUrl === 'string' && tabUrl.startsWith('https://www.fmkorea.com/');
  return { action: onFm ? 'update' : 'create', url: FASHION + hash };
}
