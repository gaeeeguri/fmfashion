#!/usr/bin/env node
// fmfashion brand-dictionary crawl. See tools/crawl/README.md.
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, openSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from './args.js';
import { openStore } from './store.js';
import { runCrawl } from './crawler.js';
import { openBridge } from './bridge.js';
import { parseList, classify } from './parse.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DATA = join(ROOT, 'data');
const CRAWL = join(DATA, 'crawl');
const REPORTS = join(DATA, 'reports');
const PY = join(ROOT, 'tools', 'lexicon', '.venv', 'bin', 'python');
const BUILD = join(ROOT, 'tools', 'lexicon', 'build.py');
const EXCLUDE = ['210029879', '209960683', '5263961399'];
const CHECKPOINTS = [20000, 50000, 100000];

mkdirSync(CRAWL, { recursive: true });
mkdirSync(REPORTS, { recursive: true });
const log = (msg) => {
  const line = `[${new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' })}] ${msg}`;
  console.log(line);
  appendFileSync(join(CRAWL, 'crawl.log'), `${line}\n`);
};

let args;
try {
  args = parseArgs(process.argv.slice(2), Date.now());
} catch (e) {
  console.error(e.message);
  process.exit(2);
}

function readSources() {
  const p = join(CRAWL, 'config.json');
  if (!existsSync(p)) return [{ category: null }];
  const cats = JSON.parse(readFileSync(p, 'utf8')).categories ?? [null];
  return cats.map((category) => ({ category }));
}

const reportJobs = [];
function startReport(label, n) {
  const out = openSync(join(REPORTS, `checkpoint-${label}.log`), 'a');
  if (!existsSync(PY)) {
    log(`checkpoint ${label}: python venv missing at ${PY} — report skipped`);
    return;
  }
  log(`checkpoint ${label}: building lexicon and report for ${n} posts (crawl continues)`);
  const child = spawn(PY, [BUILD, '--data', DATA, '--upto', String(n), '--label', String(label)], {
    cwd: ROOT,
    detached: true,
    stdio: ['ignore', out, out],
  });
  child.unref();
  reportJobs.push({
    label,
    done: new Promise((resolve) => child.once('close', (code) => resolve(code))),
  });
}

const browser = await openBridge({ log });
log('Arc의 펨코 패션 게시판 탭 콘솔에 tools/crawl/tab.js 내용을 붙여 넣으세요 (복사: pbcopy < tools/crawl/tab.js).');
log('Arc가 "로컬 네트워크 접근"을 물으면 허용하세요. 탭이 연결되면 시작합니다…');
await browser.waitForNetwork();

if (args.probeDepth) {
  const url = `/index.php?mid=fashion&page=${args.probeDepth}`;
  const res = await browser.fetchPage(url);
  const cls = classify(res);
  const parsed = cls === 'ok' ? parseList(res.html, EXCLUDE) : null;
  log(`probe ${url}: ${cls}${'status' in res ? ` (HTTP ${res.status})` : ''}${parsed ? ` · rows ${parsed.rows.length} · lastPage ${parsed.lastPage}` : ''}`);
  await browser.close();
  process.exit(0);
}

const opts = {
  sources: readSources(),
  excludeCategoryIds: EXCLUDE,
  target: args.target,
  deadline: args.deadline,
  runUntil: args.runUntil,
  checkpoints: CHECKPOINTS,
  refillBelow: 200,
  unrecognizedStreakLimit: 20,
  warmupMs: 300000, // first 5 min at 1/s
  interrupted: false,
};
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    if (opts.interrupted) process.exit(130);
    opts.interrupted = true;
    log(`${sig}: finishing in-flight requests and saving state (press again to force quit)`);
  });
}

const fmt = (t) => (t == null ? '없음' : new Date(t).toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }));
log('──────── fmfashion crawl ────────');
log(`속도 초당 2건 (처음 5분은 1건) · 목표 ${opts.target}개 · 마감 ${fmt(opts.deadline)} · 이번 실행 종료 ${fmt(opts.runUntil)}`);
log(`데이터 ${CRAWL} · 카테고리 순서 ${opts.sources.map((s) => s.category ?? '전체').join(' → ')}`);
log('밤사이 모니터 전원을 끄거나 케이블을 뽑지 마세요 (클램쉘 모드에서 맥이 잠듭니다).');

const result = await runCrawl({
  fetchPage: browser.fetchPage,
  waitForNetwork: browser.waitForNetwork,
  store: openStore(CRAWL),
  clock: { now: () => Date.now(), sleep: (ms) => new Promise((r) => setTimeout(r, ms)) },
  opts,
  onCheckpoint: startReport,
  log,
});
log(`종료: ${result.reason} · 누적 ${result.postCount}개`);
await browser.close().catch(() => {});

const last = reportJobs.filter((j) => j.label === 'final' || j.label === 'pilot');
if (last.length) {
  log('보고서 생성을 기다립니다 (최대 10분)…');
  await Promise.race([Promise.all(last.map((j) => j.done)), new Promise((r) => setTimeout(r, 600000))]);
  log(`보고서: ${REPORTS}`);
}
process.exit(0);
