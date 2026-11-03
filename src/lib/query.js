/** @typedef {import('./dictionary.js').Dictionary} Dictionary */
/** @typedef {{ kind: 'search' | 'list', term: string, brandId: string | null, keyword: string, categoryId?: string | null }} SearchJob */

export const SEARCH_BASE = 'https://www.fmkorea.com/search.php';
export const LIST_BASE = 'https://www.fmkorea.com/index.php';

/**
 * One search job per alias. Round-robin across brands so each brand's leading alias goes first.
 * @param {{ dict: Dictionary, selectedBrandIds: string[], hiddenBrandIds: string[],
 *   maxRequests?: number, maxKeywordLength?: number }} opts
 * @returns {{ jobs: SearchJob[], totalTerms: number }}
 */
export function buildSearchJobs({ dict, selectedBrandIds, hiddenBrandIds, maxRequests = 30, maxKeywordLength = 100 }) {
  const byId = new Map(dict.brands.map((b) => [b.id, b]));
  const hidden = new Set(hiddenBrandIds);
  const selected = selectedBrandIds.filter((id) => byId.has(id) && !hidden.has(id));
  const hiddenTerms = hiddenBrandIds.flatMap((id) => byId.get(id)?.searchTerms ?? []);

  // per-brand term queues, case-insensitively unique across all brands
  const seen = new Set();
  const queues = selected.map((id) =>
    byId.get(id).searchTerms.filter((t) => {
      const k = t.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    }).map((term) => ({ term, brandId: id })),
  );
  const totalTerms = queues.reduce((n, q) => n + q.length, 0);

  const ordered = [];
  for (let i = 0; ordered.length < totalTerms; i++)
    for (const q of queues) if (i < q.length) ordered.push(q[i]);

  const jobs = ordered.slice(0, maxRequests).map(({ term, brandId }) => ({
    kind: 'search',
    term,
    brandId,
    keyword: buildKeyword(term, byId.get(brandId).exclude ?? [], hiddenTerms, maxKeywordLength),
  }));
  return { jobs, totalTerms };
}

function buildKeyword(term, brandExclude, hiddenTerms, maxLen) {
  const lower = term.toLowerCase();
  const usable = (x) => !lower.includes(x.toLowerCase());
  const fixed = unique(brandExclude.filter(usable));
  const fixedKeys = new Set(fixed.map((x) => x.toLowerCase()));
  const optional = unique(hiddenTerms.filter(usable)).filter((x) => !fixedKeys.has(x.toLowerCase()));

  const join = (xs) => [term, ...xs.map((x) => '!' + x)].join(' ');
  let extra = optional;
  while (extra.length && join([...fixed, ...extra]).length > maxLen) extra = extra.slice(0, -1);
  return join([...fixed, ...extra]);
}

function unique(xs) {
  const seen = new Set();
  return xs.filter((x) => {
    const k = x.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * @param {string} keyword
 * @param {number} page
 * @param {string} [categoryId]
 */
export function buildSearchUrl(keyword, page, categoryId) {
  const p = new URLSearchParams({ mid: 'fashion', search_target: 'title_content', search_keyword: keyword, page: String(page) });
  if (categoryId) p.set('category', categoryId);
  return `${SEARCH_BASE}?${p}`;
}

/**
 * Browse mode (spec §11.1): one job per fmkorea tab in the category, or one for the whole board.
 * @param {{ dict: Dictionary, categoryKey: string }} opts
 * @returns {SearchJob[]}
 */
export function buildListJobs({ dict, categoryKey }) {
  const cat = dict.categories.find((c) => c.key === categoryKey) ?? dict.categories.find((c) => c.key === 'all');
  const ids = cat.ids.length ? cat.ids : [null];
  return ids.map((categoryId) => ({ kind: 'list', categoryId, term: '', brandId: null, keyword: '' }));
}

/** @param {string | null} categoryId @param {number} page */
export function buildListUrl(categoryId, page) {
  const p = new URLSearchParams({ mid: 'fashion' });
  if (categoryId) p.set('category', categoryId);
  p.set('page', String(page));
  return `${LIST_BASE}?${p}`;
}

/** @param {SearchJob} job @param {number} page */
export function jobUrl(job, page) {
  return job.kind === 'list' ? buildListUrl(job.categoryId ?? null, page) : buildSearchUrl(job.keyword, page);
}
