/**
 * @typedef {{ docId: number, title: string, url: string, categoryId: string | null, categoryName: string,
 *   author: string, time: string, views: number | null, votes: number | null, comments: number }} Row
 */

// All fmkorea DOM assumptions live here.
export const SELECTORS = {
  row: 'tr',
  notice: 'notice',
  title: 'td.title',
  titleLink: 'td.title > a:not(.replyNum)',
  replyNum: 'a.replyNum',
  category: 'td.cate a',
  author: 'td.author',
  time: 'td.time',
  counts: 'td.m_no',
};
export const BLOCKED_MARKER = '에펨코리아 보안 시스템';
const ORIGIN = 'https://www.fmkorea.com';

const text = (el) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const num = (s) => {
  const n = parseInt(String(s).replace(/[^\d]/g, ''), 10);
  return Number.isNaN(n) ? null : n;
};

function docIdFromHref(href) {
  if (!href) return null;
  const m = href.match(/document_srl=(\d+)/) ?? href.match(/^(?:https?:\/\/[^/]+)?\/(\d+)(?:[?#]|$)/);
  return m ? Number(m[1]) : null;
}

/**
 * @param {Document | Element} root
 * @returns {Array<{ row: Row, tr: HTMLTableRowElement }>}
 */
export function parseListDocument(root) {
  const out = [];
  for (const tr of root.querySelectorAll(SELECTORS.row)) {
    if (tr.classList.contains(SELECTORS.notice)) continue;
    if (!tr.querySelector(SELECTORS.title)) continue;
    const link = tr.querySelector(SELECTORS.titleLink);
    const docId = docIdFromHref(link?.getAttribute('href'));
    if (!docId) continue;
    const catLink = tr.querySelector(SELECTORS.category);
    const catMatch = catLink?.getAttribute('href')?.match(/category=(\d+)/);
    const counts = tr.querySelectorAll(SELECTORS.counts);
    out.push({
      tr,
      row: {
        docId,
        title: text(link),
        url: `${ORIGIN}/${docId}`,
        categoryId: catMatch ? catMatch[1] : null,
        categoryName: text(catLink),
        author: text(tr.querySelector(SELECTORS.author)),
        time: text(tr.querySelector(SELECTORS.time)),
        views: counts[0] ? num(text(counts[0])) : null,
        votes: counts[1] ? num(text(counts[1])) : null,
        comments: num(text(tr.querySelector(SELECTORS.replyNum))) ?? 0,
      },
    });
  }
  return out;
}

/**
 * @param {string} html
 * @returns {Row[]}
 */
export function parseListHtml(html) {
  if (isBlockedHtml(html)) return [];
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return parseListDocument(doc).map((x) => x.row);
}

/**
 * fmkorea wraps every board list/search page in `div.bd_lst_wrp`, even with zero results
 * (the `table.bd_lst` itself is omitted then). Its absence on a non-blocked page means the
 * markup changed or we got some other page.
 * @param {string} html
 */
export function hasListTable(html) {
  return /class="[^"]*\bbd_lst_wrp\b/.test(html);
}

/** @param {string} html */
export function isBlockedHtml(html) {
  return html.includes(BLOCKED_MARKER);
}
