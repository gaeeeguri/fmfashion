import { test, expect } from 'vitest';
import { createRateGate } from '../../../tools/crawl/rateGate.js';
import { fakeClock } from './fakeClock.js';

const flush = () => new Promise((r) => setImmediate(r));

test('requests start at the fixed interval of the rate (2/s → 500ms)', async () => {
  const clock = fakeClock();
  const gate = createRateGate({ clock });
  const starts = [];
  for (let i = 0; i < 5; i++) {
    await gate.acquire();
    starts.push(clock.now());
    gate.release();
  }
  expect(starts).toEqual([0, 500, 1000, 1500, 2000]);
});

test('no more than maxInFlight requests at once', async () => {
  const clock = fakeClock();
  const gate = createRateGate({ clock, maxInFlight: 4 });
  for (let i = 0; i < 4; i++) await gate.acquire();
  let fifth = false;
  gate.acquire().then(() => (fifth = true));
  clock.advance(10000);
  await flush();
  await flush();
  expect(fifth).toBe(false);
  gate.release();
  await flush();
  await flush();
  expect(fifth).toBe(true);
});

test('a 429 pauses every request for 5 minutes', async () => {
  const clock = fakeClock();
  const gate = createRateGate({ clock });
  await gate.acquire();
  gate.release();
  const r = gate.on429();
  expect(r.pausedUntil).toBe(300000);
  await gate.acquire();
  expect(clock.now()).toBeGreaterThanOrEqual(300000);
});

test('three 429s within an hour step the rate down 2 → 1.5 → 1 and no lower', () => {
  const clock = fakeClock();
  const gate = createRateGate({ clock });
  const three = () => [gate.on429(), gate.on429(), gate.on429()];
  const first = three();
  expect(first.map((r) => r.lowered)).toEqual([false, false, true]);
  expect(gate.rate).toBe(1.5);
  three();
  expect(gate.rate).toBe(1);
  three();
  expect(gate.rate).toBe(1);
});

test('429s more than an hour apart do not lower the rate', () => {
  const clock = fakeClock();
  const gate = createRateGate({ clock });
  for (let i = 0; i < 3; i++) {
    gate.on429();
    clock.advance(3600001);
  }
  expect(gate.rate).toBe(2);
});

test('initial snapshot restores the rate step', () => {
  const gate = createRateGate({ clock: fakeClock(), initial: { rateIndex: 1, recent429s: [] } });
  expect(gate.rate).toBe(1.5);
  expect(gate.snapshot()).toEqual({ rateIndex: 1, recent429s: [], pausedUntil: null });
});

test('warm-up paces at 1/s before switching to the full rate', async () => {
  const clock = fakeClock();
  const gate = createRateGate({ clock, warmupMs: 3000 });
  const starts = [];
  for (let i = 0; i < 6; i++) {
    await gate.acquire();
    starts.push(clock.now());
    gate.release();
  }
  expect(starts).toEqual([0, 1000, 2000, 3000, 3500, 4000]);
});

test('a saved rate step beyond the given rates clamps to the slowest one', () => {
  const gate = createRateGate({ clock: fakeClock(), rates: [0.02], initial: { rateIndex: 2, recent429s: [] } });
  expect(gate.rate).toBe(0.02);
});

test('a saved 429 pause is honoured after a restart', async () => {
  const clock = fakeClock();
  const gate = createRateGate({ clock, initial: { rateIndex: 0, recent429s: [], pausedUntil: 300000 } });
  await gate.acquire();
  expect(clock.now()).toBeGreaterThanOrEqual(300000);
});

test('snapshot carries the pause so it can be saved', () => {
  const clock = fakeClock();
  const gate = createRateGate({ clock });
  gate.on429();
  expect(gate.snapshot().pausedUntil).toBe(300000);
});
