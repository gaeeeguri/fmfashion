import { parseListDocument, isBlockedHtml, SELECTORS } from './parser.js';
import { matchBrands } from './matcher.js';

const BAR_ID = 'fmf-bar';
const LIST_TABLE = 'table.bd_lst';

/** True only for fashion-board list/search pages (not post views, not other boards). */
export function isFashionListUrl(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.searchParams.has('document_srl')) return false;
  if (u.pathname === '/fashion' || u.pathname === '/fashion/') return true;
  if (u.pathname === '/index.php' || u.pathname === '/search.php') return u.searchParams.get('mid') === 'fashion';
  return false;
}

/**
 * Hide rows whose title matches a hidden brand. Safe to call repeatedly.
 * @param {Document} doc
 * @param {string[]} hiddenBrandIds
 * @param {import('./matcher.js').Matchers} matchers
 * @returns {{ hiddenCount: number }}
 */
export function applyHiding(doc, hiddenBrandIds, matchers) {
  for (const tr of doc.querySelectorAll('tr[data-fmf-hidden]')) {
    tr.style.display = '';
    delete tr.dataset.fmfHidden;
  }
  doc.getElementById(BAR_ID)?.remove();

  const hits = parseListDocument(doc).filter(({ row }) => matchBrands(row.title, hiddenBrandIds, matchers).length);
  for (const { tr } of hits) {
    tr.dataset.fmfHidden = '1';
    tr.style.display = 'none';
  }
  if (hits.length) insertBar(doc, hits.length);
  return { hiddenCount: hits.length };
}

function insertBar(doc, count) {
  const table = doc.querySelector(LIST_TABLE) ?? doc.querySelector('tr[data-fmf-hidden]')?.closest('table');
  if (!table) return;
  const bar = doc.createElement('div');
  bar.id = BAR_ID;
  bar.style.cssText = 'font-size:12px;color:#80838f;padding:6px 4px;display:flex;gap:8px;align-items:center';
  const label = doc.createElement('span');
  label.textContent = `숨긴 글 ${count}개 · 펨코 패션 필터`;
  const btn = doc.createElement('button');
  btn.type = 'button';
  btn.textContent = '보기';
  btn.style.cssText = 'border:0;background:none;color:#3b5bfd;cursor:pointer;padding:0;font:inherit';
  let shown = false;
  btn.onclick = () => {
    shown = !shown;
    for (const tr of doc.querySelectorAll('tr[data-fmf-hidden]')) tr.style.display = shown ? '' : 'none';
    btn.textContent = shown ? '다시 숨기기' : '보기';
  };
  bar.append(label, btn);
  table.before(bar);
}

/**
 * Result mode may only take over a real board list page — never fmkorea's security check,
 * an error page or maintenance page served at the same URL.
 * @param {Document} doc
 */
export function isListPage(doc) {
  return !!doc.querySelector('div.bd_lst_wrp') && !isBlockedHtml(doc.documentElement?.outerHTML ?? '');
}

/**
 * The popup saves selection clicks under the same `settings` key as hidden brands. Only a change
 * to the hidden brands (or a new dictionary) should re-search or re-hide.
 * @param {Record<string, { oldValue?: any, newValue?: any }>} changes
 * @param {string} area
 */
export function needsResync(changes, area) {
  if (area === 'local') return !!changes.dictionary;
  if (area !== 'sync' || !changes.settings) return false;
  const key = (v) => [...(v?.hiddenBrandIds ?? [])].sort().join(',');
  const { oldValue, newValue } = changes.settings;
  return !oldValue || key(oldValue) !== key(newValue);
}

/**
 * Which fashion-board page this is (spec §11.3). Post URLs (`/<id>`, `document_srl=`) don't name the
 * board, so post pages are recognised by the board header link.
 * @param {string} url
 * @param {Document} doc
 * @returns {{ kind: 'list', listRoot: Element } | { kind: 'document', listRoot: Element | null } | null}
 */
export function classifyPage(url, doc) {
  if (isBlockedHtml(doc.documentElement?.outerHTML ?? '')) return null;
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const wrap = doc.querySelector(SELECTORS.listWrap);
  if (isFashionListUrl(url)) return wrap ? { kind: 'list', listRoot: wrap } : null;
  const isPost = /^\/\d+\/?$/.test(u.pathname) || u.searchParams.has('document_srl');
  if (isPost && doc.querySelector(SELECTORS.fashionBoardMarker)) return { kind: 'document', listRoot: wrap };
  return null;
}
