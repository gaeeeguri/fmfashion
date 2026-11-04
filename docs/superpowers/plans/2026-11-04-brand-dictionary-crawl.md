# 브랜드 사전 Phase 2-A (본문 수집 + 단어 사전) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 펨코 패션 게시판 최근 글 본문을 초당 2건으로 밤새 이어받기 가능하게 수집하고, Kiwi 고유명사·영문 후보를 keyness로 정렬한 단어 사전과 점검 보고서를 자동으로 만든다.

**Architecture:** Node 수집기는 설치된 Chrome(Playwright, 전용 프로필)의 fmkorea 탭 안에서 `fetch`를 보내고, 그 결과를 `data/crawl/`의 JSONL에 덧붙이기만 한다. 핵심 루프(`runCrawl`)는 fetch, 시계, 저장소를 주입받아 브라우저 없이 테스트한다. 점검 시점이 되면 Python 단어 사전 빌더를 별도 프로세스로 띄우고 수집은 계속한다.

**Tech Stack:** Node 24 (ESM), vitest 5, jsdom 29 (기존), playwright (신규, `channel: 'chrome'`). Python 3.13, kiwipiepy, wordfreq, pytest (신규, `tools/lexicon/.venv`).

**Spec:** `docs/superpowers/specs/2026-11-04-brand-dictionary-crawl-design.md`

## Global Constraints

- 모든 펨코 요청(목록 + 본문)은 하나의 속도 제한을 함께 쓴다: 간격 `1000 / rate` ms, 시작 rate 2, 동시 처리 중 최대 4개.
- 429 → 새 요청 중지, 300000ms 쉬고 재개. 최근 3600000ms 안에 429가 3번이면 rate를 다음 단계로 내린다: 2 → 1.5 → 1.
- 430 또는 본문에 `에펨코리아 보안 시스템` → 즉시 종료, 재시도 없음.
- 본문 셀렉터 불일치 연속 20번 → 종료. 그런 글은 받음으로 표시하지 않는다.
- 네트워크 오류/20000ms 타임아웃은 거절로 세지 않는다. 2000ms → 최대 60000ms 지수 백오프로 기다린 뒤 같은 요청을 다시 보낸다.
- 공지 카테고리 id `210029879`, `209960683`, `5263961399`는 제외한다.
- 받을 글이 200개 미만이면 다음 목록 페이지를 받는다.
- 점검: 20000, 50000, 100000개 + 파일럿 종료(`--for`) + 마감 종료. 수집은 멈추지 않는다. 같은 점검은 재시작해도 두 번 하지 않는다.
- 마감: `2026-11-05T09:40:00+09:00` 또는 100000개 중 먼저 오는 쪽.
- 본문: `article .xe_content`, 작성 시각: `.top_area span.date`. 목록 행은 `src/lib/parser.js`의 `parseListHtml`을 재사용한다.
- 단어 사전: NFKC, URL 제거, 같은 글자 3번 이상 반복은 2번으로, 영문 소문자화. 후보 품사는 NNP / SL / NA / UN이고 2글자 이상. 공백 없이 연속한 NNG/NNP/SL/SN은 이어 붙인 형태도 후보. 등장 글 수 3 미만은 순위에서 제외.
- keyness = `log((df / N + alpha) / (general + beta))`. `general = max(wordfreq ko, wordfreq en)`, 기본값 `alpha = 0`, `beta = 1e-6`.
- `data/`, `fmf-*.json`, `tools/lexicon/.venv/`는 git에 넣지 않는다. 원격 GitHub 동작은 사용자에게 먼저 묻는다.

## Review Focus

1. 쓰는 도중 강제 종료로 `posts.jsonl` 마지막 줄이 잘림 → 재시작 때 그 줄을 버리고 그 글을 다시 받아야 한다 (Task 2 테스트).
2. 와이파이가 10분 넘게 끊김 → 429로 세지 않고, rate도 내리지 않고, 같은 글부터 이어야 한다 (Task 4 테스트).
3. 프로세스가 죽은 사이에 점검 기준을 넘긴 뒤 재시작 → 그 점검은 한 번만 실행되어야 한다. 이미 실행한 점검은 다시 하지 않는다 (Task 4 테스트).
4. 마감 시각에 요청이 처리 중 → 처리 중인 응답은 저장하고, 최종 점검은 정확히 한 번 실행되어야 한다 (Task 4 테스트).
5. 목록 요청이 429를 받음 → 본문 요청과 똑같이 멈추고 그 목록 페이지를 다시 받아야 한다 (Task 4 테스트).

---

## File Structure

```
tools/crawl/
  dom.js          Node에서 DOMParser 제공 (jsdom)
  parse.js        목록/본문/응답 분류 — 순수 함수
  store.js        data/crawl/ 파일 입출력 — 이어받기의 근거
  rateGate.js     속도 제한 + 429 정책
  crawler.js      runCrawl 핵심 루프 (브라우저 비의존)
  browser.js      Playwright Chrome, fetchPage, waitForNetwork
  main.js         CLI, 점검 프로세스 실행
  run.sh          caffeinate -dims 래퍼
tests/tools/crawl/*.test.js
tools/lexicon/
  requirements.txt
  normalize.py  candidates.py  score.py  build.py
  tests/test_*.py
```

---

### Task 1: 응답 파싱 (`parse.js`)

**Files:**
- Create: `tools/crawl/dom.js`, `tools/crawl/parse.js`
- Test: `tests/tools/crawl/parse.test.js`

**Interfaces:**
- Consumes: `parseListHtml(html) -> Row[]`, `isBlockedHtml(html)` from `src/lib/parser.js` (they use the global `DOMParser`)
- Produces:
  - `dom.js`: side-effect import that sets `globalThis.DOMParser` from jsdom if missing
  - `parseList(html: string, excludeCategoryIds: string[]) -> { rows: Array<{docId: string, title: string, categoryId: string|null, categoryName: string}>, lastPage: number|null }` — `docId` is a string; `lastPage` comes from `form.bd_pg[data-last-page]`
  - `parsePost(html: string) -> { text: string, imgCount: number, date: string|null } | null` — null when `article .xe_content` is missing
  - `classify(res: {status:number, html:string} | {error:'network'|'timeout'}) -> 'ok' | 'rate-limited' | 'blocked' | 'network' | 'http-error'` — 429 → rate-limited, 430 or `isBlockedHtml` → blocked, 200 → ok, other statuses → http-error

- [ ] **Step 1: Write the failing tests**

  These are inline HTML tests that always run:
  - `parsePost` on `<div class="top_area"><span class="date">2026.11.03 13:24</span></div><article><div class="xe_content"><p>파프터는 비싸고....</p><p></p><p>흠<br>안사면</p><img src=x></div></article>` → `{ text: '파프터는 비싸고....\n흠\n안사면', imgCount: 1, date: '2026.11.03 13:24' }`. Text rules: `<br>` and the end of `p/div/li` become `\n`; `[ \t ]+` → one space; blank lines are collapsed; trim.
  - `parsePost('<html><body>로그인</body></html>')` → `null`
  - `parseList` drops a row whose category link has `category=210029879` when that id is in excludeIds
  - `classify({status:429, html:''})` → `'rate-limited'`; `classify({status:430, html:''})` → `'blocked'`; `classify({status:200, html:'…에펨코리아 보안 시스템…'})` → `'blocked'`; `classify({error:'timeout'})` → `'network'`; `classify({status:404, html:''})` → `'http-error'`

  These are fixture tests (`ftest`/`dtest` from `tests/lib/fixtures.js`, skipped when the fixture is absent):
  - `parseList(board-list.html, ['210029879','209960683','5263961399']).rows.length` is 20 and every `docId` matches `/^\d+$/`
  - `parsePost(document.html)` → text `'파프터는 비싸고....\n흠 안사면 공짜인가'`, date `'2026.11.03 13:24'`

- [ ] **Step 2: Run, expect failure** — `npx vitest run tests/tools/crawl/parse.test.js` → FAIL (module not found)
- [ ] **Step 3: Implement `dom.js` and `parse.js`**
- [ ] **Step 4: Run, expect pass** — same command → PASS. Also run `npm test` and confirm the existing tests still pass.
- [ ] **Step 5: Commit** — `git add tools/crawl tests/tools && git commit -m "feat(crawl): parse list, post body and response class"`

---

### Task 2: 저장소와 이어받기 (`store.js`)

**Files:**
- Create: `tools/crawl/store.js`
- Test: `tests/tools/crawl/store.test.js` (use a temp dir from `fs.mkdtempSync(os.tmpdir() + '/fmf-')`)

**Interfaces:**
- Produces: `openStore(dir: string) -> Store`
  - `Store.doneIds: Set<string>` — docIds from `posts.jsonl`, rebuilt on open
  - `Store.postCount(): number` — the number of records in `posts.jsonl`
  - `Store.appendPost(rec: PostRecord): void` — appends one JSON line synchronously (`fs.appendFileSync`) and adds the id to `doneIds`
  - `Store.appendUnrecognized(rec: {docId, status, at}): void` → `unrecognized.jsonl`. It does **not** add the id to `doneIds`.
  - `Store.appendRequest(rec: {t: number, kind: 'list'|'post', status: number|string, ms: number}): void` → `requests.jsonl`
  - `Store.readState(): State | null`, `Store.writeState(s: State): void` — write `state.json.tmp`, then `renameSync`
  - `PostRecord = { docId, categoryId, categoryName, title, date, text, imgCount, status, fetchedAt, unrecognized?: true }`
  - `State = { sources: Array<{category: string|null, nextPage: number, lastPage: number|null}>, sourceIndex: number, queue: Row[], rateIndex: number, recent429s: number[], firedCheckpoints: Array<number|string>, stopReason: string|null, startedAt: number, updatedAt: number }`

- [ ] **Step 1: Write the failing tests**
  - Append 2 posts, then reopen → `doneIds` has both and `postCount()` is 2
  - **Truncated last line:** write 2 valid lines plus `'{"docId":"9'` (no newline). On open, `doneIds.size === 2`, and the file is rewritten without the broken tail, so the next append produces valid JSONL (check that every line passes `JSON.parse`).
  - `appendUnrecognized` → `doneIds` does not contain that id
  - `writeState` then `readState` round-trips; no `state.json.tmp` is left behind
  - `readState()` on an empty dir → `null`
- [ ] **Step 2: Run, expect failure** — `npx vitest run tests/tools/crawl/store.test.js`
- [ ] **Step 3: Implement `openStore`** — on open, create the dir with `mkdirSync({recursive:true})`. If the file does not end with `\n`, cut it back to the last `\n`.
- [ ] **Step 4: Run, expect pass**
- [ ] **Step 5: Commit** — `feat(crawl): append-only post store with truncated-tail recovery`

---

### Task 3: 속도 제한과 429 정책 (`rateGate.js`)

**Files:**
- Create: `tools/crawl/rateGate.js`
- Test: `tests/tools/crawl/rateGate.test.js` (fake clock: `now` is a number variable, and `sleep(ms)` advances it and resolves)

**Interfaces:**
- Produces: `createRateGate({ rates = [2, 1.5, 1], maxInFlight = 4, pauseMs = 300000, windowMs = 3600000, threshold = 3, clock: {now, sleep}, initial?: {rateIndex, recent429s} }) -> Gate`
  - `Gate.acquire(): Promise<void>` — resolves when there is a free slot, no pause is active, and at least `1000 / rate` ms have passed since the previous acquire's start time
  - `Gate.release(): void`
  - `Gate.on429(): { pausedUntil: number, rate: number, lowered: boolean }` — starts or extends the pause to `now + pauseMs`, records `now` in `recent429s`, and drops entries older than `windowMs`. If `recent429s.length >= threshold` and a lower rate exists, it moves to the next rate and clears `recent429s`.
  - `Gate.rate: number`, `Gate.snapshot(): {rateIndex, recent429s}`

- [ ] **Step 1: Write the failing tests**
  - 5 acquire/release cycles at rate 2 → start times are `0, 500, 1000, 1500, 2000`
  - With `maxInFlight` 4 and nothing released, the 5th `acquire` is still pending after the clock moves forward
  - `on429()` at t=0 → the next `acquire` resolves at t ≥ 300000
  - Three `on429()` calls within one hour → `rate === 1.5` and `lowered === true` on the third. Three more → `1`. Three more → it stays `1`.
  - Three `on429()` calls spread more than one hour apart → the rate stays `2`
  - `initial: {rateIndex: 1, recent429s: []}` → `rate === 1.5`
- [ ] **Step 2: Run, expect failure**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run, expect pass**
- [ ] **Step 5: Commit** — `feat(crawl): shared rate gate with 429 pause and step-down`

---

### Task 4: 수집 루프 (`crawler.js`)

**Files:**
- Create: `tools/crawl/crawler.js`
- Test: `tests/tools/crawl/crawler.test.js` (fake `fetchPage` serving scripted responses by URL, the fake clock from Task 3, and a real `openStore` on a temp dir)

**Interfaces:**
- Consumes: `parseList`, `parsePost`, `classify` (Task 1), `openStore` (Task 2), `createRateGate` (Task 3)
- Produces:
  ```
  runCrawl({
    fetchPage: (url: string) => Promise<{status, html} | {error: 'network'|'timeout'}>,
    waitForNetwork: () => Promise<void>,
    store: Store,
    clock: { now, sleep },
    opts: { sources: Array<{category: string|null}>, excludeCategoryIds: string[], target: number,
            deadline: number|null, runUntil: number|null, checkpoints: number[], refillBelow: number,
            unrecognizedStreakLimit: number },
    onCheckpoint: (label: number|string, postCount: number) => void,
    log: (msg: string) => void,
  }) -> Promise<{ reason: 'target'|'deadline'|'for'|'blocked'|'unrecognized-streak'|'exhausted', postCount: number }>
  ```
  - List URL: `/index.php?mid=fashion&page=N`, plus `&category=<id>` when the source has a category. Post URL: `/<docId>`.
  - Fresh state: `sources` from opts with `nextPage: 1`. If `state.json` exists, continue from it, but always take `sources` order from opts (the user may change priority after the pilot). Match sources by `category`.
  - Refill: while `queue.length < refillBelow` and the current source has pages left (`lastPage == null || nextPage <= lastPage`), fetch a list page and push rows whose docId is not in `doneIds` and not already queued. When a source runs out, move to the next. If every source is out and the queue is empty → `'exhausted'`.
  - Every request goes through `gate.acquire()`/`release()`. Every response is recorded with `store.appendRequest`.
  - `network` → `await waitForNetwork()`, then retry the same URL. This does not touch the gate's 429 state.
  - `rate-limited` → `gate.on429()` and retry the same URL after the pause. Log when `lowered`.
  - `blocked` → finish in-flight work, save state, stop with `'blocked'`.
  - Post `ok` but `parsePost` is null → `appendUnrecognized`, streak + 1. At `unrecognizedStreakLimit` (20) → stop with `'unrecognized-streak'`. Post `ok` with a body → `appendPost`, streak = 0. `http-error` on a post → `appendPost` with `unrecognized: true` and that status, streak unchanged.
  - Checkpoints: after each append, for each `n` in `checkpoints`, if `postCount() >= n` and `n` is not in `firedCheckpoints`, push it, write state, then call `onCheckpoint(n, count)`. On stop: `'for'` → `onCheckpoint('pilot', count)`. `'deadline'`, `'target'`, `'blocked'` and `'unrecognized-streak'` → `onCheckpoint('final', count)`. If 100000 was already fired as a numeric checkpoint, `'target'` does not call `'final'` again.
  - Stop checks run before each new request: `postCount() >= target` → `'target'`; `now >= deadline` → `'deadline'`; `now >= runUntil` → `'for'`. In-flight requests finish and are saved before returning.
  - Write state after every request. The state holds the gate snapshot and `stopReason`.

- [ ] **Step 1: Write the failing tests** (one `it` each)
  - Happy path: list page 1 has 3 rows, page 2 has 0 rows with lastPage 1 → 3 posts stored, then `'exhausted'`
  - Dedupe: a row already in `posts.jsonl` before start is never fetched (check the fetch call log)
  - Resume: run, stop with `runUntil` after 2 posts, then rerun with a fresh store handle on the same dir → total 3 posts, no post URL fetched twice
  - **Review Focus 2:** a post fetch returns `{error:'network'}` twice and then ok → `waitForNetwork` is called twice, the post is stored, and `gate.rate` is still 2
  - **Review Focus 5:** a list fetch returns 429 once → nothing is requested for 300000ms of fake time, then the same list URL is requested again
  - 430 on a post → `'blocked'`; the state's `stopReason` is `'blocked'`; `onCheckpoint('final', n)` is called once
  - 20 consecutive ok-without-body → `'unrecognized-streak'`; `unrecognized.jsonl` has 20 lines; on rerun, those docIds are fetched again
  - 404 on a post → stored with `unrecognized: true` and status 404, the streak is not increased, and it is not fetched again on rerun
  - **Review Focus 3:** `checkpoints: [2]` with 2 posts already stored and `firedCheckpoints: []` → `onCheckpoint(2, …)` is called once at start-up. Rerun → it is not called again.
  - **Review Focus 4:** `deadline` falls while 2 requests are in flight → both are saved, the reason is `'deadline'`, and `'final'` is called exactly once
  - `target: 3` → stops at 3 with reason `'target'`
- [ ] **Step 2: Run, expect failure** — `npx vitest run tests/tools/crawl/crawler.test.js`
- [ ] **Step 3: Implement `runCrawl`**
- [ ] **Step 4: Run, expect pass** — plus `npm test`
- [ ] **Step 5: Commit** — `feat(crawl): resumable crawl loop with checkpoints and stop rules`

---

### Task 5: 브라우저 연결, CLI, 실행 래퍼

**Files:**
- Create: `tools/crawl/browser.js`, `tools/crawl/main.js`, `tools/crawl/run.sh`, `tools/crawl/README.md`
- Modify: `package.json` (add devDependency `playwright`, script `"crawl": "tools/crawl/run.sh"`)

**Interfaces:**
- Consumes: `runCrawl` (Task 4), `openStore` (Task 2)
- Produces:
  - `openBrowser({ profileDir }) -> Promise<{ fetchPage, waitForNetwork, close }>`:
    - Uses `chromium.launchPersistentContext(profileDir, { channel: 'chrome', headless: false })` and navigates to `https://www.fmkorea.com/fashion`.
    - `fetchPage` runs `page.evaluate` with `fetch(url, {credentials:'include', cache:'no-store'})` and an `AbortController` with a 20000ms timeout. It returns `{status, html}`, or `{error}` on `TypeError` or abort. If `page.evaluate` itself throws (page crashed or navigated), it reloads the page once and returns `{error:'network'}`.
    - `waitForNetwork` checks a TCP connection to `www.fmkorea.com:443` with `node:net` (no HTTP request), backing off 2000ms ×2 up to 60000ms until it connects.
  - CLI: `node tools/crawl/main.js [--for 1h] [--until 2026-11-05T09:40:00+09:00] [--target 100000] [--probe-depth 5000]`
    - Data dir: `data/crawl`. Profile: `data/chrome-profile`. Optional `data/crawl/config.json` `{ "categories": [null] | ["<id>", …] }` sets the source order. The default is `[null]` (the whole board).
    - Checkpoints: `[20000, 50000, 100000]`.
    - `onCheckpoint(label, n)` spawns, detached, `tools/lexicon/.venv/bin/python tools/lexicon/build.py --data data --upto <n> --label <label>` with stdout/stderr going to `data/reports/checkpoint-<label>.log`, then calls `unref()`. On `'final'`/`'pilot'` it waits for that child to exit before the process exits (child `close` event, 10 min cap).
    - `--probe-depth N`: fetch one list page N, print the row count and `lastPage`, and exit without touching the state.
    - Start-up banner (Korean): rate, deadline, data dir, and "밤사이 모니터 전원을 끄거나 케이블을 뽑지 마세요". A one-line progress log every 100 posts: count, rate, queue size, elapsed time.
    - Handle SIGINT/SIGTERM: stop issuing requests, save state, exit 0. A rerun resumes.
  - `run.sh`: `exec caffeinate -dims node tools/crawl/main.js "$@"`
  - README: tmux steps (`tmux new -s fmf`, `npm run crawl -- --for 1h`, detach `Ctrl-b d`, `tmux attach -t fmf`), the clamshell warning, and data locations

- [ ] **Step 1: Install** — `npm i -D playwright`. No browser download is needed: `channel:'chrome'` uses the installed Google Chrome. Verify with `ls "/Applications/Google Chrome.app"`.
- [ ] **Step 2: Implement `browser.js`, `main.js`, `run.sh` (chmod +x), README**
- [ ] **Step 3: Manual check (needs the user, network)** — `npm run crawl -- --probe-depth 1`. A Chrome window opens on the fashion board, and the output shows about 20 rows and a numeric `lastPage`. If fmkorea shows a login or security page in that window, the user resolves it there, then reruns.
- [ ] **Step 4: Run `npm test`** → all pass
- [ ] **Step 5: Commit** — `feat(crawl): playwright chrome runner, CLI and caffeinate wrapper`

---

### Task 6: 단어 사전 핵심 (Python)

**Files:**
- Create: `tools/lexicon/requirements.txt` (`kiwipiepy`, `wordfreq`, `pytest`), `tools/lexicon/normalize.py`, `tools/lexicon/candidates.py`, `tools/lexicon/score.py`, `tools/lexicon/tests/test_core.py`
- Modify: `.gitignore` (add `tools/lexicon/.venv/`)

**Interfaces:**
- Produces:
  - `normalize(text: str) -> str`
  - `candidates(kiwi: Kiwi, text: str) -> list[tuple[str, str]]` — `(form, tag)` pairs. Tags: `NNP`, `SL`, `NA`, `UN`, and `JOIN` for joined runs. `len(form) >= 2`. Joined runs: consecutive tokens in `{NNG, NNP, SL, SN}` where `next.start == prev.start + prev.len` (no gap in the normalized text), with 2+ tokens joined into one `JOIN` candidate.
  - `keyness(df: int, n_docs: int, word: str, alpha: float = 0.0, beta: float = 1e-6) -> float` with `general = max(word_frequency(word,'ko'), word_frequency(word,'en'))`

- [ ] **Step 1: Set up venv** — `python3 -m venv tools/lexicon/.venv && tools/lexicon/.venv/bin/pip install -r tools/lexicon/requirements.txt`
- [ ] **Step 2: Write the failing tests**
  - `normalize('ＳＥＷ 후기 ㅋㅋㅋㅋ 스웨에에에엑 https://a.b/c')` → `'sew 후기 ㅋㅋ 스웨에에엑'` (에×3 → 에×2), with trailing whitespace trimmed and spaces collapsed
  - `('블랙야크', 'JOIN') in candidates(kiwi, '코오롱이나 블랙야크 아이더')`
  - `('k2', 'JOIN') in candidates(kiwi, 'k2 콜롬비아')`
  - `('얼저고', …)` appears with some tag in `candidates(kiwi, '얼저고 코트 샀어')`
  - No candidate has `len(form) < 2`
  - `keyness(30, 1000, '서울') < keyness(30, 1000, '얼저고')` (a common general word scores lower than unseen slang at the same df)
- [ ] **Step 3: Run, expect failure** — `tools/lexicon/.venv/bin/python -m pytest tools/lexicon/tests -q`
- [ ] **Step 4: Implement**
- [ ] **Step 5: Run, expect pass**
- [ ] **Step 6: Commit** — `feat(lexicon): normalize, Kiwi candidates with joined runs, keyness`

---

### Task 7: 사전 빌드와 점검 보고서 (`build.py`)

**Files:**
- Create: `tools/lexicon/build.py`, `tools/lexicon/tests/test_build.py`

**Interfaces:**
- Consumes: Task 6 functions; files from Task 2 (`posts.jsonl`, `requests.jsonl`, `state.json`); `dictionary/brands.json`
- Produces: `python tools/lexicon/build.py --data <dir> --upto <n> --label <label> [--alpha 0] [--beta 1e-6]`
  - Reads the first `n` records of `<data>/crawl/posts.jsonl`, skipping `unrecognized`.
  - Writes `<data>/lexicon/lexicon-<label>.json`: a list sorted by keyness desc, each item `{form, tags: [..], count, df, keyness, byCategory: {name: df}, examples: [≤3 strings, ±20 chars]}`. Items with `df < 3` or in `<data>/lexicon/stop.txt` are omitted.
  - Writes `<data>/reports/checkpoint-<label>.md` with these Korean sections:
    1. **수집:** posts, elapsed, actual posts/s; counts of 429 / blocked / network / timeout / http-error from `requests.jsonl`; median and p95 ms per clock hour; unrecognized rate; share of posts under 10 chars; `stopReason` if set
    2. **상위 후보 100:** form, df, keyness, top category
    3. **알려진 브랜드 재현율:** known terms = every `searchTerms` entry in `brands.json` + lines of `<data>/lexicon/known.txt` (if present), normalized with `normalize`; the share found among the top 500 forms; list the misses
    4. **안정성:** the share of the top 200 shared with the previous lexicon file (the newest `lexicon-*.json` other than this one, by mtime); "이전 없음" if none
    5. **카테고리별 글당 후보 언급 수:** per category, (sum over its posts of distinct top-500 forms present) / posts

- [ ] **Step 1: Write the failing test** — build a temp `data/` with 6 posts (3 mention `얼저고`, 3 mention `블랙야크`, one category each), a 3-line `requests.jsonl` including one 429, and a `state.json` → run `main(['--data', tmp, '--upto', '6', '--label', 't'])`. Assert:
  - The lexicon file exists and has items for `얼저고` and `블랙야크` with `df == 3`
  - The report contains `429` with count 1, and contains `이전 없음`
  - A `known.txt` with `얼저고` → the recall section lists it as found
- [ ] **Step 2: Run, expect failure**
- [ ] **Step 3: Implement `build.py`** with a `main(argv)` entry point
- [ ] **Step 4: Run, expect pass**
- [ ] **Step 5: Smoke test on real data** — convert `fmf-ramp-2026-11-04T051233.json` into a temp `data/crawl/posts.jsonl` (results + docs fields) and run with `--upto 518`. The report is generated and the top 100 contains several of 아셀/킨치/모모타로/얼저고/무탠.
- [ ] **Step 6: Commit** — `feat(lexicon): lexicon builder and checkpoint report`

---

### Task 8: 파일럿과 밤샘 실행 (운영, 사용자와 함께)

No new code. Each step's result goes back to the user.

- [ ] **Step 1: Depth check** — `npm run crawl -- --probe-depth 5000`. If there are rows → proceed. If there are 0 rows → report `lastPage` to the user and stop to re-plan the order (the spec §4.3 alternatives).
- [ ] **Step 2: Pilot** — in tmux: `npm run crawl -- --for 1h --until 2026-11-05T09:40:00+09:00 --target 100000`. During the pilot, ask the user to toggle wifi off for about 30s once. Then confirm that the log shows a wait and a resume, and that `requests.jsonl` has a network entry and no 429.
- [ ] **Step 3: Review the pilot** — read `data/reports/checkpoint-pilot.md`. Draft `data/lexicon/known.txt` (brands among the top candidates) and `data/lexicon/stop.txt` (general proper nouns such as 서울, 일본). Propose a category order in `data/crawl/config.json` from section 5. Get the user's OK.
- [ ] **Step 4: Overnight** — rerun the same command in tmux and confirm that the progress lines continue from the pilot count.
- [ ] **Step 5: Morning** — after 09:40, read `checkpoint-final.md` and summarize it for the user.
