import { test, expect } from 'vitest';
import { snapshotKey, saveSnapshot, loadSnapshot } from '../../src/lib/resultSnapshot.js';

function mem() {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), m };
}
const key = snapshotKey({ hash: '#fmf=b:paf;c:all', hiddenBrandIds: ['b', 'a'], dictVersion: 3 });

test('save then load with the same key', () => {
  const st = mem();
  saveSnapshot(st, key, { x: 1 }, 1000);
  expect(loadSnapshot(st, key, 2000)).toEqual({ x: 1 });
});
test('key ignores hidden id order', () => {
  expect(snapshotKey({ hash: '#fmf=b:paf;c:all', hiddenBrandIds: ['a', 'b'], dictVersion: 3 })).toBe(key);
});
test('different selection, hidden brands or dictionary → no snapshot', () => {
  const st = mem();
  saveSnapshot(st, key, { x: 1 }, 1000);
  for (const k of [
    snapshotKey({ hash: '#fmf=b:paf;c:fit', hiddenBrandIds: ['a', 'b'], dictVersion: 3 }),
    snapshotKey({ hash: '#fmf=b:paf;c:all', hiddenBrandIds: ['a'], dictVersion: 3 }),
    snapshotKey({ hash: '#fmf=b:paf;c:all', hiddenBrandIds: ['a', 'b'], dictVersion: 4 }),
  ]) expect(loadSnapshot(st, k, 2000)).toBeNull();
});
test('expires after 30 minutes', () => {
  const st = mem();
  saveSnapshot(st, key, { x: 1 }, 0);
  expect(loadSnapshot(st, key, 30 * 60 * 1000 - 1)).toEqual({ x: 1 });
  expect(loadSnapshot(st, key, 30 * 60 * 1000 + 1)).toBeNull();
});
test('broken or throwing storage never throws', () => {
  const bad = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('quota'); } };
  expect(() => saveSnapshot(bad, key, { x: 1 })).not.toThrow();
  expect(loadSnapshot(bad, key)).toBeNull();
  expect(loadSnapshot({ getItem: () => '{oops', setItem() {} }, key)).toBeNull();
});
