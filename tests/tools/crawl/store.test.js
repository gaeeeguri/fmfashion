import { test, expect } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../../../tools/crawl/store.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'fmf-'));
const post = (docId) => ({ docId, categoryId: '1', categoryName: '자유', title: 't', date: null, text: 'x', imgCount: 0, status: 200, fetchedAt: 1 });

test('appended posts are known after reopening', () => {
  const dir = tmp();
  const s = openStore(dir);
  s.appendPost(post('1'));
  s.appendPost(post('2'));
  const again = openStore(dir);
  expect([...again.doneIds].sort()).toEqual(['1', '2']);
  expect(again.postCount()).toBe(2);
});

test('a truncated last line is dropped and the file stays valid JSONL', () => {
  const dir = tmp();
  writeFileSync(join(dir, 'posts.jsonl'), `${JSON.stringify(post('1'))}\n${JSON.stringify(post('2'))}\n{"docId":"9`);
  const s = openStore(dir);
  expect(s.doneIds.size).toBe(2);
  expect(s.doneIds.has('9')).toBe(false);
  s.appendPost(post('3'));
  const lines = readFileSync(join(dir, 'posts.jsonl'), 'utf8').trim().split('\n');
  expect(lines.map((l) => JSON.parse(l).docId)).toEqual(['1', '2', '3']);
});

test('unrecognized posts are not marked done', () => {
  const s = openStore(tmp());
  s.appendUnrecognized({ docId: '5', status: 200, at: 1 });
  expect(s.doneIds.has('5')).toBe(false);
  expect(s.postCount()).toBe(0);
});

test('state round-trips through an atomic write', () => {
  const dir = tmp();
  const s = openStore(dir);
  const state = { sources: [{ category: null, nextPage: 3, lastPage: null }], sourceIndex: 0, queue: [], rateIndex: 0, recent429s: [], firedCheckpoints: [20000], stopReason: null, startedAt: 1, updatedAt: 2 };
  s.writeState(state);
  expect(openStore(dir).readState()).toEqual(state);
  expect(existsSync(join(dir, 'state.json.tmp'))).toBe(false);
});

test('readState is null on an empty dir', () => {
  expect(openStore(tmp()).readState()).toBeNull();
});

test('requests are appended as JSONL', () => {
  const dir = tmp();
  const s = openStore(dir);
  s.appendRequest({ t: 1, kind: 'list', status: 200, ms: 50 });
  s.appendRequest({ t: 2, kind: 'post', status: 'network', ms: 3 });
  const lines = readFileSync(join(dir, 'requests.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  expect(lines.map((l) => l.status)).toEqual([200, 'network']);
});
