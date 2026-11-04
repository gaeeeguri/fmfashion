import { test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { parsePost, parseList } from '../../../tools/crawl/parse.js';

// jsdom kept ~12 MB per parsed post page and the overnight crawl died at the 4 GB heap limit (2026-11-04)
test('parsing many pages does not keep their documents in memory', () => {
  const post = readFileSync('tests/fixtures/document.html', 'utf8');
  const list = readFileSync('tests/fixtures/board-list.html', 'utf8');
  setFlagsFromString('--expose-gc');
  const gc = runInNewContext('gc');
  const heap = () => {
    gc();
    return process.memoryUsage().heapUsed;
  };
  for (let i = 0; i < 5; i++) parsePost(post);
  const before = heap();
  for (let i = 0; i < 40; i++) {
    parsePost(post);
    parseList(list, []);
  }
  expect((heap() - before) / 1e6).toBeLessThan(60);
});
