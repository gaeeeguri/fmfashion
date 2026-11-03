// @vitest-environment jsdom
import { test, expect, beforeEach } from 'vitest';
import { mountBadge } from '../../src/ui/badge.js';

let toggles;
const make = (o = {}) => mountBadge(document, { open: false, hiddenCount: 0, css: '.pp{}', onToggle: (b) => toggles.push(b), ...o });
const shadow = () => document.getElementById('fmf-badge-host').shadowRoot;

beforeEach(() => {
  document.body.innerHTML = '';
  toggles = [];
});

test('badge renders in a shadow root and toggles', () => {
  make();
  expect(document.getElementById('fmf-badge-host')).not.toBeNull();
  expect(shadow().querySelector('style').textContent).toContain('.pp{}');
  shadow().querySelector('.fmf-badge').click();
  expect(toggles).toEqual([true]);
});
test('setOpen shows and hides the panel container', () => {
  const b = make();
  expect(b.panelRoot.hidden).toBe(true);
  b.setOpen(true);
  expect(b.panelRoot.hidden).toBe(false);
  shadow().querySelector('.fmf-badge').click();
  expect(toggles).toEqual([false]);
  b.setOpen(false);
  expect(b.panelRoot.hidden).toBe(true);
});
test('starts open when asked', () => {
  expect(make({ open: true }).panelRoot.hidden).toBe(false);
});
test('hidden count text', () => {
  const b = make();
  expect(shadow().querySelector('.fmf-badge').textContent).toBe('필터');
  b.setHiddenCount(2);
  expect(shadow().querySelector('.fmf-badge').textContent).toBe('필터 · 2');
});
test('destroy removes host', () => {
  make().destroy();
  expect(document.getElementById('fmf-badge-host')).toBeNull();
});
test('mounting twice keeps a single host', () => {
  make();
  make();
  expect(document.querySelectorAll('#fmf-badge-host').length).toBe(1);
});
