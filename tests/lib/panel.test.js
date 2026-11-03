// @vitest-environment jsdom
import { test, expect } from 'vitest';
import bundled from '../../dictionary/brands.json';
import { goLabel, mountPanel } from '../../src/ui/panel.js';

const S = (o = {}) => ({ hiddenBrandIds: [], selectedBrandIds: [], categoryKey: 'all', ...o });

test('goLabel: nothing chosen → disabled', () => {
  expect(goLabel(S(), bundled)).toEqual({ disabled: true, text: '브랜드를 골라주세요' });
});
test('goLabel: hidden only → browse label', () => {
  expect(goLabel(S({ hiddenBrandIds: ['fafter', 'firstfloor'], categoryKey: 'fit' }), bundled)).toEqual({ disabled: false, text: '착샷 보기 · 숨김 2개 제외' });
});
test('goLabel: brands chosen', () => {
  expect(goLabel(S({ selectedBrandIds: ['steadyeverywhere', 'anotheroffice'] }), bundled)).toEqual({ disabled: false, text: '2개 브랜드 · 전체 보기' });
});

function setup(settings = S(), { shadow = false, onClose } = {}) {
  const host = document.createElement('div');
  const root = shadow ? host.attachShadow({ mode: 'open' }) : host;
  const saved = [];
  const gone = [];
  const panel = mountPanel(root, {
    dict: bundled, settings,
    save: async (s) => { saved.push(structuredClone(s)); },
    onGo: (sel) => gone.push(sel),
    onClose,
  });
  const $ = (sel) => root.querySelector(sel);
  const button = (text) => [...root.querySelectorAll('button')].find((b) => b.textContent === text);
  return { root, panel, saved, gone, $, button };
}

test('renders categories and brand chips', () => {
  const { root } = setup();
  expect(root.querySelectorAll('[role=radio]').length).toBe(bundled.categories.length);
  expect([...root.querySelectorAll('#view-groups .chip')].map((c) => c.textContent)).toEqual(
    expect.arrayContaining(['스테디에브리웨어', '어나더오피스']),
  );
});
test('chip click saves selection', async () => {
  const { button, saved } = setup();
  button('어나더오피스').click();
  await Promise.resolve();
  expect(saved.at(-1).selectedBrandIds).toEqual(['anotheroffice']);
});
test('보기 works with only hidden brands', () => {
  const { $, gone } = setup(S({ hiddenBrandIds: ['fafter'], categoryKey: 'fit' }));
  const go = $('#go');
  expect(go.disabled).toBe(false);
  expect(go.textContent).toBe('착샷 보기 · 숨김 1개 제외');
  go.click();
  expect(gone).toEqual([{ brandIds: [], categoryKey: 'fit' }]);
});
test('hide tab save stores hidden brands', async () => {
  const { $, button, saved } = setup();
  $('#tab-hide').click();
  [...$('#hide-groups').querySelectorAll('button')].find((x) => x.textContent === '파프터').click();
  button('저장').click();
  await new Promise((r) => setTimeout(r, 0));
  expect(saved.at(-1).hiddenBrandIds).toEqual(['fafter']);
});
test('접기 calls onClose; absent without onClose', () => {
  let closed = 0;
  const a = setup(S(), { onClose: () => closed++ });
  a.button('접기').click();
  expect(closed).toBe(1);
  expect(setup().button('접기')).toBeUndefined();
});
test('mounts inside a shadow root', () => {
  const { root, $ } = setup(S({ selectedBrandIds: ['anotheroffice'] }), { shadow: true });
  expect(root instanceof ShadowRoot).toBe(true);
  expect($('#go').disabled).toBe(false);
});
test('update re-renders with new settings', () => {
  const { panel, $ } = setup();
  panel.update(S({ hiddenBrandIds: ['fafter'] }));
  expect($('#go').disabled).toBe(false);
  expect($('#tab-hide').textContent).toBe('숨기기 · 1');
});

test('a late echo of an earlier save does not undo newer clicks', async () => {
  const { panel, button, saved, $ } = setup();
  button('어나더오피스').click();
  button('스테디에브리웨어').click();
  panel.update(saved[0]); // storage.onChanged for the first save arrives late
  button('PAF').click();
  expect(saved.at(-1).selectedBrandIds).toEqual(['anotheroffice', 'steadyeverywhere', 'paf']);
  expect($('#go').textContent).toBe('3개 브랜드 · 전체 보기');
});
test('a change from elsewhere still updates the panel', () => {
  const { panel, $ } = setup();
  panel.update(S({ hiddenBrandIds: ['fafter', 'firstfloor'] }));
  expect($('#tab-hide').textContent).toBe('숨기기 · 2');
});
