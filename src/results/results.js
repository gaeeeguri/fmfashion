import { getDictionary } from '../lib/dictionaryStore.js';
import { loadSettings, normalizeSettings } from '../lib/settings.js';
import { compileMatchers } from '../lib/matcher.js';
import { buildSearchJobs } from '../lib/query.js';
import { runSearch } from '../lib/runner.js';
import { fetchPage } from '../lib/fetchPage.js';
import { filterRows, mergeRows } from '../lib/merge.js';

const CACHE_TTL_MS = 10 * 60 * 1000;
const MSG = {
  blocked: '펨코 보안 시스템 때문에 검색을 멈췄어요. 잠시 후 다시 시도해 주세요.',
  error: '검색 중 오류가 났어요. 다시 시도해 주세요.',
  cancelled: '검색을 취소했어요.',
};
const $ = (id) => document.getElementById(id);

let dict, matchers, settings, category, jobs, totalTerms;
let rows = [];
let page = 0;
let controller = null;

function el(tag, props = {}, children = []) {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...children);
  return e;
}

const cacheKey = () =>
  'results:' + [[...settings.selectedBrandIds].sort().join(','), settings.categoryKey, [...settings.hiddenBrandIds].sort().join(',')].join('|');

function readParams() {
  const q = new URLSearchParams(location.search);
  return { selectedBrandIds: (q.get('brands') || '').split(',').filter(Boolean), categoryKey: q.get('cat') || 'all' };
}

function writeParams() {
  const q = new URLSearchParams({ brands: settings.selectedBrandIds.join(','), cat: settings.categoryKey });
  history.replaceState(null, '', '?' + q);
}

function brand(id) {
  return dict.brands.find((b) => b.id === id);
}

function renderHeader() {
  $('cat').textContent = category.name;
  $('brand-chips').replaceChildren(
    ...settings.selectedBrandIds.map((id) => {
      const b = el('button', { className: 'chip', title: '이 브랜드 빼기' }, [brand(id).name, el('span', { textContent: '✕' })]);
      b.onclick = () => {
        settings.selectedBrandIds = settings.selectedBrandIds.filter((x) => x !== id);
        start();
      };
      return b;
    }),
  );
  $('alias').textContent = settings.selectedBrandIds.length
    ? '검색 포함: ' + settings.selectedBrandIds.map((id) => brand(id).searchTerms.join(', ')).join(' · ')
    : '';
  document.title = `${settings.selectedBrandIds.map((id) => brand(id).name).join(' + ') || '브랜드 모아보기'} · ${category.name}`;
}

function renderRows() {
  const has = rows.length > 0;
  $('list').hidden = !has;
  $('rows').replaceChildren(
    ...rows.map((r) => {
      const terms = [...new Set(r.hits.map((h) => h.term))];
      return el('tr', {}, [
        el('td', { className: 'c-cat', textContent: r.categoryName }),
        el('td', {}, [
          el('a', { href: r.url, target: '_blank', rel: 'noopener', textContent: r.title }),
          ...(r.comments ? [el('span', { className: 'cmt', textContent: `[${r.comments}]` })] : []),
          ...terms.map((t) => el('span', { className: 'hit', textContent: t })),
        ]),
        el('td', { className: 'c-author', textContent: r.author }),
        el('td', { className: 'c-time', textContent: r.time }),
        el('td', { className: 'c-num', textContent: r.views ?? '' }),
        el('td', { className: 'c-num', textContent: r.votes ?? '' }),
      ]);
    }),
  );
}

function setStatus(text, { warn = false, running = false } = {}) {
  $('status').classList.toggle('warn', warn);
  $('status-text').textContent = text;
  $('cancel').hidden = !running;
  $('refresh').hidden = running;
  $('more').hidden = running || !jobs.length || page === 0;
  $('more').disabled = running;
}

async function runPage(nextPage) {
  controller = new AbortController();
  setStatus('검색 준비 중…', { running: true });
  const res = await runSearch({
    jobs,
    page: nextPage,
    fetchPage,
    signal: controller.signal,
    onProgress: ({ done, total, term }) => setStatus(`${done}/${total} 검색 중 · "${term}"`, { running: true }),
    onRows: (incoming, job) => {
      rows = mergeRows(rows, filterRows(incoming, { category, hiddenBrandIds: settings.hiddenBrandIds, matchers }), job.brandId, job.term);
      renderRows();
    },
  });
  controller = null;
  if (res.completed > 0) page = nextPage;
  $('empty').hidden = rows.length > 0 || res.status !== 'done';
  if (res.status === 'done') {
    setStatus(`${rows.length}개 글 · ${jobs.length}개 별명 검색`);
    chrome.storage.session.set({ [cacheKey()]: { rows, page, savedAt: Date.now() } });
  } else setStatus(MSG[res.status], { warn: res.status !== 'cancelled' });
}

async function start({ useCache = true } = {}) {
  controller?.abort();
  settings = normalizeSettings({ ...settings, selectedBrandIds: settings.selectedBrandIds }, dict);
  category = dict.categories.find((c) => c.key === settings.categoryKey);
  writeParams();
  renderHeader();
  rows = [];
  page = 0;
  ({ jobs, totalTerms } = buildSearchJobs({ dict, selectedBrandIds: settings.selectedBrandIds, hiddenBrandIds: settings.hiddenBrandIds }));
  $('capped').hidden = totalTerms <= jobs.length;
  $('capped').textContent = `별명 ${totalTerms}개 중 ${jobs.length}개만 검색했어요.`;
  $('empty').hidden = true;
  renderRows();

  if (!jobs.length) {
    setStatus('브랜드를 골라주세요. 툴바의 확장 프로그램 아이콘에서 고를 수 있어요.');
    return;
  }
  if (useCache) {
    const cached = (await chrome.storage.session.get(cacheKey()))[cacheKey()];
    if (cached && Date.now() - cached.savedAt < CACHE_TTL_MS) {
      rows = cached.rows;
      page = cached.page;
      renderRows();
      $('empty').hidden = rows.length > 0;
      setStatus(`${rows.length}개 글 · 저장된 결과 (${Math.round((Date.now() - cached.savedAt) / 60000)}분 전)`);
      return;
    }
  }
  await runPage(1);
}

async function main() {
  dict = await getDictionary(chrome.storage.local);
  matchers = compileMatchers(dict);
  const stored = await loadSettings(chrome.storage.sync, dict);
  settings = { ...readParams(), hiddenBrandIds: stored.hiddenBrandIds };
  $('cancel').onclick = () => controller?.abort();
  $('refresh').onclick = () => start({ useCache: false });
  $('more').onclick = () => runPage(page + 1);
  await start();
}

main();
