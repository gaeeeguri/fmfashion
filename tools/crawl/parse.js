import './dom.js';
import { parseListHtml, isBlockedHtml } from '../../src/lib/parser.js';

/**
 * @param {string} html fmkorea board list page
 * @param {string[]} excludeCategoryIds
 * @returns {{ rows: Array<{docId: string, title: string, categoryId: string|null, categoryName: string}>, lastPage: number|null }}
 */
export function parseList(html, excludeCategoryIds) {
  const rows = parseListHtml(html)
    .filter((r) => !(r.categoryId && excludeCategoryIds.includes(r.categoryId)))
    .map((r) => ({ docId: String(r.docId), title: r.title, categoryId: r.categoryId, categoryName: r.categoryName }));
  const m = html.match(/class="[^"]*\bbd_pg\b[^"]*"[^>]*data-last-page="(\d+)"/) ?? html.match(/data-last-page="(\d+)"[^>]*class="[^"]*\bbd_pg\b/);
  return { rows, lastPage: m ? Number(m[1]) : null };
}

/**
 * @param {string} html fmkorea post page
 * @returns {{ text: string, imgCount: number, date: string|null } | null}
 */
export function parsePost(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const body = doc.querySelector('article .xe_content');
  if (!body) return null;
  for (const br of body.querySelectorAll('br')) br.replaceWith('\n');
  for (const el of body.querySelectorAll('p, div, li')) el.append('\n');
  const text = (body.textContent ?? '')
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
  return {
    text,
    imgCount: body.querySelectorAll('img').length,
    date: doc.querySelector('.top_area span.date')?.textContent?.trim() ?? null,
  };
}

/**
 * @param {{status: number, html: string} | {error: 'network'|'timeout'}} res
 * @returns {'ok'|'rate-limited'|'blocked'|'network'|'http-error'}
 */
export function classify(res) {
  if ('error' in res) return 'network';
  if (res.status === 429) return 'rate-limited';
  if (res.status === 430 || isBlockedHtml(res.html ?? '')) return 'blocked';
  if (res.status === 200) return 'ok';
  return 'http-error';
}
