import { test, expect } from 'vitest';
import { encodeFmfHash, parseFmfHash, goTarget } from '../../src/lib/fmfHash.js';

test('round trip', () => {
  const sel = { brandIds: ['steadyeverywhere', 'anotheroffice'], categoryKey: 'fit' };
  const h = encodeFmfHash(sel);
  expect(h).toBe('#fmf=b:steadyeverywhere,anotheroffice;c:fit');
  expect(parseFmfHash(h)).toEqual(sel);
});
test('non-fmf hash → null', () => {
  expect(parseFmfHash('#foo')).toBeNull();
  expect(parseFmfHash('')).toBeNull();
});
test('drops empty ids and defaults category', () => {
  expect(parseFmfHash('#fmf=b:a,,b')).toEqual({ brandIds: ['a', 'b'], categoryKey: 'all' });
});
test('accepts URI-encoded input', () => {
  expect(parseFmfHash('#fmf=b%3Aa%2Cb%3Bc%3Afit')).toEqual({ brandIds: ['a', 'b'], categoryKey: 'fit' });
});
test('odd ids survive encoding', () => {
  const sel = { brandIds: ['a;b', '한글'], categoryKey: 'all' };
  expect(parseFmfHash(encodeFmfHash(sel))).toEqual(sel);
});
test('goTarget updates fmkorea tabs, creates otherwise', () => {
  const h = '#fmf=b:a;c:all';
  expect(goTarget('https://www.fmkorea.com/12345', h)).toEqual({ action: 'update', url: 'https://www.fmkorea.com/fashion' + h });
  expect(goTarget('chrome://newtab/', h)).toEqual({ action: 'create', url: 'https://www.fmkorea.com/fashion' + h });
  expect(goTarget(undefined, h).action).toBe('create');
});
