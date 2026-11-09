import { test, expect } from 'vitest';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { parsePost, parseList } from '../../../tools/crawl/parse.js';

// jsdom kept ~12 MB per parsed post page and the overnight crawl died at the 4 GB heap limit (2026-11-04)
test('parsing many pages does not keep their documents in memory', () => {
  // synthetic pages (tests/fixtures is gitignored): sized like a real post page, ~150 KB of markup
  const filler = Array.from({ length: 1500 }, (_, i) => `<div class="c${i}"><span>항목 ${i}</span><a href="/${i}">링크</a></div>`).join('');
  const post = `<html><body>${filler}<div class="top_area"><span class="date">2026.11.04 10:00</span></div><article><div class="xe_content"><p>본문</p></div></article></body></html>`;
  const list = `<html><body>${filler}<table><tr><td class="title"><a href="/123">제목</a></td></tr></table></body></html>`;
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
