import { getDictionary } from '../lib/dictionaryStore.js';
import { loadSettings, normalizeSettings } from '../lib/settings.js';
import { compileMatchers } from '../lib/matcher.js';
import { fetchPage } from '../lib/fetchPage.js';
import { createPoliteFetch } from '../lib/politeFetch.js';
import { createResultsController } from '../lib/resultsController.js';

const MSG = {
  blocked: '펨코 보안 시스템 때문에 검색을 멈췄어요. 잠시 후 다시 시도해 주세요.',
  error: '검색 중 오류가 났어요. 다시 시도해 주세요.',
  unrecognized: '펨코 페이지 구조가 바뀐 것 같아요. 확장 프로그램 업데이트가 필요해요.',
  cancelled: '검색을 취소했어요.',
};
const $ = (id) => document.getElementById(id);

let dict, settings, ctl;

function el(tag, props = {}, children = []) {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...children);
  return e;
}

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
  const category = ctl.category;
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

function renderRows(rows) {
  $('list').hidden = rows.length === 0;
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

function statusText(s) {
  switch (s.status) {
    case 'empty':
      return '브랜드를 골라주세요. 툴바의 확장 프로그램 아이콘에서 고를 수 있어요.';
    case 'running':
      return s.progress ? `${s.progress.done}/${s.progress.total} 검색 중 · "${s.progress.term}"` : '검색 준비 중…';
    case 'done':
      return s.fromCache
        ? `${s.rows.length}개 글 · 저장된 결과 (${Math.round((Date.now() - s.fromCache.savedAt) / 60000)}분 전)`
        : `${s.rows.length}개 글 · ${s.jobs.length}개 별명 검색`;
    case 'error':
      return MSG[s.reason] ?? MSG.error;
    default:
      return MSG[s.status] ?? '';
  }
}

function render(s) {
  renderRows(s.rows);
  const running = s.status === 'running';
  $('status').classList.toggle('warn', s.status === 'blocked' || s.status === 'error');
  $('status-text').textContent = statusText(s);
  $('cancel').hidden = !running;
  $('refresh').hidden = running || s.status === 'empty';
  $('more').hidden = running || !s.moreLabel;
  $('more').textContent = s.moreLabel ?? '';
  $('empty').hidden = !(s.status === 'done' && s.rows.length === 0);
  $('capped').hidden = s.totalTerms <= s.jobs.length;
  $('capped').textContent = `별명 ${s.totalTerms}개 중 ${s.jobs.length}개만 검색했어요.`;
}

function start(opts) {
  settings = normalizeSettings(settings, dict);
  writeParams();
  const p = ctl.start(settings, opts);
  renderHeader();
  return p;
}

async function main() {
  dict = await getDictionary(chrome.storage.local);
  const stored = await loadSettings(chrome.storage.sync, dict);
  settings = { ...readParams(), hiddenBrandIds: stored.hiddenBrandIds };
  const session = chrome.storage.session;
  ctl = createResultsController({
    dict,
    matchers: compileMatchers(dict),
    fetchPage: createPoliteFetch(fetchPage),
    cache: { get: async (k) => (await session.get(k))[k], set: (k, v) => session.set({ [k]: v }) },
    onChange: render,
  });
  $('cancel').onclick = () => ctl.cancel();
  $('refresh').onclick = () => start({ useCache: false });
  $('more').onclick = () => ctl.more();
  await start();
}

main();
