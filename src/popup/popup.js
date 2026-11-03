import { getDictionary, isRefreshDue } from '../lib/dictionaryStore.js';
import { loadSettings, saveSettings, normalizeSettings } from '../lib/settings.js';
import { encodeFmfHash, goTarget } from '../lib/fmfHash.js';

const $ = (id) => document.getElementById(id);
let dict;
let settings;
let hideDraft; // Set of brand ids while editing the 숨기기 tab

function el(tag, props = {}, children = []) {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...children);
  return e;
}

function brandsByGroup() {
  return dict.groups
    .map((g) => ({ group: g, brands: dict.brands.filter((b) => b.group === g.id) }))
    .filter((x) => x.brands.length);
}

function persist() {
  settings = normalizeSettings(settings, dict);
  return saveSettings(chrome.storage.sync, settings);
}

function renderCategories() {
  $('categories').replaceChildren(
    ...dict.categories.map((c) => {
      const on = c.key === settings.categoryKey;
      const b = el('button', { className: 'tab' + (on ? ' on' : ''), textContent: c.name, role: 'radio' });
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
  renderCategories();
  const hidden = new Set(settings.hiddenBrandIds);
  const selected = new Set(settings.selectedBrandIds);
  $('view-groups').replaceChildren(
    ...brandsByGroup().flatMap(({ group, brands }) => [
      el('div', { className: 't', textContent: group.name }),
      el('div', { className: 'chips' }, brands.map((b) => {
        const chip = el('button', {
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

  const chosen = settings.selectedBrandIds.map((id) => dict.brands.find((b) => b.id === id));
  const summary = $('alias-summary');
  summary.hidden = chosen.length === 0;
  summary.textContent = '검색 포함: ' + chosen.map((b) => b.searchTerms.join(', ')).join(' · ');

  const cat = dict.categories.find((c) => c.key === settings.categoryKey);
  const go = $('go');
  go.disabled = chosen.length === 0;
  go.textContent = chosen.length ? `${chosen.length}개 브랜드 · ${cat.name} 보기` : '브랜드를 골라주세요';
  $('tab-hide').textContent = settings.hiddenBrandIds.length ? `숨기기 · ${settings.hiddenBrandIds.length}` : '숨기기';
}

function renderHide() {
  $('hide-groups').replaceChildren(
    ...brandsByGroup().flatMap(({ group, brands }) => [
      el('div', { className: 't', textContent: group.name }),
      el('div', { className: 'chips' }, brands.map((b) => {
        const on = hideDraft.has(b.id);
        const chip = el('button', { className: 'chip' + (on ? ' hide' : ''), textContent: b.name, title: b.searchTerms.join(', ') });
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

async function main() {
  dict = await getDictionary(chrome.storage.local);
  settings = await loadSettings(chrome.storage.sync, dict);
  $('dict-version').textContent = `사전 v${dict.version}`;

  $('tab-view').onclick = () => showTab('view');
  $('tab-hide').onclick = () => showTab('hide');
  $('reset').onclick = () => {
    settings.selectedBrandIds = [];
    settings.categoryKey = 'all';
    persist();
    renderView();
  };
  $('go').onclick = async () => {
    // Results show inside the fmkorea fashion board itself (spec §4.2).
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const { action, url } = goTarget(tab?.url, encodeFmfHash({ brandIds: settings.selectedBrandIds, categoryKey: settings.categoryKey }));
    if (action === 'update' && tab?.id != null) await chrome.tabs.update(tab.id, { url });
    else await chrome.tabs.create({ url });
    window.close();
  };
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

  if (await isRefreshDue(chrome.storage.local, Date.now())) chrome.runtime.sendMessage({ type: 'refreshDictionary' });
}

main();
