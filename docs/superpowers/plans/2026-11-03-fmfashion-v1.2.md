# v1.2 (browse without brands, infinite scroll, post-page list, floating panel) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the four changes in spec §11:
- browse a category with hidden brands removed, without picking a brand;
- infinite scroll;
- the merged list stays under a post opened from it;
- a floating badge panel on fmkorea fashion pages.

**Architecture:**
- **Jobs:** a job is either a search job (alias) or a list job (category page). `jobUrl` picks the URL, and the runner and session are otherwise unchanged.
- **Result view:** rewrites row links to `/<docId>#fmf=…` and replaces the "더 보기" button with an injected-observer sentinel.
- **Page classifier:** decides list page vs fashion post page. On post pages the view targets the list under the article.
- **Shared UI:** the popup UI moves into `src/ui/panel.js`, mounted by both the toolbar popup and an in-page Shadow-DOM badge.

**Tech Stack:** Chrome MV3, plain JS + JSDoc, esbuild IIFE (CSS imported as text for the shadow root), Vitest 5 + jsdom.

**Spec:** `docs/superpowers/specs/2026-11-02-fmfashion-brand-filter-design.md` — §11 (v1.2) overrides earlier sections; §5 request rules still apply.

## Global Constraints

- **Request rules:** every fmkorea request still goes through the per-page token bucket (15, 2/s), with 429 backoff of 1/2/4 s. A 430 or the security page aborts the run and offers no resume.
- **List URLs:**
  - `https://www.fmkorea.com/index.php?mid=fashion&category=<ID>&page=<n>` per category ID
  - `https://www.fmkorea.com/index.php?mid=fashion&page=<n>` for the `all` category (filtered by `excludeIds`)
- **Browse mode state:** `#fmf=b:;c:<key>`.
- **"보기" enablement and labels:**
  - Enabled when ≥1 brand is selected **or** ≥1 brand is hidden.
  - No brands, ≥1 hidden: label `<카테고리 이름> 보기 · 숨김 <N>개 제외`.
  - Brands selected: the existing `<N>개 브랜드 · <카테고리> 보기`.
  - Neither: `브랜드를 골라주세요`, disabled.
- **Copy:** `불러오는 중…`, `끝`, `이어서 검색`, `숨김 <N>개 제외`. Existing notices are unchanged.
- **Result-row links:** title and reply-count anchors → `https://www.fmkorea.com/<docId>` + current `#fmf=` hash, with no `search_keyword`.
- **Not changed:** dictionary `exclude` (파프 → `!파프터`) and hidden-term `!` exclusions stay.
- **Panel state:** `chrome.storage.local` key `panelOpen` (boolean, default `false`). Panel and badge render inside a Shadow DOM. The toolbar popup stays.
- **Fixtures:** stay local and gitignored. The new `tests/fixtures/document.html` follows the same rule (`ftest` skips when it is missing; add it to `HAS_FIXTURES`' optional list rather than the required list).

## Review Focus

1. **Short first page:** the result table is shorter than the viewport, so the sentinel is visible right after the first load. Auto-loading must keep going until the screen fills or the list ends, one load at a time. *Task 2 test "re-arms after render while sentinel stays visible".*
2. **Browse mode with a multi-ID category (fit = 2 IDs):** both lists are fetched and merged by `docId` without duplicates, and each list stops at its own `data-last-page`. *Task 1 test "browse fit: one list job per id, merged".*
3. **Panel 보기 with an unchanged hash:** clicking 보기 again must rerun, even though `hashchange` does not fire. *Task 5 step "go with same hash calls sync".*
4. **Post page that isn't a fashion post (another board):** no badge, no takeover. *Task 3 test "other-board post is not a fashion document".*
5. **Rewritten links:** the hash must survive in-page navigation from result rows. Rows with an unparsable href must be left as they were, not broken. *Task 2 test "rewrites title and reply links, leaves others".*

---

### Task 0 (user): save a fashion post page snapshot

- [ ] The user opens any post from `https://www.fmkorea.com/fashion` in Chrome and saves it as "웹페이지, HTML만" to `tests/fixtures/document.html`.
- [ ] Also save one post from another board (for example `https://www.fmkorea.com/football`) as `tests/fixtures/document-other.html`.
- Both stay local and are never committed. Tasks 3 and 5 depend on them; Tasks 1, 2 and 4 do not.

### Task 1: List jobs (browse mode) in query, runner and session

**Files:**
- Modify: `src/lib/query.js`, `src/lib/runner.js`, `src/lib/merge.js`, `src/lib/searchSession.js`
- Test: `tests/lib/query.test.js`, `tests/lib/runner.test.js`, `tests/lib/merge.test.js`, `tests/lib/searchSession.test.js`

**Interfaces:**
- `SearchJob` gains `kind: 'search' | 'list'`. Search jobs keep `term`, `brandId` and `keyword`. List jobs are `{ kind: 'list', categoryId: string | null, term: '', brandId: null, keyword: '' }`.
- `buildListJobs({ dict, categoryKey }) → SearchJob[]`: one job per category `ids` entry, or a single job with `categoryId: null` when `ids` is empty.
- `buildListUrl(categoryId: string | null, page: number) → string`.
- `jobUrl(job, page) → string`: `list` → `buildListUrl`, otherwise `buildSearchUrl(job.keyword, page)`.
- `runSearch` builds URLs with `jobUrl`.
- `mergeRows(existing, incoming, brandId, term)`: when `brandId` is `null`, add no hit.
- `searchSession.start(sel)`:
  - `brandIds` empty and `hiddenBrandIds` non-empty → browse with list jobs, and `state.mode = 'browse'`.
  - `brandIds` non-empty → `state.mode = 'search'`.
  - Both empty → `status 'empty'`.
  - `SessionState` gains `mode: 'search' | 'browse' | null`.

- [ ] **Step 1: Failing tests**
  - query:
    - `buildListJobs fit` → 2 jobs, with `categoryId`s equal to the fit category's `ids`.
    - `buildListJobs all` → 1 job with `categoryId null`.
    - `buildListUrl('18910473', 2)` → `https://www.fmkorea.com/index.php?mid=fashion&category=18910473&page=2`.
    - `buildListUrl(null, 1)` → `https://www.fmkorea.com/index.php?mid=fashion&page=1`.
    - `jobUrl` dispatches by kind.
  - merge: `mergeRows with null brand adds no hit` → `hits` is `[]` and the row is kept.
  - runner (`ftest`): `list job fetches the list url` → the fake fetch saw `mid=fashion&category=…&page=1` and no `search_keyword`.
  - session (`ftest`, the fake fetch serves `board-list.html` for list URLs):
    - `browse fit: one list job per id, merged` → `mode 'browse'`, `jobCount 2`, unique `docId`s, every row's `categoryId` is in fit `ids` and has `hits []`. `moreLabel '더 보기'` (lastPage 10002).
    - `browse drops hidden-brand titles`: set one fixture title to `파프터 …` and hide `fafter` → that row is absent.
    - `no brands and no hidden → empty, no requests` (rename of the existing empty test).
- [ ] **Step 2: Run** `npx vitest run tests/lib`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement** as specified.
- [ ] **Step 4: Run** `npx vitest run`. Expected: all PASS.
- [ ] **Step 5: Commit** `feat: browse mode — category list pages with hidden brands removed`.

### Task 2: Result view — link rewrite, infinite scroll, browse bar

**Files:**
- Modify: `src/lib/resultView.js`
- Test: `tests/lib/resultView.test.js`

**Interfaces:**
- `createResultView(doc, handlers, { observe } = {})`.
  - `observe(el, onVisible) → () => void` (disconnect). The default uses `IntersectionObserver` with `rootMargin: '600px 0px'`.
  - `handlers.onMore` is now called by the sentinel.
  - The table lookup is `opts.root ?? doc` (Task 3 passes the post-page list container).
- `render(state, ctx)`: `ctx` gains:
  - `linkHash: string`, the current `#fmf=…`;
  - `hiddenCount: number`;
  - `brands`, which is `[]` in browse mode.
- **Sentinel:** `div#fmf-sentinel` after the table.
  - When visible and `state.status !== 'running'` and `state.moreLabel === '더 보기'` → `onMore()`, at most once per render.
  - After each render where `moreLabel === '더 보기'`, re-arm: disconnect and observe again, so a still-visible sentinel fires again.
- **Footer** (`div#fmf-foot`, replaces `#fmf-more` and `#fmf-end`):
  - `running` with rows → `불러오는 중…`;
  - `moreLabel === '이어서 검색'` → a button with that label that calls `onMore`;
  - `finished` with rows → `끝`;
  - otherwise empty.
- **Links:** for each rendered row, anchors in `td.title` whose href yields a docId (same rule as parser `docIdFromHref`, exported from parser.js) are set to `https://www.fmkorea.com/<docId>${ctx.linkHash}`. Other anchors are untouched.
- **Browse bar:** when `state.mode === 'browse'`, there are no brand chips, and the bar shows `숨김 <hiddenCount>개 제외` after the category.

- [ ] **Step 1: Failing tests** (`ftest`; a fake `observe` stores the callback and exposes `fire()` and an `arms` count)
  - `sentinel loads more when visible` → `fire()` calls `onMore` once. With `status 'running'`, `fire()` does not call it.
  - `re-arms after render while sentinel stays visible` → `arms` grows by 1 per render with `moreLabel '더 보기'`, and stays the same when `finished`.
  - `footer states` → running with rows shows `불러오는 중…`; `이어서 검색` renders a button that calls `onMore`; finished shows `끝`.
  - `rewrites title and reply links, leaves others` → the first row's title `a` href is `https://www.fmkorea.com/<docId>#fmf=b:x;c:all`, and an injected `<a href="/member/1">` in that cell is unchanged.
  - `browse bar shows hidden count and no chips` → `mode 'browse'`, `hiddenCount 2` → the bar text contains `숨김 2개 제외`, with no `[data-brand]`.
  - Update existing tests: drop `#fmf-more` and `#fmf-end` expectations in favour of `#fmf-foot`. `destroy` also removes the sentinel and footer.
- [ ] **Step 2: Run** `npx vitest run tests/lib/resultView.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement**. Export `docIdFromHref` from `parser.js`.
- [ ] **Step 4: Run** `npx vitest run`. Expected: all PASS.
- [ ] **Step 5: Commit** `feat(view): infinite scroll, hash-preserving post links, browse bar`.

### Task 3: Page classifier and post-page list target (needs Task 0 fixtures)

**Files:**
- Modify: `src/lib/boardPage.js`, `tests/lib/fixtures.js` (optional fixtures: `document.html`, `document-other.html`, plus a `dtest` that skips when they are missing)
- Test: `tests/lib/boardPage.test.js`

**Interfaces:**
- `classifyPage(url: string, doc: Document) → { kind: 'list', listRoot: Element } | { kind: 'document', listRoot: Element | null } | null`.
  - `list`: `isFashionListUrl(url) && isListPage(doc)`, and `listRoot` is `doc` (its `div.bd_lst_wrp`).
  - `document`: the URL path is `/<digits>` or has `document_srl`, **and** the page is a fashion-board post. The selector for "fashion post" and for `listRoot` (the list under the article) is decided from `document.html` and written into `SELECTORS` in `parser.js`. `listRoot` is `null` when the post page has no list under it.
  - Otherwise `null`. A security or blocked page is always `null`.
- `isFashionListUrl` is unchanged.

- [ ] **Step 1: Inspect** `document.html` and `document-other.html` with a jsdom script in the scratchpad. Print only tag/class/id paths and counts, no text content. Choose:
  - (a) the marker that identifies the fashion board, for example a board-title link `a[href="/fashion"]` in the board header, or a hidden `input[name=mid][value=fashion]`;
  - (b) the container of the list under the article.
  - Record both in the ledger as a ruling.
- [ ] **Step 2: Failing tests** (`dtest`)
  - `fashion post is a document with list root` → `kind 'document'`, and `listRoot` contains a `table.bd_lst`.
  - `other-board post is not a fashion document` → `null`.
  - `list page classifies as list`, using `board-list.html` with `https://www.fmkorea.com/fashion`.
  - `blocked page → null`.
- [ ] **Step 3: Run** `npx vitest run tests/lib/boardPage.test.js`. Expected: FAIL.
- [ ] **Step 4: Implement** `classifyPage` plus the new `SELECTORS` entries.
- [ ] **Step 5: Run** `npx vitest run`. Expected: all PASS.
- [ ] **Step 6: Commit** `feat: classify fashion list and post pages`.

### Task 4: Shared panel UI (popup + in-page)

**Files:**
- Create: `src/ui/panel.js`, `src/ui/panel.css` (moved from `src/popup/popup.css`; `:root` → `:root, :host`, `body` rules → `.pp`)
- Modify: `src/popup/popup.html` (body becomes `<div id="app"></div>` plus a script; stylesheet `../ui/panel.css` copied by the build), `src/popup/popup.js` (mount only), `scripts/build.mjs` (copy `ui/panel.css`; esbuild `loader: { '.css': 'text' }`)
- Test: `tests/lib/panel.test.js` (jsdom)

**Interfaces:**
- `goLabel(settings, dict) → { disabled: boolean, text: string }`, following the Global Constraints rules.
- `mountPanel(root: Element | ShadowRoot, { dict, settings, save: (s) => Promise<void>, onGo: (sel: { brandIds, categoryKey }) => void, onClose?: () => void }) → { update(settings), destroy() }`.
  - It renders the current popup DOM (header, 보기/숨기기 tabs, category and brand chips, alias summary, footer).
  - All lookups are scoped to `root`, with no `document.getElementById`.
  - When `onClose` is given, the header shows a `접기` button.
- `popup.js`:
  - It loads `dict` and `settings` as before and mounts into `#app`.
  - `onGo` does the existing `goTarget`/`tabs` flow and keeps the dictionary refresh check.

- [ ] **Step 1: Failing tests**
  - `goLabel`:
    - no brands and no hidden → `{ disabled: true, text: '브랜드를 골라주세요' }`;
    - no brands, 2 hidden, fit → `{ disabled: false, text: '착샷 보기 · 숨김 2개 제외' }`;
    - 2 brands, all → `{ disabled: false, text: '2개 브랜드 · 전체 보기' }`.
  - `mountPanel`:
    - mounting into a detached `div` renders the category radios and brand chips;
    - clicking a chip calls `save` with that brand selected;
    - `보기` is enabled with only hidden brands, and clicking it calls `onGo({ brandIds: [], categoryKey })`;
    - the hide tab's `저장` calls `save` with `hiddenBrandIds`;
    - `접기` calls `onClose`.
  - Mounting into a `ShadowRoot` (`div.attachShadow({mode:'open'})`) renders and finds its own buttons.
- [ ] **Step 2: Run** `npx vitest run tests/lib/panel.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement**. Move the popup logic into `panel.js`. `popup.js` keeps only the chrome-specific parts.
- [ ] **Step 4: Run** `npx vitest run && npm run build`. Expected: PASS; `dist/popup/popup.html` and `dist/ui/panel.css` exist.
- [ ] **Step 5: Commit** `refactor(ui): shared panel for popup and page; enable 보기 with hidden brands only`.

### Task 5: Content wiring — badge, post pages, same-hash rerun

**Files:**
- Create: `src/ui/badge.js`
- Modify: `src/content/board.js`, `README.md`, `STORE.md`
- Test: `tests/lib/badge.test.js`

**Interfaces:**
- `mountBadge(doc, { open: boolean, hiddenCount: number, onToggle(open: boolean) }) → { host: Element, panelRoot: ShadowRoot-contained Element, setOpen(b), setHiddenCount(n), destroy() }`.
  - It creates `div#fmf-badge-host`, fixed at the bottom right with a high z-index, holding an open shadow root.
  - The badge button text is `필터` plus a hidden count when non-zero (e.g. `필터 · 2`).
  - When open, the panel container is shown above the badge.
- Content script (`board.js`):
  - `const page = classifyPage(location.href, document)`. If `null`, do nothing.
  - Mount the badge on every classified page.
    - Read `panelOpen` from `chrome.storage.local`; toggling saves it.
    - The panel uses `chrome.storage.sync` settings via `saveSettings`/`loadSettings`, plus the dictionary from the service-worker message.
  - Panel `onGo(sel)`: `const h = encodeFmfHash(sel)`. If `location.hash === h`, call `syncMode()`; otherwise set `location.hash = h`.
  - `syncMode` uses `page.listRoot` as the view root.
    - On `document` pages with no `#fmf` it does nothing: no plain hiding there (spec §11.3).
    - On `document` pages with `listRoot === null` it does nothing.
  - `ctx.linkHash = location.hash`, and `ctx.hiddenCount = hiddenBrandIds.length`.
  - Settings changes refresh the panel (`update`) and the badge count. Re-search still only happens per `needsResync`.

- [ ] **Step 1: Failing tests** (`badge.test.js`, jsdom)
  - `badge renders in a shadow root and toggles` → the host exists, and clicking the badge calls `onToggle(true)`.
  - `setOpen(true)` shows the panel container; `setOpen(false)` hides it.
  - `hidden count text` → `setHiddenCount(2)` → the badge text contains `2`.
  - `destroy removes host`.
- [ ] **Step 2: Run** `npx vitest run tests/lib/badge.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** `badge.js` and the content wiring. The CSS for the badge and panel is imported as text (`import css from '../ui/panel.css'`) into the shadow root.
- [ ] **Step 4: Verify**
  - `npx vitest run` → all PASS.
  - `npm run build` → OK.
  - jsdom smoke in the scratchpad against `dist/content/board.js` (extend `smoke-inpage.mjs`):
    - **(a)** List page, no hash → `#fmf-badge-host` exists, and there is no results bar.
    - **(b)** List page with `#fmf=b:;c:all` and `fafter` hidden in the stubbed sync storage → results bar shows `숨김 1개 제외`, and rows have rewritten links that end in the hash.
    - **(c)** `document.html` at `https://www.fmkorea.com/<id>#fmf=b:anotheroffice;c:all` → result rows render inside the post page's list root.
    - **(d)** Same-hash rerun: call the panel's 보기 twice → the fetch count increases the second time.
- [ ] **Step 5: Docs.**
  - README: describe the badge panel and browse mode.
  - STORE.md: in the description, mention the floating button on the fashion board and that hidden-only browsing works.
- [ ] **Step 6: Commit** `feat: floating filter panel on fashion pages; keep merged list under posts`.
- [ ] **Step 7: User manual check** (real Chrome, after final review), on a list page and a post page:
  - Badge opens and pinning persists across pages.
  - Hidden-only 보기.
  - Infinite scroll to 끝.
  - Opening a post keeps the merged list under it.
  - Toolbar popup still works.
