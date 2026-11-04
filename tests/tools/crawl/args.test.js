import { test, expect } from 'vitest';
import { parseArgs } from '../../../tools/crawl/args.js';

const NOW = Date.parse('2026-11-04T18:00:00+09:00');

test('--for 1h becomes runUntil one hour from now', () => {
  expect(parseArgs(['--for', '1h'], NOW).runUntil).toBe(NOW + 3600000);
  expect(parseArgs(['--for', '30m'], NOW).runUntil).toBe(NOW + 1800000);
});

test('--until and --target are parsed; defaults are no limits and 100000', () => {
  const a = parseArgs(['--until', '2026-11-05T09:40:00+09:00', '--target', '5000'], NOW);
  expect(a.deadline).toBe(Date.parse('2026-11-05T09:40:00+09:00'));
  expect(a.target).toBe(5000);
  expect(parseArgs([], NOW)).toMatchObject({ runUntil: null, deadline: null, target: 100000, probeDepth: null });
});

test('--probe-depth takes a page number', () => {
  expect(parseArgs(['--probe-depth', '5000'], NOW).probeDepth).toBe(5000);
});

test('bad values are rejected', () => {
  expect(() => parseArgs(['--for', 'soon'], NOW)).toThrow();
  expect(() => parseArgs(['--until', 'tomorrow'], NOW)).toThrow();
  expect(() => parseArgs(['--bogus'], NOW)).toThrow();
});

test('--interval sets seconds between requests', () => {
  expect(parseArgs(['--interval', '45'], NOW).interval).toBe(45);
  expect(parseArgs([], NOW).interval).toBe(null);
  expect(() => parseArgs(['--interval', '0'], NOW)).toThrow();
  expect(() => parseArgs(['--interval', 'slow'], NOW)).toThrow();
});
