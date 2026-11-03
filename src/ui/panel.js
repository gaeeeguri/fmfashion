// The brand panel (보기 / 숨기기), shared by the toolbar popup and the in-page floating badge.
import { normalizeSettings } from '../lib/settings.js';

const TEMPLATE = `
<main class="pp">
  <header class="pp-h"><b>패션 브랜드 필터</b><span id="dict-version"></span></header>
  <div class="mode" role="tablist">
    <button role="tab" id="tab-view" class="on" aria-selected="true">보기</button>
    <button role="tab" id="tab-hide" aria-selected="false">숨기기</button>
  </div>
  <section id="pane-view">
    <div class="tabs" id="categories" role="radiogroup" aria-label="카테고리"></div>
    <div class="sec" id="view-groups"></div>
    <p class="alias" id="alias-summary" hidden></p>
    <footer class="foot">
      <button class="btn s" id="reset">초기화</button>
      <button class="btn p" id="go" disabled>브랜드를 골라주세요</button>
    </footer>
  </section>
  <section id="pane-hide" hidden>
    <p class="note">고른 브랜드는 패션 게시판 목록과 검색 결과에서 보이지 않아요.</p>
    <div class="sec" id="hide-groups"></div>
    <footer class="foot">
      <button class="btn s" id="clear-hidden">모두 해제</button>
      <button class="btn r" id="save-hidden">저장</button>
    </footer>
  </section>
</main>`;

/**
 * 보기 button state (spec §11.1): enabled with ≥1 selected brand, or with only hidden brands (browse mode).
 * @param {import('../lib/settings.js').Settings} settings
 * @param {import('../lib/dictionary.js').Dictionary} dict
 * @returns {{ disabled: boolean, text: string }}
 */
export function goLabel(settings, dict) {
  const cat = dict.categories.find((c) => c.key === settings.categoryKey) ?? dict.categories.find((c) => c.key === 'all');
  const n = settings.selectedBrandIds.length;
  if (n) return { disabled: false, text: `${n}개 브랜드 · ${cat.name} 보기` };
  const h = settings.hiddenBrandIds.length;
  if (h) return { disabled: false, text: `${cat.name} 보기 · 숨김 ${h}개 제외` };
  return { disabled: true, text: '브랜드를 골라주세요' };
}

/**
 * @param {Element | ShadowRoot} root
 * @param {{ dict: import('../lib/dictionary.js').Dictionary, settings: import('../lib/settings.js').Settings,
 *   save: (s: import('../lib/settings.js').Settings) => Promise<void>,
 *   onGo: (sel: { brandIds: string[], categoryKey: string }) => void, onClose?: () => void }} opts
 */
export function mountPanel(root, { dict, settings: initial, save, onGo, onClose }) {
  const doc = root.ownerDocument ?? root;
  const wrap = doc.createElement('div');
  wrap.innerHTML = TEMPLATE;
  const main = wrap.firstElementChild;
  root.append(main);
  const $ = (id) => main.querySelector('#' + id);
  const el = (tag, props = {}, children = []) => {
    const e = Object.assign(doc.createElement(tag), props);
    e.append(...children);
    return e;
  };

  let dictRef = dict;
  let settings = normalizeSettings(initial, dictRef);
  let hideDraft = new Set(settings.hiddenBrandIds);
  let tab = 'view';
  const pendingEchoes = []; // JSON of our own saves whose storage.onChanged echo hasn't come back yet

  if (onClose) {
    const close = el('button', { className: 'close', type: 'button', textContent: '접기', onclick: () => onClose() });
    main.querySelector('.pp-h').append(close);
  }

  const brandsByGroup = () =>
    dictRef.groups.map((g) => ({ group: g, brands: dictRef.brands.filter((b) => b.group === g.id) })).filter((x) => x.brands.length);

  function persist() {
    settings = normalizeSettings(settings, dictRef);
    pendingEchoes.push(JSON.stringify(settings));
    if (pendingEchoes.length > 50) pendingEchoes.shift();
    return save(settings);
  }

  function renderCategories() {
    $('categories').replaceChildren(
      ...dictRef.categories.map((c) => {
        const on = c.key === settings.categoryKey;
        const b = el('button', { className: 'tab' + (on ? ' on' : ''), textContent: c.name, type: 'button' });
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-checked', String(on));
        b.onclick = () => {
          settings.categoryKey = c.key;
          persist();
          renderView();
        };
        return b;
      }),
    );
  }

  function renderView() {
    $('dict-version').textContent = `사전 v${dictRef.version}`;
    renderCategories();
    const hidden = new Set(settings.hiddenBrandIds);
    const selected = new Set(settings.selectedBrandIds);
    $('view-groups').replaceChildren(
      ...brandsByGroup().flatMap(({ group, brands }) => [
        el('div', { className: 't', textContent: group.name }),
        el('div', { className: 'chips' }, brands.map((b) => {
          const chip = el('button', {
            type: 'button',
            className: 'chip' + (selected.has(b.id) ? ' on' : ''),
            textContent: b.name,
            disabled: hidden.has(b.id),
            title: hidden.has(b.id) ? '숨긴 브랜드예요' : b.searchTerms.join(', '),
          });
          chip.setAttribute('aria-pressed', String(selected.has(b.id)));
          chip.onclick = () => {
            settings.selectedBrandIds = selected.has(b.id)
              ? settings.selectedBrandIds.filter((x) => x !== b.id)
              : [...settings.selectedBrandIds, b.id];
            persist();
            renderView();
          };
          return chip;
        })),
      ]),
    );
    const chosen = settings.selectedBrandIds.map((id) => dictRef.brands.find((b) => b.id === id)).filter(Boolean);
    const summary = $('alias-summary');
    summary.hidden = chosen.length === 0;
    summary.textContent = '검색 포함: ' + chosen.map((b) => b.searchTerms.join(', ')).join(' · ');
    const { disabled, text } = goLabel(settings, dictRef);
    $('go').disabled = disabled;
    $('go').textContent = text;
    $('tab-hide').textContent = settings.hiddenBrandIds.length ? `숨기기 · ${settings.hiddenBrandIds.length}` : '숨기기';
  }

  function renderHide() {
    $('hide-groups').replaceChildren(
      ...brandsByGroup().flatMap(({ group, brands }) => [
        el('div', { className: 't', textContent: group.name }),
        el('div', { className: 'chips' }, brands.map((b) => {
          const on = hideDraft.has(b.id);
          const chip = el('button', { type: 'button', className: 'chip' + (on ? ' hide' : ''), textContent: b.name, title: b.searchTerms.join(', ') });
          chip.setAttribute('aria-pressed', String(on));
          chip.onclick = () => {
            on ? hideDraft.delete(b.id) : hideDraft.add(b.id);
            renderHide();
          };
          return chip;
        })),
      ]),
    );
  }

  function showTab(which) {
    tab = which;
    const view = which === 'view';
    $('tab-view').classList.toggle('on', view);
    $('tab-hide').classList.toggle('on', !view);
    $('tab-view').setAttribute('aria-selected', String(view));
    $('tab-hide').setAttribute('aria-selected', String(!view));
    $('pane-view').hidden = !view;
    $('pane-hide').hidden = view;
    if (view) renderView();
    else {
      hideDraft = new Set(settings.hiddenBrandIds);
      renderHide();
    }
  }

  $('tab-view').onclick = () => showTab('view');
  $('tab-hide').onclick = () => showTab('hide');
  $('reset').onclick = () => {
    settings.selectedBrandIds = [];
    settings.categoryKey = 'all';
    persist();
    renderView();
  };
  $('go').onclick = () => onGo({ brandIds: [...settings.selectedBrandIds], categoryKey: settings.categoryKey });
  $('clear-hidden').onclick = () => {
    hideDraft.clear();
    renderHide();
  };
  $('save-hidden').onclick = async () => {
    settings.hiddenBrandIds = [...hideDraft];
    await persist();
    showTab('view');
  };
  showTab('view');

  return {
    /** Re-render after settings or the dictionary changed elsewhere (another tab, the popup). */
    update(next, nextDict = dictRef) {
      const dictChanged = nextDict !== dictRef;
      dictRef = nextDict;
      const incoming = normalizeSettings(next, dictRef);
      const echo = pendingEchoes.indexOf(JSON.stringify(incoming));
      if (echo >= 0 && !dictChanged) {
        // our own earlier save coming back late: newer local clicks win
        pendingEchoes.splice(0, echo + 1);
        return;
      }
      settings = incoming;
      if (tab === 'view') renderView();
      else renderHide();
    },
    destroy() {
      main.remove();
    },
  };
}
