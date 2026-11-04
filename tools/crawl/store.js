// Append-only crawl store. posts.jsonl is the source of truth for "already fetched" (rsync-style resume).
import { mkdirSync, existsSync, readFileSync, appendFileSync, writeFileSync, renameSync, truncateSync } from 'node:fs';
import { join } from 'node:path';

/**
 * @typedef {{ docId: string, categoryId: string|null, categoryName: string, title: string, date: string|null,
 *   text: string, imgCount: number, status: number, fetchedAt: number, unrecognized?: true }} PostRecord
 * @typedef {{ sources: Array<{category: string|null, nextPage: number, lastPage: number|null}>, sourceIndex: number,
 *   queue: Array<{docId: string, title: string, categoryId: string|null, categoryName: string}>, rateIndex: number,
 *   recent429s: number[], firedCheckpoints: Array<number|string>, stopReason: string|null, startedAt: number,
 *   updatedAt: number }} State
 */

/** Cut a file back to its last newline, so a line half-written by a killed process disappears. */
function dropTruncatedTail(path) {
  if (!existsSync(path)) return '';
  const text = readFileSync(path, 'utf8');
  if (text === '' || text.endsWith('\n')) return text;
  const keep = text.slice(0, text.lastIndexOf('\n') + 1);
  truncateSync(path, Buffer.byteLength(keep));
  return keep;
}

/** @param {string} dir */
export function openStore(dir) {
  mkdirSync(dir, { recursive: true });
  const postsPath = join(dir, 'posts.jsonl');
  const statePath = join(dir, 'state.json');
  const doneIds = new Set();
  let count = 0;
  for (const line of dropTruncatedTail(postsPath).split('\n')) {
    if (!line) continue;
    doneIds.add(JSON.parse(line).docId);
    count++;
  }
  dropTruncatedTail(join(dir, 'requests.jsonl'));
  dropTruncatedTail(join(dir, 'unrecognized.jsonl'));
  const append = (name, rec) => appendFileSync(join(dir, name), `${JSON.stringify(rec)}\n`);

  return {
    doneIds,
    postCount: () => count,
    /** @param {PostRecord} rec */
    appendPost(rec) {
      append('posts.jsonl', rec);
      doneIds.add(rec.docId);
      count++;
    },
    appendUnrecognized: (rec) => append('unrecognized.jsonl', rec),
    appendRequest: (rec) => append('requests.jsonl', rec),
    /** @returns {State|null} */
    readState: () => (existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : null),
    /** @param {State} s */
    writeState(s) {
      writeFileSync(`${statePath}.tmp`, JSON.stringify(s));
      renameSync(`${statePath}.tmp`, statePath);
    },
  };
}
