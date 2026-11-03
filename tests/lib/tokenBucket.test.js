import { test, expect, beforeEach } from 'vitest';
import { createTokenBucket } from '../../src/lib/tokenBucket.js';

let t;
let sleeps;
const now = () => t;
const sleep = async (ms) => {
  sleeps.push(ms);
  t += ms;
};
const make = () => createTokenBucket({ now, sleep });
const drain = async (b, n = 15) => {
  for (let i = 0; i < n; i++) await b.take();
};

beforeEach(() => {
  t = 0;
  sleeps = [];
});

test('first 15 takes resolve without sleeping', async () => {
  await drain(make());
  expect(sleeps).toEqual([]);
});

test('16th take waits 500ms', async () => {
  const b = make();
  await drain(b);
  await b.take();
  expect(sleeps).toEqual([500]);
});

test('refills up to capacity only', async () => {
  const b = make();
  await drain(b);
  t += 60_000;
  await drain(b);
  expect(sleeps).toEqual([]);
  await b.take();
  expect(sleeps).toEqual([500]);
});

test('concurrent waiters are served in order', async () => {
  const b = make();
  await drain(b);
  const order = [];
  const a = b.take().then(() => order.push('A'));
  const c = b.take().then(() => order.push('B'));
  await Promise.all([a, c]);
  expect(order).toEqual(['A', 'B']);
  expect(sleeps.reduce((x, y) => x + y, 0)).toBe(1000);
});

test('aborted take rejects and does not consume', async () => {
  const b = make();
  await drain(b);
  const ctl = new AbortController();
  ctl.abort();
  await expect(b.take(ctl.signal)).rejects.toMatchObject({ name: 'AbortError' });
  t += 500;
  await b.take();
  expect(sleeps).toEqual([]);
});
