# In-page Results (v1.1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show merged brand results inside the fmkorea fashion board's own list table (no extension results page). Searches run in parallel from the content script, paced by a client-side token bucket, with no cache.

**Architecture:** The popup navigates the current fmkorea tab (or a new tab) to `https://www.fmkorea.com/fashion#fmf=…`. The content script parses that hash and drives a `searchSession`. The session builds jobs (`query.js`), runs them in parallel through `runner.js`, and each request first takes a token from `tokenBucket.js`. Results merge in `merge.js`, and `resultView.js` puts fmkorea's original `<tr>` elements into the page's `table.bd_lst`. The results page, `politeFetch`, `resultsController` and the session-storage cache are deleted.

**Tech Stack:** Chrome MV3, plain JS + JSDoc, esbuild IIFE bundles, Vitest 5 + jsdom.

**Spec:** `docs/superpowers/specs/2026-11-02-fmfashion-brand-filter-design.md` — v1.1, sections §3, §4.2, §4.3, §5, §7, §8 and §10.

## Global Constraints

- Token bucket: capacity **15**, refill **2 tokens/s**, one per page (tab). Every fmkorea request (first run, "더 보기", retries) takes one token.
- 429 retry delays: **1000 → 2000 → 4000 ms**. After 3 retries the alias is left as "남은 별명".
- 430 or `에펨코리아 보안 시스템` in the HTML → abort every in-flight request of the run.
- At most **30** aliases per click or "더 보기" (`maxRequests: 30`).
- No cache: nothing about results goes into `chrome.storage`.
- Category filtering is client-side via `td.cate` category IDs. `search.php` `category=` is ignored by fmkorea, so never send it.
- Permissions stay `storage` and `alarms`, plus hosts `https://www.fmkorea.com/*` and `https://raw.githubusercontent.com/*`. No `tabs` permission.
- Requests come only from the content script (same origin, `credentials: 'include'`).
- Copy (Korean, exact):
  - `브랜드 모아보기`, `취소`, `원래 목록으로`, `더 보기`, `이어서 검색`, `끝`
  - `검색 중 {done}/{total}`
  - `조건에 맞는 글이 없어요`
  - `펨코가 잠시 요청을 제한했어요`
  - `펨코 보안 확인이 필요해요. 새로고침 후 다시 시도해 주세요`
  - `펨코 화면 구조가 바뀐 것 같아요`
  - `별명 {total}개 중 {n}개만 검색`
- Fixture-based tests use `ftest` from `tests/lib/fixtures.js`. Fixtures stay out of git.

## Review Focus

1. **Run overlap:** removing a brand chip, or the hash changing, while a run is in flight. The old run's late responses must never appear, and its requests must be aborted. *Task 4 test "new start ignores late results of previous run".*
2. **Partial throttling:** a mix of 200s and 429s in one run should produce partial results, and the button should read `이어서 검색`. Only the throttled aliases are refetched, at the same page. *Task 4 test "limited job → 이어서 검색, more() refetches only it".*
3. **"원래 목록으로" restore:** after leaving result mode, the original page must look untouched. Hidden rows, pagination and the hiding bar are back, and no injected rows remain. *Task 5 test "destroy restores the original page".*
4. **Search page with zero results:** starting result mode from a search page that has no `table.bd_lst` must still render results. *Task 5 test "creates a table when the page has none".*
5. **Exhausted aliases:** once every alias has reached `data-last-page`, `더 보기` must disappear (show `끝`) and make no requests. *Task 4 test "more() stops at data-last-page".*

---

### Task 1: Token bucket

**Files:**
- Create: `src/lib/tokenBucket.js`
- Test: `tests/lib/tokenBucket.test.js`

**Interfaces:**
- Produces: `createTokenBucket({ capacity = 15, refillPerSec = 2, now = Date.now, sleep = (ms, signal) => Promise<void> }) → { take(signal?: AbortSignal): Promise<void> }`.
  - Waiters are served FIFO.
  - An aborted `take` rejects with a `DOMException` named `AbortError` and consumes no token.

- [ ] **Step 1: Write the failing tests** (fake clock: `let t = 0; const now = () => t; const sleeps = []; const sleep = async (ms) => { sleeps.push(ms); t += ms; };`)
  - `first 15 takes resolve without sleeping`: await 15 × `take()` → `sleeps` is `[]`.
  - `16th take waits 500ms`: after 15 takes, `take()` → `sleeps` equals `[500]`.
  - `refills up to capacity only`: after 15 takes, `t += 60_000` → 15 more takes with no sleep, and the 16th sleeps 500.
  - `concurrent waiters are served in order`: after 15 takes, start `take()` A and B without awaiting, then record their resolve order → `['A','B']` and total slept `1000`.
  - `aborted take rejects and does not consume`: with 0 tokens left, `take(abortedSignal)` rejects `{ name: 'AbortError' }`. Then `t += 500` → the next `take()` resolves with no sleep.
- [ ] **Step 2: Run** `npx vitest run tests/lib/tokenBucket.test.js`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** `createTokenBucket`. Use a lazy refill: `tokens = min(capacity, tokens + elapsedSec * refillPerSec)`. Chain waiters on a promise tail so they are FIFO. A waiter sleeps `ceil((1 - tokens) / refillPerSec * 1000)` and then re-checks.
- [ ] **Step 4: Run** the same command. Expected: PASS (5).
- [ ] **Step 5: Commit** `feat(lib): token bucket for fmkorea requests`.

### Task 2: Search-page parsing with rows, elements and last page

**Files:**
- Modify: `src/lib/parser.js`
- Test: `tests/lib/parser.test.js`

**Interfaces:**
- Consumes: the existing `parseListDocument`, `isBlockedHtml` and `hasListTable`.
- Produces: `parseSearchPage(html: string) → { kind: 'ok', items: Array<{ row: Row, tr: HTMLTableRowElement }>, lastPage: number } | { kind: 'blocked' } | { kind: 'unrecognized' }`.
  - `lastPage` comes from `form.bd_pg[data-last-page]`, defaulting to `1` when absent or invalid.
  - The `tr` elements belong to a `DOMParser` document; the view imports them.

- [ ] **Step 1: Write the failing tests** (`ftest`)
  - `parseSearchPage ok`: `search-result.html` → `kind 'ok'`, `items.length 20`, `lastPage 2`, `items[0].tr.tagName === 'TR'`.
  - `parseSearchPage empty`: `search-empty.html` → `{ kind: 'ok', items: [], lastPage: 1 }`.
  - `parseSearchPage blocked`: `blocked-430.html` → `{ kind: 'blocked' }`.
  - `parseSearchPage unrecognized`: `'<html><body>x</body></html>'` → `{ kind: 'unrecognized' }`.
- [ ] **Step 2: Run** `npx vitest run tests/lib/parser.test.js`. Expected: the 4 new tests FAIL.
- [ ] **Step 3: Implement** `parseSearchPage` in `parser.js`. It reuses `parseListDocument` on one parsed document.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(parser): parseSearchPage with elements and last page`.

### Task 3: Parallel runner with retry and block abort

**Files:**
- Rewrite: `src/lib/runner.js`
- Rewrite: `tests/lib/runner.test.js`. Delete the sequential and jitter tests; keep `abortableSleep` and its tests if present.

**Interfaces:**
- Consumes: `parseSearchPage` (Task 2), `buildSearchUrl(keyword, page)` (query.js; callers no longer pass `categoryId`), `take` (Task 1).
- Produces:

```js
/** @typedef {import('./query.js').SearchJob & { page: number, index: number }} RunJob */
runSearch({
  jobs: RunJob[], fetchPage, take: (signal) => Promise<void>,
  sleep = abortableSleep, retryDelays = [1000, 2000, 4000], signal,
  onResult: (job: RunJob, page: { items, lastPage }) => void,
}) → Promise<{ status: 'done' | 'blocked' | 'cancelled',
              failed: Array<{ job: RunJob, reason: 'limited' | 'error' | 'unrecognized' }> }>
```

- All jobs start at once. Each request (including retries) awaits `take(signal)` first.
- An internal `AbortController` linked to `signal` aborts everything on block or cancel.
- `status: 'cancelled'` only when the external `signal` aborted. On `blocked`, jobs that never finished are not listed in `failed`; the session treats every job without an `onResult` as unfinished.

- [ ] **Step 1: Write the failing tests** (`ftest`; take = `async () => { takes++; }`, sleep records ms)
  - `runs all jobs in parallel`: 4 jobs, and the fake fetch holds each request for one tick → max in-flight is `4`, and `onResult` is called 4 times with `lastPage 2`.
  - `takes a token per request`: 4 jobs → `takes === 4`.
  - `retries 429 with backoff then succeeds`: job 0 responses `[429, 429, 200]` → sleeps `[1000, 2000]`, `takes === 6`, `status 'done'`, `failed []`.
  - `gives up after 3 retries`: job 0 always gets 429 → sleeps contain `1000, 2000, 4000`, `failed` equals `[{ job: jobs[0], reason: 'limited' }]`, the other 3 get results, `status 'done'`.
  - `430 aborts the run`: job 1 returns 430 while the others are pending until aborted → `status 'blocked'`, and the pending fetches saw `signal.aborted === true`.
  - `blocked marker html counts as blocked`: `{status:200, html: BLOCKED}` → `'blocked'`.
  - `unrecognized page fails only that job`: job 2 gets `'<html></html>'` → `failed` has `reason 'unrecognized'`, and the others succeed.
  - `network error fails only that job`: the fetch throws for job 3 → `reason 'error'`.
  - `external abort → cancelled`.
- [ ] **Step 2: Run** `npx vitest run tests/lib/runner.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** `runSearch` as specified.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(runner): parallel search with token bucket, 429 backoff, block abort`.

### Task 4: Search session (replaces resultsController, no cache)

**Files:**
- Create: `src/lib/searchSession.js`
- Test: `tests/lib/searchSession.test.js`
- Delete: `src/lib/resultsController.js`, `tests/lib/resultsController.test.js`, `src/lib/politeFetch.js`, `tests/lib/politeFetch.test.js`
- Modify: `src/lib/query.js` (`maxRequests` default `12` → `30`) and the related assertion in `tests/lib/query.test.js`.

**Interfaces:**
- Consumes: `buildSearchJobs` (query.js), `runSearch` (Task 3), `filterRows` and `mergeRows` (merge.js). Rows passed to merge carry the extra field `tr`, which `mergeRows` keeps via the spread.
- Produces:

```js
createSearchSession({ dict, matchers, fetchPage, take, sleep?, onChange }) → {
  state: SessionState,
  start(sel: { brandIds: string[], categoryKey: string, hiddenBrandIds: string[] }): Promise<void>,
  more(): Promise<void>,   // no-op while running or when moreLabel is null
  cancel(): void,
  get category(): Category,
}
/** SessionState = {
 *   status: 'idle'|'empty'|'running'|'done'|'blocked'|'cancelled',
 *   rows: Array<ResultRow & { tr: HTMLTableRowElement }>,
 *   progress: { done: number, total: number } | null,
 *   totalTerms: number, jobCount: number,
 *   notice: null | 'limited' | 'unrecognized' | 'error',
 *   moreLabel: '더 보기' | '이어서 검색' | null,
 *   finished: boolean,   // every job reached its lastPage
 * } */
```

- Per job it tracks `fetchedPage` (0 = none) and `lastPage` (Infinity until known).
- **"이어서 검색"** is the label after `blocked`, `cancelled`, or any `failed` entry. `more()` then refetches the unfinished jobs at `fetchedPage + 1`.
- **"더 보기"** is the label otherwise, when some job has `fetchedPage < lastPage`. `more()` then fetches those at `fetchedPage + 1`.
- When neither applies, the label is `null` and `finished` is `true`.
- `notice` comes from the first failure reason in the last run: `limited` beats `unrecognized`, which beats `error`.
- Starting a new run aborts the old one and bumps a token, so the old run's callbacks are ignored. `category` is set synchronously in `start`.

- [ ] **Step 1: Write the failing tests** (`ftest`, bundled dictionary, fake fetch serving `search-result.html` by default, instant `take` and `sleep`)
  - `start merges and dedups newest first`: `steadyeverywhere` + `anotheroffice`, `categoryKey 'all'` → `status 'done'`, rows sorted by `docId` descending, unique `docId`s, each row has `tr` and `hits.length === jobCount` (every alias returned the same page).
  - `category filter applies`: `categoryKey 'fit'` → every `row.categoryId` is in the fit category's `ids`.
  - `rows matching hidden brands are dropped`: set one fixture title to contain `파프터` via a custom response → that row is absent when `hiddenBrandIds ['fafter']`.
  - `more() stops at data-last-page`: after `start`, `moreLabel '더 보기'`. `more()` → every request has `page=2`. Afterwards `moreLabel null`, `finished true`, and another `more()` makes 0 requests.
  - `limited job → 이어서 검색, more() refetches only it`: job 0 always 429 during `start` → `notice 'limited'`, `moreLabel '이어서 검색'`, rows from the others present. Then switch the fetch to 200 and call `more()` → exactly 1 request, for job 0's term at `page=1`.
  - `new start ignores late results of previous run`: the first run's fetch resolves after 20 ms. Call `start(A)` without awaiting, then `await start(B)`, then wait 40 ms → the rows' `hits` contain only B's brand, and A's fetch signals are aborted.
  - `empty selection → status empty, no requests`.
  - `alias cap: totalTerms > jobCount`: a dictionary copy where one brand has 35 search terms → `jobCount 30`, `totalTerms 35`.
- [ ] **Step 2: Run** `npx vitest run tests/lib/searchSession.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** `searchSession.js`. Delete the old controller, `politeFetch` and their tests. Change `maxRequests` to 30 and update `query.test.js`.
- [ ] **Step 4: Run** `npx vitest run`. Expected: all PASS. No test still imports `resultsController` or `politeFetch`.
- [ ] **Step 5: Commit** `feat: searchSession replaces resultsController; remove cache and polite queue`.

### Task 5: Hash state, popup navigation target, and the in-page result view

**Files:**
- Create: `src/lib/fmfHash.js`, `src/lib/resultView.js`
- Test: `tests/lib/fmfHash.test.js`, `tests/lib/resultView.test.js`

**Interfaces:**
- `encodeFmfHash({ brandIds, categoryKey }) → string`, for example `'#fmf=b:steadyeverywhere,anotheroffice;c:fit'`.
- `parseFmfHash(hash: string) → { brandIds: string[], categoryKey: string } | null`.
  - It returns `null` when the hash isn't `#fmf=`. `brandIds` drops empties, and the category defaults to `'all'`.
  - It accepts URI-encoded input.
- `goTarget(tabUrl: string | undefined, hash: string) → { action: 'update' | 'create', url: string }`. The result is `update` when `tabUrl` starts with `https://www.fmkorea.com/`, else `create`. `url` is `'https://www.fmkorea.com/fashion' + hash`.
- `createResultView(doc, { onRemoveBrand(id), onCancel(), onExit(), onMore() }) → { render(state: SessionState, ctx: { brands: Array<{id, name}>, categoryName: string, totalTerms: number }), destroy() }`.
  - On create: mark the original data rows of `table.bd_lst` (`tr` with `td.title`, notices included) with `data-fmf-orig`, then hide them. Hide `form.bd_pg` and remove `#fmf-bar`.
  - Insert `#fmf-results-bar` before the table, or before `div.bd_lst_wrp` / at the top of `#bd_capture` when there is no table. If there is no table, create `table.bd_lst > tbody`.
  - `render`: remove the previously rendered rows (`tr[data-fmf-result]`). Append `doc.importNode(row.tr, true)` for each `state.rows` entry, in order, marked `data-fmf-result`. In each title cell, append one `span.fmf-hit` per distinct hit term.
  - The bar shows:
    - `브랜드 모아보기`, the category name, and one chip per brand with a `✕` button that calls `onRemoveBrand(id)`.
    - `검색 중 {done}/{total}` plus a `취소` button while running.
    - The notice copy for `blocked`, `limited`, `unrecognized`, and for `done` with 0 rows.
    - `별명 {totalTerms}개 중 {jobCount}개만 검색` when capped.
    - `원래 목록으로`, which calls `onExit()`.
  - Below the table, a `button#fmf-more` labelled `state.moreLabel` calls `onMore()`. It is hidden while running, and replaced by the text `끝` when `finished`.
  - `destroy()`: remove the bar, the more button, rendered rows and any created table. Restore each `data-fmf-orig` row's previous inline `display` (saved on create, e.g. in `data-fmf-prev-display`) and un-hide `form.bd_pg`.

- [ ] **Step 1: Write the failing tests**
  - fmfHash (plain `test`):
    - Round-trip: `encode` then `parse`.
    - `parseFmfHash('#foo') === null`.
    - `parseFmfHash('#fmf=b:a,,b')` → `{ brandIds: ['a','b'], categoryKey: 'all' }`.
    - The encoded form of a Korean-safe id parses back.
    - `goTarget('https://www.fmkorea.com/12345', '#fmf=b:a;c:all')` → `update`. `goTarget('chrome://newtab/', h)` and `goTarget(undefined, h)` → `create`.
  - resultView (`ftest`, jsdom document from `board-list.html`; rows from `parseSearchPage(search-result.html).items` shaped as session rows with `hits`):
    - `hides original rows and pagination, inserts bar before table`: every original `td.title` row has `style.display === 'none'`, `form.bd_pg` is hidden, and `#fmf-results-bar` is the table's previous sibling.
    - `renders result rows with badges in order`: render 3 rows → 3 `tr[data-fmf-result]` in that `docId` order. The first row's `.fmf-hit` texts equal its hit terms.
    - `re-render replaces rows`: render twice → still 3 rendered rows.
    - `running shows progress and cancel`: `status 'running', progress {done:2,total:5}` → the bar text contains `검색 중 2/5`, and clicking `취소` calls `onCancel`.
    - `chip ✕ calls onRemoveBrand with id`.
    - `more button follows moreLabel; finished shows 끝`.
    - `notices`: `blocked` shows `펨코 보안 확인이 필요해요`; `done` with 0 rows shows `조건에 맞는 글이 없어요`; `notice 'limited'` shows `펨코가 잠시 요청을 제한했어요`.
    - `destroy restores the original page`: run `applyHiding(doc, ['fafter'], matchers)` first (one hidden row plus `#fmf-bar`), then create, render and destroy. Afterwards: no `[data-fmf-result]`, no `#fmf-results-bar`, `form.bd_pg` visible, the `data-fmf-hidden` row still `display: none`, and every other original row visible. (`#fmf-bar` is removed during result mode; the content script re-applies hiding after exit.)
    - `creates a table when the page has none`: a document from `search-empty.html` → after render there is one `table.bd_lst` holding the rendered rows.
- [ ] **Step 2: Run** `npx vitest run tests/lib/fmfHash.test.js tests/lib/resultView.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** both modules. Inline styles must be small and namespaced (`fmf-`), with no external CSS file, in line with the existing `#fmf-bar` approach.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat: fmf hash state, popup go target, in-page result view`.

### Task 6: Wire it up and remove the results page

**Files:**
- Modify: `src/content/board.js`, `src/popup/popup.js`, `scripts/build.mjs` (drop `results/results.js`), `src/lib/fetchPage.js` (doc comment only: now used from the content script), `README.md`, `STORE.md`.
- Delete: `src/results/` (all three files).

**Interfaces:**
- Consumes: everything above, plus `applyHiding`/`isFashionListUrl` (boardPage.js), `loadSettings` (settings.js), and the `getDictionary` message.

- [ ] **Step 1: Content script** (`board.js`) on fashion list URLs:
  - Create one `createTokenBucket()` per page.
  - `syncMode()`: when `parseFmfHash(location.hash)` returns a selection, enter or refresh result mode:
    - Create the view if it doesn't exist yet.
    - Call `session.start({ brandIds, categoryKey, hiddenBrandIds })`, re-rendering on `onChange`.
  - Otherwise, if a view exists, `cancel()` and `destroy()` it, then run the existing hiding.
  - View handlers:
    - `onRemoveBrand(id)` sets `location.hash` to the encoded selection without `id`, or clears the hash via `history.replaceState` plus `syncMode()` when none remain.
    - `onExit` clears the hash the same way.
    - `onCancel` calls `session.cancel()`, and `onMore` calls `session.more()`.
  - Listen to `hashchange` → `syncMode()`. A `storage.onChanged` event for settings or the dictionary calls `syncMode()` while in result mode (it re-searches), and runs hiding otherwise.
  - Hiding is not applied while in result mode.
- [ ] **Step 2: Popup** `go` handler: `const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })`, then `goTarget(tab?.url, encodeFmfHash({ brandIds: settings.selectedBrandIds, categoryKey: settings.categoryKey }))`. Then `chrome.tabs.update(tab.id, { url })` or `chrome.tabs.create({ url })`, then `window.close()`.
- [ ] **Step 3: Remove** `src/results/` and its build entry. Update the README file list and the STORE.md request description:
  - Replace the "1초 이상 간격 / 최대 12회" sentence with: "검색은 펨코 게시판 화면 안에서, 펨코에 부담이 가지 않도록 요청 속도를 스스로 제한하며 실행합니다. 한 번 누를 때 최대 30개 별명까지 검색합니다."
- [ ] **Step 4: Verify**
  - Run `npx vitest run`. Expected: all PASS (record counts).
  - Run `npm run build`. Expected: `built → dist`, and `dist/results` is absent.
  - Run `grep -rn "results.html\|politeFetch\|resultsController\|storage.session" src scripts`. Expected: no matches.
  - jsdom smoke in the scratchpad: load `dist/content/board.js` against a `board-list.html` document with a stubbed `chrome` (`runtime.sendMessage` → bundled dict, `storage.sync.get` → `{}`, `onChanged.addListener` no-op) and a fake `fetch` returning `search-result.html`. Set `location.hash` to `#fmf=b:steadyeverywhere;c:all` before loading → `#fmf-results-bar` exists and `tr[data-fmf-result]` count > 0.
- [ ] **Step 5: Commit** `feat: in-page results — popup navigates fmkorea tab, results page removed`.
- [ ] **Step 6: Manual check list for the user** (real Chrome, after the final review). Load unpacked `dist/` and check:
  - Popup 보기 from a fmkorea tab and from a non-fmkorea tab.
  - Removing a chip.
  - 원래 목록으로.
  - 더 보기 until 끝.
  - Reload and back-navigation re-search.
  - Hiding still works on normal lists.
