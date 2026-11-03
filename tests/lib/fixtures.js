import { test } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';

// fmkorea page snapshots are kept out of the public repo (they contain other users' nicknames).
// Save them locally under tests/fixtures/ to run the fixture-based tests; otherwise those are skipped.
const DIR = 'tests/fixtures';
export const HAS_FIXTURES = ['board-list', 'search-result', 'search-empty', 'blocked-430'].every((f) => existsSync(`${DIR}/${f}.html`));
export const fixture = (name) => (HAS_FIXTURES ? readFileSync(`${DIR}/${name}`, 'utf8') : '');
export const ftest = HAS_FIXTURES ? test : test.skip;

// Optional: a fashion-board post page saved from Chrome (spec §11.3). Tests using it skip when absent.
export const HAS_DOC = HAS_FIXTURES && existsSync(`${DIR}/document.html`);
export const dtest = HAS_DOC ? test : test.skip;
