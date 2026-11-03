import { docIdFromHref } from './parser.js';
// In-page result mode (spec §4.2): fmkorea's own list table shows the merged rows.
const BAR_ID = 'fmf-results-bar';
const FOOT_ID = 'fmf-foot';
const SENTINEL_ID = 'fmf-sentinel';
const ORIGIN = 'https://www.fmkorea.com';
const HIDING_BAR_ID = 'fmf-bar';
const ORIG = 'data-fmf-orig';
const PREV = 'data-fmf-prev-display';
const RESULT = 'data-fmf-result';

const NOTICE = {
  blocked: '펨코 보안 확인이 필요해요. 새로고침 후 다시 시도해 주세요',
  limited: '펨코가 잠시 요청을 제한했어요',
  unrecognized: '펨코 화면 구조가 바뀐 것 같아요',
  error: '일부 검색에 실패했어요',
  empty: '조건에 맞는 글이 없어요',
};
/** Default sentinel watcher: fires when the sentinel comes within 600px of the viewport. */
function observeIntersection(el, onVisible) {
  const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && onVisible(), { rootMargin: '600px 0px' });
  io.observe(el);
  return () => io.disconnect();
}
const BTN = 'border:0;background:none;color:#3b5bfd;cursor:pointer;padding:0;font:inherit';

/**
 * @param {Document} doc
 * @param {{ onRemoveBrand: (id: string) => void, onCancel: () => void, onExit: () => void, onMore: () => void }} h
 */
export function createResultView(doc, h, { observe = observeIntersection, root = doc } = {}) {
  const el = (tag, props = {}, kids = []) => {
    const e = Object.assign(doc.createElement(tag), props);
    e.append(...kids);
    return e;
  };

  let table = root.querySelector('table.bd_lst');
  let createdTable = null;
  const pager = root.querySelector('form.bd_pg');

  // hide the original list and the plain hiding bar
  if (table) {
    for (const body of table.tBodies) for (const tr of body.rows) {
      tr.setAttribute(ORIG, '');
      tr.setAttribute(PREV, tr.style.display);
      tr.style.display = 'none';
    }
  }
  doc.getElementById(HIDING_BAR_ID)?.remove();
  const pagerPrev = pager?.style.display ?? '';
  if (pager) pager.style.display = 'none';

  if (!table) {
    createdTable = el('table', { className: 'bd_lst bd_tb_lst bd_tb' }, [el('tbody')]);
    const wrap = (root.matches?.('div.bd_lst_wrp') ? root : root.querySelector('div.bd_lst_wrp')) ?? doc.body;
    if (pager && wrap.contains(pager)) pager.before(createdTable);
    else wrap.append(createdTable);
    table = createdTable;
  }
  const tbody = table.tBodies[0] ?? table.appendChild(el('tbody'));

  const bar = el('div', { id: BAR_ID });
  bar.style.cssText = 'margin:8px 0;padding:8px 10px;border:1px solid #c9d3ff;background:#f3f5ff;border-radius:6px;display:flex;flex-wrap:wrap;gap:8px;align-items:center;font-size:12px;color:#333';
  table.before(bar);

  const foot = el('div', { id: FOOT_ID });
  foot.style.cssText = 'text-align:center;margin:10px 0;color:#999;font-size:12px';
  const sentinel = el('div', { id: SENTINEL_ID });
  sentinel.style.cssText = 'height:1px';
  table.after(foot, sentinel);

  let canLoad = false; // true only right after a render that leaves more pages to auto-load
  let disconnect = null;
  const onVisible = () => {
    if (!canLoad) return;
    canLoad = false; // one load per render
    h.onMore();
  };
  const arm = () => {
    disconnect?.();
    disconnect = observe(sentinel, onVisible);
  };

  /**
   * @param {import('./searchSession.js').SessionState} state
   * @param {{ brands: Array<{ id: string, name: string }>, categoryName: string, totalTerms: number,
   *   linkHash?: string, hiddenCount?: number }} ctx
   */
  function render(state, ctx) {
    for (const tr of tbody.querySelectorAll(`tr[${RESULT}]`)) tr.remove();
    for (const r of state.rows) {
      const tr = doc.importNode(r.tr, true);
      tr.setAttribute(RESULT, '');
      tr.removeAttribute(ORIG);
      tr.style.display = '';
      const cell = tr.querySelector('td.title');
      // links lose fmkorea's per-alias search params and carry our state instead (spec §11.3)
      for (const a of cell?.querySelectorAll('a[href]') ?? []) {
        const id = docIdFromHref(a.getAttribute('href'));
        if (!id) continue;
        a.setAttribute('href', `${ORIGIN}/${id}${ctx.linkHash ?? ''}`);
        a.removeAttribute('data-viewer'); // fmkorea's viewer URL still carries the alias search
      }
      for (const term of [...new Set(r.hits.map((x) => x.term))]) {
        const b = el('span', { className: 'fmf-hit', textContent: term });
        b.style.cssText = 'font-size:11px;color:#888;border:1px solid #e3e3e6;border-radius:5px;padding:0 5px;margin-left:5px';
        cell?.append(b);
      }
      tbody.append(tr);
    }

    const parts = [el('b', { textContent: '브랜드 모아보기' })];
    parts[0].style.color = '#2a45d8';
    const cat = el('span', { textContent: ctx.categoryName });
    cat.style.cssText = 'background:#1a1a1a;color:#fff;border-radius:999px;padding:1px 8px';
    parts.push(cat);
    if (state.mode === 'browse') parts.push(el('span', { textContent: `숨김 ${ctx.hiddenCount ?? 0}개 제외` }));
    for (const b of ctx.brands) {
      const x = el('button', { type: 'button', textContent: '✕', title: `${b.name} 빼기`, onclick: () => h.onRemoveBrand(b.id) });
      x.style.cssText = BTN + ';margin-left:4px';
      const chip = el('span', { textContent: b.name }, [x]);
      chip.dataset.brand = b.id;
      chip.style.cssText = 'border:1px solid #3b5bfd;background:#fff;color:#2a45d8;border-radius:6px;padding:1px 8px;font-weight:600';
      parts.push(chip);
    }
    const status = el('span');
    status.style.cssText = 'margin-left:auto;color:#6b7090;display:flex;gap:6px;align-items:center';
    const msg = [];
    if (state.status === 'running' && state.progress) msg.push(`검색 중 ${state.progress.done}/${state.progress.total}`);
    if (state.status === 'blocked') msg.push(NOTICE.blocked);
    else if (state.notice) msg.push(NOTICE[state.notice]);
    if (state.status !== 'running' && state.status !== 'blocked' && !state.rows.length && !state.notice) msg.push(NOTICE.empty);
    if (ctx.totalTerms > state.jobCount && state.jobCount) msg.push(`별명 ${ctx.totalTerms}개 중 ${state.jobCount}개만 검색`);
    status.append(el('span', { textContent: msg.join(' · ') }));
    if (state.status === 'running') {
      const c = el('button', { type: 'button', textContent: '취소', onclick: () => h.onCancel() });
      c.style.cssText = BTN;
      status.append(c);
    }
    const exit = el('button', { type: 'button', textContent: '원래 목록으로', onclick: () => h.onExit() });
    exit.style.cssText = BTN;
    status.append(exit);
    parts.push(status);
    bar.replaceChildren(...parts);

    const running = state.status === 'running';
    if (running && state.rows.length) foot.replaceChildren('불러오는 중…');
    else if (!running && state.moreLabel === '이어서 검색') {
      const b = el('button', { type: 'button', textContent: '이어서 검색', onclick: () => h.onMore() });
      b.style.cssText = 'padding:6px 18px;border:1px solid #c9d3ff;border-radius:6px;background:#fff;color:#3b5bfd;cursor:pointer;font-size:13px';
      foot.replaceChildren(b);
    } else if (!running && state.finished && state.rows.length) foot.replaceChildren('끝');
    else foot.replaceChildren();

    canLoad = !running && state.moreLabel === '더 보기';
    if (canLoad) arm();
  }

  function destroy() {
    bar.remove();
    disconnect?.();
    canLoad = false;
    foot.remove();
    sentinel.remove();
    for (const tr of tbody.querySelectorAll(`tr[${RESULT}]`)) tr.remove();
    createdTable?.remove();
    for (const tr of doc.querySelectorAll(`tr[${ORIG}]`)) {
      tr.style.display = tr.getAttribute(PREV) ?? '';
      tr.removeAttribute(ORIG);
      tr.removeAttribute(PREV);
    }
    if (pager) pager.style.display = pagerPrev;
  }

  return { render, destroy };
}
