# 펨코 패션 브랜드 필터 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** fmkorea 패션 게시판용 MV3 크롬 확장 프로그램 — 사전 기반 클릭형 브랜드 필터(별명 합집합 검색), 카테고리 지정, 사용자 지정 숨김 브랜드.

**Architecture:** 순수 함수 모듈(`src/lib/*`: 사전 검증, 별명 매처, 검색어 생성, HTML 파서, 결과 병합, 순차 실행기)을 Vitest로 단위 테스트하고, 그 위에 얇은 UI 진입점(팝업, 결과 페이지, 게시판 content script, 서비스 워커)을 얹는다. esbuild가 각 진입점을 `dist/`로 번들한다(content script는 ES module을 쓸 수 없으므로 번들 필수). 펨코 요청은 `fetchPage` 함수 하나로 추상화해 Task 2 스파이크 결과에 따라 구현만 바꾼다.

**Tech Stack:** JavaScript (ES2022, JSDoc 타입 주석), Chrome Manifest V3, esbuild, Vitest + jsdom, Node 20+.

**Spec:** `docs/superpowers/specs/2026-11-02-fmfashion-brand-filter-design.md`

## Global Constraints

- Manifest V3. 권한: `storage`, `alarms`; host: `https://www.fmkorea.com/*`, `https://raw.githubusercontent.com/*`. (`tabs`/`scripting`은 Task 2 결과가 "막힘"일 때만 추가)
- 원격 코드 실행 금지. 원격에서 받는 것은 사전 JSON 데이터뿐.
- 사전 원격 URL(고정): `https://raw.githubusercontent.com/gaeeeguri/fmfashion/main/dictionary/brands.json`
- 사전 스키마 `schemaVersion: 1` (spec §6 그대로: `categories[{key,name,ids,excludeIds?}]`, `groups[{id,name}]`, `brands[{id,name,nameEn?,group,searchTerms,matchPatterns,exclude?,note?}]`).
- 펨코 요청: 순차 실행만, 요청 간 최소 1000ms + 0–500ms 무작위 지연. 클릭 1회(또는 "더 보기" 1회)당 최대 12회 요청.
- 검색 URL: `https://www.fmkorea.com/search.php?mid=fashion&search_target=title_content&search_keyword=<kw>&page=<n>`
- 430 응답 또는 보안 페이지("에펨코리아 보안 시스템")를 받으면 즉시 중단, 안내 문구: `펨코 보안 시스템 때문에 검색을 멈췄어요. 잠시 후 다시 시도해 주세요.`
- 기본 숨김 브랜드 없음. 숨기기 적용 범위는 패션 게시판 목록·패션 게시판 검색 결과 한정.
- 결과는 문서번호(`document_srl`, 정수) 내림차순 = 최신순. (목록의 날짜는 연도가 없어 정렬에 쓰지 않는다)
- UI 문구는 한국어. 사용자 데이터 외부 전송 없음.
- 사용자 브랜드 데이터 외 펨코 카테고리 ID는 하드코딩하지 않고 사전에서 읽는다.

## Review Focus

1. **접두어가 겹치는 별명** — `파프`는 `파프터` 제목에 매칭되면 안 된다 → Task 3 테스트 `paf does not match fafter`.
2. **실행 중간 차단** — 3번째 요청에서 430이 오면 이미 받은 결과는 화면에 남고 이후 요청은 보내지 않는다 → Task 7 테스트 `stops on blocked and keeps prior rows`.
3. **깨졌거나 낯선 원격 사전** — JSON 파싱 실패, `schemaVersion` 불일치, 필수 필드 누락, 잘못된 정규식 → 기존 사전 유지 → Task 1 / Task 8 테스트.
4. **공지·광고 행** — 목록의 `tr.notice`와 AD 행은 결과·숨김 카운트에 섞이지 않는다 → Task 5 테스트 `skips notice and ad rows`.
5. **보기 선택과 숨김이 겹침** — 이미 선택돼 있던 브랜드를 나중에 숨기면 보기 선택에서 빠지고 검색에 쓰이지 않는다 → Task 8 테스트 `hiding a brand removes it from selection`.

---

## File Structure

```
package.json                    # scripts: build, test, zip
scripts/build.mjs               # esbuild 번들 + 정적 파일 복사 → dist/
scripts/zip.mjs                 # dist/ → fmfashion-<version>.zip
dictionary/brands.json          # 공유 사전 원본(원격 URL의 대상) — 빌드 시 번들 사본으로도 복사
src/manifest.json
src/lib/dictionary.js           # validateDictionary, pickNewer
src/lib/matcher.js              # compileMatchers, matchBrands
src/lib/query.js                # buildSearchJobs, buildSearchUrl
src/lib/parser.js               # parseListHtml, isBlockedHtml
src/lib/merge.js                # mergeRows, filterRows
src/lib/runner.js               # runSearch
src/lib/fetchPage.js            # fetchPage (Task 2 결과로 구현 결정)
src/lib/settings.js             # 저장소 래퍼 + normalizeSettings
src/lib/dictionaryStore.js      # getDictionary, refreshDictionary
src/background/sw.js            # alarms → refreshDictionary
src/popup/{popup.html,popup.css,popup.js}
src/results/{results.html,results.css,results.js}
src/content/board.js            # 패션 게시판 행 숨김
src/icons/{16,48,128}.png
tests/fixtures/{board-list.html,search-result.html,blocked-430.html}   # 이미 존재
tests/lib/*.test.js
STORE.md                        # 웹스토어 설명/개인정보 고지 문안
```

---

### Task 1: 스캐폴드 + 사전 검증

**Files:**
- Create: `package.json`, `scripts/build.mjs`, `src/manifest.json`, `dictionary/brands.json`, `src/lib/dictionary.js`, `.gitignore`
- Test: `tests/lib/dictionary.test.js`

**Interfaces:**
- Produces:
  - `validateDictionary(raw: unknown): Dictionary | null` — 유효하면 같은 객체, 아니면 `null`.
  - `pickNewer(current: Dictionary, incoming: Dictionary | null): Dictionary` — `incoming`이 유효하고 `updatedAt`이 더 늦으면 `incoming`.
  - `Dictionary` JSDoc typedef (spec §6 스키마).
  - `npm run build` → `dist/` (manifest, 번들, html/css, icons, `dictionary/brands.json` 사본), `npm test` → vitest.

- [ ] **Step 1:** `git init`, `.gitignore`에 `node_modules/`, `dist/`, `.superpowers/`, `*.zip`. `package.json` (type: module, devDeps: `esbuild`, `vitest`, `jsdom`), `npm install`.
- [ ] **Step 2:** `dictionary/brands.json` 작성 — spec §6 예시의 categories(전체/착샷/질문/후기/정보) 그대로, groups `street`(스트릿 · 캐주얼), `minimal`(미니멀), brands: steadyeverywhere, anotheroffice, paf, fafter(`searchTerms:["파프터"]`, `matchPatterns:["파프터"]`), firstfloor(`searchTerms:["퍼스트플로어","퍼플"]`, `matchPatterns:["퍼스트\\s?플로어","퍼플"]`) + 그룹을 채울 임의 브랜드 2–3개. `version: "2026.11.02"`.
- [ ] **Step 3: 실패하는 테스트 작성** (`tests/lib/dictionary.test.js`)

```js
import bundled from '../../dictionary/brands.json';
test('bundled dictionary is valid', () => expect(validateDictionary(bundled)).not.toBeNull());
test('rejects wrong schemaVersion', () => expect(validateDictionary({ ...bundled, schemaVersion: 2 })).toBeNull());
test('rejects brand without searchTerms', () => { const d = structuredClone(bundled); delete d.brands[0].searchTerms; expect(validateDictionary(d)).toBeNull(); });
test('rejects invalid regex in matchPatterns', () => { const d = structuredClone(bundled); d.brands[0].matchPatterns = ['(']; expect(validateDictionary(d)).toBeNull(); });
test('rejects brand with unknown group', () => { const d = structuredClone(bundled); d.brands[0].group = 'nope'; expect(validateDictionary(d)).toBeNull(); });
test('rejects non-object', () => expect(validateDictionary('x')).toBeNull());
test('pickNewer prefers later updatedAt', () => { const n = { ...bundled, updatedAt: '2099-01-01T00:00:00+09:00' }; expect(pickNewer(bundled, n)).toBe(n); });
test('pickNewer keeps current when incoming null or older', () => { expect(pickNewer(bundled, null)).toBe(bundled); expect(pickNewer(bundled, { ...bundled, updatedAt: '2000-01-01T00:00:00+09:00' })).toBe(bundled); });
```

- [ ] **Step 4:** `npx vitest run tests/lib/dictionary.test.js` → FAIL (모듈 없음).
- [ ] **Step 5:** `src/lib/dictionary.js` 구현. 중복 brand id도 거부.
- [ ] **Step 6:** 테스트 PASS 확인.
- [ ] **Step 7:** `src/manifest.json` (name "펨코 패션 브랜드 필터", version "0.1.0", action popup `popup/popup.html`, background service_worker `background/sw.js`, content_scripts: matches `https://www.fmkorea.com/*`, js `content/board.js`, run_at `document_end`, 권한은 Global Constraints대로) + `scripts/build.mjs` (진입점: `src/background/sw.js`, `src/popup/popup.js`, `src/results/results.js`, `src/content/board.js` → `dist/` 같은 상대경로, format `iife`; html/css/icons/manifest/`dictionary/brands.json` 복사). 아직 없는 진입점은 빈 파일로 생성. 아이콘은 단색 임시 PNG.
- [ ] **Step 8:** `npm run build` 성공, `dist/manifest.json` 존재 확인. 크롬 `chrome://extensions` → 압축해제된 확장 로드 시 오류 없음.
- [ ] **Step 9: Commit** `chore: scaffold extension and dictionary validation`

---

### Task 2: 스파이크 — 확장 프로그램 fetch가 펨코 보안을 통과하는가 (일회용)

**Files:**
- Create (임시, 커밋 후 Task 7 완료 시 삭제): `src/spike/probe.html`, `src/spike/probe.js`
- Modify: `docs/superpowers/specs/2026-11-02-fmfashion-brand-filter-design.md` §5 0번 항목에 결과 기록
- Create: `src/lib/fetchPage.js`

**Interfaces:**
- Produces: `fetchPage(url: string, signal?: AbortSignal): Promise<{ status: number, html: string }>` — 이후 모든 펨코 요청의 유일한 통로.

- [ ] **Step 1:** probe 페이지: 버튼 클릭 시 `fetch(url, { credentials: 'include' })`로 아래 3개를 1.5초 간격 순차 요청하고 각 status, `isBlocked`(본문에 `에펨코리아 보안 시스템` 포함 여부), `<tr` 개수를 화면에 출력:
  1. `search.php?mid=fashion&search_target=title_content&search_keyword=스에웨`
  2. 같은 검색 + `&category=18910473`
  3. `index.php?mid=fashion&category=18910473`
- [ ] **Step 2 (사람 확인):** 빌드 → 확장 다시 로드 → 일반 크롬에서 fmkorea를 한 번 연 상태로 `chrome-extension://<id>/spike/probe.html` 열고 실행. 펨코 탭을 모두 닫은 상태에서도 한 번 더.
- [ ] **Step 3:** 결과를 spec §5 0번에 기록 (통과 여부, `category=` 동작 여부, 펨코 탭 없을 때 결과).
- [ ] **Step 4:** 분기
  - **통과:** `fetchPage` = 확장 페이지에서 `fetch(url, { credentials: 'include', signal })` 후 `{status, html: await res.text()}`.
  - **막힘:** `fetchPage` = `chrome.tabs.query({url:'https://www.fmkorea.com/*'})`로 탭을 찾고, 없으면 `chrome.tabs.create({url:'https://www.fmkorea.com/fashion', active:false})` 후 로드 완료 대기, `chrome.scripting.executeScript`로 그 탭에서 같은 fetch 실행해 `{status, html}` 반환, 직접 연 탭은 `runSearch` 종료 후 닫는다(`closeHelperTab()` 추가 export). manifest에 `tabs`, `scripting` 추가.
  - `category=`가 동작하면 Task 4의 `buildSearchUrl`에 category 파라미터를 넣고, 아니면 넣지 않는다(병합 단계에서 거름 — Task 6은 어느 쪽이든 거른다).
- [ ] **Step 5: Commit** `spike: verify extension fetch against fmkorea security`

---

### Task 3: 별명 매처

**Files:**
- Create: `src/lib/matcher.js`
- Test: `tests/lib/matcher.test.js`

**Interfaces:**
- Consumes: `Dictionary`
- Produces:
  - `compileMatchers(dict: Dictionary): Map<brandId, RegExp[]>` — `matchPatterns`를 플래그 `iu`로 컴파일.
  - `matchBrands(title: string, brandIds: string[], matchers): string[]` — 제목에 매칭되는 brandId 목록(입력 순서 유지).

- [ ] **Step 1: 테스트 작성**

```js
const m = compileMatchers(bundled);
test('aliases of steadyeverywhere', () => {
  for (const t of ['스에웨 데님 후기', 'SEW 코치자켓', 'sew 코치자켓', '스웨에에에에엑 샀다', '스테디 니트'])
    expect(matchBrands(t, ['steadyeverywhere'], m)).toEqual(['steadyeverywhere']);
});
test('sew inside english word does not match', () => expect(matchBrands('sewing kit', ['steadyeverywhere'], m)).toEqual([]));
test('목동 maps to anotheroffice', () => expect(matchBrands('오늘 목동 블레이저', ['anotheroffice'], m)).toEqual(['anotheroffice']));
test('paf does not match fafter', () => {
  expect(matchBrands('파프터 환불 안해줌', ['paf'], m)).toEqual([]);
  expect(matchBrands('파프 셔츠 핏', ['paf'], m)).toEqual(['paf']);
});
test('multiple brands', () => expect(matchBrands('스에웨 + 목동 조합', ['steadyeverywhere', 'anotheroffice', 'paf'], m)).toEqual(['steadyeverywhere', 'anotheroffice']));
test('unknown brand id ignored', () => expect(matchBrands('스에웨', ['nope'], m)).toEqual([]));
```

- [ ] **Step 2:** FAIL 확인 → **Step 3:** 구현 → **Step 4:** PASS 확인 (`npx vitest run tests/lib/matcher.test.js`). 사전 패턴이 테스트를 통과하도록 `dictionary/brands.json`의 `matchPatterns`를 조정해도 된다(예: SEW는 `(?<![A-Za-z])SEW(?![A-Za-z])`).
- [ ] **Step 5: Commit** `feat: brand alias matcher`

---

### Task 4: 검색 작업 생성

**Files:**
- Create: `src/lib/query.js`
- Test: `tests/lib/query.test.js`

**Interfaces:**
- Consumes: `Dictionary`
- Produces:
  - `buildSearchJobs({ dict, selectedBrandIds, hiddenBrandIds, maxRequests = 12, maxKeywordLength = 100 }): { jobs: Array<{ term: string, brandId: string, keyword: string }>, totalTerms: number }`
    - 선택 브랜드 순서대로 각 브랜드의 `searchTerms`를 순서대로 모아 대소문자 무시 중복 제거.
    - 각 term의 keyword = `term` + 해당 브랜드 `exclude`의 ` !x` + 숨김 브랜드들의 `searchTerms` 각각 ` !x`. 길이가 `maxKeywordLength`를 넘으면 숨김 쪽 `!x`를 뒤에서부터 뺀다(브랜드 자체 `exclude`는 유지).
    - 라운드로빈으로 jobs를 `maxRequests`개까지 자른다(브랜드1 term1, 브랜드2 term1, 브랜드1 term2 …) — 여러 브랜드를 골라도 각 브랜드의 대표 별명이 먼저 검색되도록.
    - 숨김 brandId가 selected에 있으면 selected에서 제외.
  - `buildSearchUrl(keyword: string, page: number, categoryId?: string): string` — Global Constraints의 URL, `URLSearchParams`로 인코딩. `categoryId`는 Task 2에서 `category=` 동작이 확인된 경우에만 호출부가 넘긴다.

- [ ] **Step 1: 테스트 작성**

```js
test('expands aliases with hidden exclusions', () => {
  const { jobs, totalTerms } = buildSearchJobs({ dict: bundled, selectedBrandIds: ['anotheroffice'], hiddenBrandIds: ['fafter'] });
  expect(jobs.map(j => j.keyword)).toEqual(['어나더오피스 !파프터', '목동 !파프터']);
  expect(totalTerms).toBe(2);
});
test('brand-level exclude always kept', () => {
  const { jobs } = buildSearchJobs({ dict: bundled, selectedBrandIds: ['paf'], hiddenBrandIds: [] });
  expect(jobs[0].keyword).toBe('파프 !파프터');
});
test('round-robin and cap', () => {
  const { jobs, totalTerms } = buildSearchJobs({ dict: bundled, selectedBrandIds: ['steadyeverywhere', 'anotheroffice'], hiddenBrandIds: [], maxRequests: 3 });
  expect(jobs.map(j => j.term)).toEqual(['스테디에브리웨어', '어나더오피스', '스테디']);
  expect(totalTerms).toBeGreaterThan(3);
});
test('hidden brand removed from selection', () => {
  const { jobs } = buildSearchJobs({ dict: bundled, selectedBrandIds: ['fafter', 'paf'], hiddenBrandIds: ['fafter'] });
  expect(jobs.every(j => j.brandId === 'paf')).toBe(true);
});
test('keyword length cap drops hidden exclusions first', () => {
  const { jobs } = buildSearchJobs({ dict: bundled, selectedBrandIds: ['paf'], hiddenBrandIds: ['firstfloor', 'fafter'], maxKeywordLength: 12 });
  expect(jobs[0].keyword.startsWith('파프 !파프터')).toBe(true);
  expect(jobs[0].keyword.length).toBeLessThanOrEqual(12);
});
test('buildSearchUrl encodes', () => {
  expect(buildSearchUrl('파프 !파프터', 2)).toBe('https://www.fmkorea.com/search.php?mid=fashion&search_target=title_content&search_keyword=%ED%8C%8C%ED%94%84+%21%ED%8C%8C%ED%94%84%ED%84%B0&page=2');
});
```

- [ ] **Step 2:** FAIL → **Step 3:** 구현 → **Step 4:** PASS (`npx vitest run tests/lib/query.test.js`)
- [ ] **Step 5: Commit** `feat: build per-alias search jobs`

---

### Task 5: 목록 HTML 파서

**Files:**
- Create: `src/lib/parser.js`
- Test: `tests/lib/parser.test.js` (vitest `// @vitest-environment jsdom`)

**Interfaces:**
- Produces:
  - `parseListHtml(html: string): Row[]` — `DOMParser`로 파싱. 셀렉터는 파일 상단 `SELECTORS` 상수 한 곳에 모은다.
  - `parseListDocument(doc: Document | Element): Array<{ row: Row, tr: HTMLTableRowElement }>` — content script가 실제 DOM에 쓰는 버전. `parseListHtml`은 이걸 감싼다.
  - `isBlockedHtml(html: string): boolean` — `에펨코리아 보안 시스템` 포함 여부.
  - `Row = { docId: number, title: string, url: string, categoryId: string | null, categoryName: string, author: string, time: string, views: number | null, votes: number | null, comments: number }`
  - 규칙: `tr.notice` 제외, `td.title` 없는 행(광고 등) 제외. docId는 title 링크 href의 `/<숫자>` 또는 `document_srl=<숫자>`. `url` = `https://www.fmkorea.com/<docId>`. title은 `a.replyNum` 등을 뺀 첫 링크 텍스트 trim. categoryId는 `td.cate a` href의 `category=<숫자>`.

- [ ] **Step 1: 테스트 작성**

```js
const read = f => fs.readFileSync(`tests/fixtures/${f}`, 'utf8');
test('board list rows', () => {
  const rows = parseListHtml(read('board-list.html'));
  expect(rows.length).toBe(20);
  expect(rows.every(r => Number.isInteger(r.docId) && r.docId > 0 && r.title.length > 0)).toBe(true);
});
test('skips notice and ad rows', () => {
  const rows = parseListHtml(read('board-list.html'));
  expect(rows.some(r => r.categoryName === '공지')).toBe(false);
  expect(rows.some(r => /신청하기/.test(r.title))).toBe(false);
});
test('search result rows use document_srl', () => {
  const rows = parseListHtml(read('search-result.html'));
  expect(rows.length).toBeGreaterThanOrEqual(15);
  expect(rows.find(r => r.docId === 10501045295)).toMatchObject({ categoryName: '착샷', categoryId: '18910473', url: 'https://www.fmkorea.com/10501045295' });
});
test('title excludes reply count', () => {
  const r = parseListHtml(read('search-result.html')).find(r => r.docId === 10501045295);
  expect(r.title).toBe('오늘 착샷'); expect(r.comments).toBe(3);
});
test('blocked page detected', () => {
  expect(isBlockedHtml(read('blocked-430.html'))).toBe(true);
  expect(isBlockedHtml(read('board-list.html'))).toBe(false);
  expect(parseListHtml(read('blocked-430.html'))).toEqual([]);
});
```

  (픽스처의 실제 값이 다르면 — 예: 행 수 — 픽스처를 열어 확인한 값으로 기대치를 맞춘다. 기대치는 픽스처 기준 사실이어야 한다.)

- [ ] **Step 2:** FAIL → **Step 3:** 구현 → **Step 4:** PASS (`npx vitest run tests/lib/parser.test.js`)
- [ ] **Step 5: Commit** `feat: parse fmkorea list html`

---

### Task 6: 결과 병합·필터

**Files:**
- Create: `src/lib/merge.js`
- Test: `tests/lib/merge.test.js`

**Interfaces:**
- Consumes: `Row` (Task 5), `matchBrands`/matchers (Task 3), `Dictionary.categories`
- Produces:
  - `filterRows(rows: Row[], { category, hiddenBrandIds, matchers }): Row[]` — `category`는 사전 categories 원소. `ids`가 비어있지 않으면 `categoryId ∈ ids`만, `excludeIds`가 있으면 그 ID 제외. 제목이 숨김 브랜드에 매칭되면 제외.
  - `mergeRows(existing: ResultRow[], incoming: Row[], hitBrandId: string, hitTerm: string): ResultRow[]` — docId 기준 중복 제거, 기존 행이면 `hits`에 `{brandId, term}` 추가(중복 없이), 결과는 docId 내림차순. 입력 배열 변경 금지(새 배열 반환).
  - `ResultRow = Row & { hits: Array<{ brandId: string, term: string }> }`

- [ ] **Step 1: 테스트 작성** — 작은 Row 리터럴로:
  - `dedupes by docId and accumulates hits` (같은 docId를 두 term으로 merge → 1행, hits 2개)
  - `sorted newest first` (docId 5, 9, 7 → 9,7,5)
  - `category ids filter` (착샷 category → categoryId `186586714`(베스트착샷) 통과, `4022646597` 제외)
  - `all category excludes notice/event/graveyard` (전체 → `210029879` 제외, 그 외 통과)
  - `hidden brand titles removed` (hidden `['fafter']`, 제목 `파프터 CS 후기` 제외, `파프 셔츠` 유지)
  - `does not mutate input`
- [ ] **Step 2:** FAIL → **Step 3:** 구현 → **Step 4:** PASS (`npx vitest run tests/lib/merge.test.js`)
- [ ] **Step 5: Commit** `feat: merge and filter search results`

---

### Task 7: 순차 실행기

**Files:**
- Create: `src/lib/runner.js`
- Test: `tests/lib/runner.test.js` (가짜 타이머 사용 또는 `sleep` 주입)

**Interfaces:**
- Consumes: `buildSearchUrl` (Task 4), `parseListHtml`/`isBlockedHtml` (Task 5), `fetchPage` 시그니처 (Task 2)
- Produces:
  - `runSearch({ jobs, page = 1, categoryId, fetchPage, sleep, random = Math.random, signal, onProgress, onRows }): Promise<{ status: 'done' | 'blocked' | 'cancelled' | 'error', completed: number }>`
    - jobs를 순서대로 1개씩. 두 번째 요청부터 앞에 `sleep(1000 + Math.floor(random() * 500))`.
    - 각 요청 전 `onProgress({ done: i, total: jobs.length, term })`, 성공 시 `onRows(rows, job)`.
    - `status === 430` 또는 `isBlockedHtml(html)` → 즉시 `'blocked'` 반환, 이후 요청 없음.
    - `signal.aborted` → `'cancelled'`. fetch 예외 → `'error'` (그때까지의 onRows는 유지).
  - 완료 후 Task 2 spike 파일(`src/spike/`) 삭제.

- [ ] **Step 1: 테스트 작성**
  - `requests sequentially with delay` — 가짜 fetchPage가 호출 시각을 기록, `sleep` 모의로 호출 인자가 각 `>= 1000 && < 1500`, 동시 호출 0회(이전 promise 해결 전 다음 호출 없음).
  - `stops on blocked and keeps prior rows` — 3번째 응답 `{status:430}` → 반환 `'blocked'`, fetchPage 호출 3회, onRows 2회.
  - `blocked html with status 200 also stops`
  - `cancel stops before next request` — 1번째 onRows에서 `controller.abort()` → `'cancelled'`, 호출 1회.
  - `passes page and categoryId into url` — fetchPage가 받은 URL에 `page=2` 포함.
- [ ] **Step 2:** FAIL → **Step 3:** 구현 → **Step 4:** PASS (`npx vitest run tests/lib/runner.test.js`)
- [ ] **Step 5:** `src/spike/` 삭제, 빌드 진입점에서 제거.
- [ ] **Step 6: Commit** `feat: sequential polite search runner`

---

### Task 8: 설정·사전 저장소 + 서비스 워커

**Files:**
- Create: `src/lib/settings.js`, `src/lib/dictionaryStore.js`, `src/background/sw.js`
- Test: `tests/lib/settings.test.js`, `tests/lib/dictionaryStore.test.js` (`chrome.storage`는 메모리 가짜 객체로 주입)

**Interfaces:**
- Consumes: `validateDictionary`, `pickNewer` (Task 1)
- Produces:
  - `normalizeSettings(raw, dict): Settings` — `Settings = { hiddenBrandIds: string[], selectedBrandIds: string[], categoryKey: string }`. 기본값 `{[], [], 'all'}`. 사전에 없는 ID 제거, `selectedBrandIds`에서 hidden 제거, 없는 categoryKey → `'all'`.
  - `loadSettings(storage, dict): Promise<Settings>` / `saveSettings(storage, settings): Promise<void>` — `chrome.storage.sync`, 키 `settings`.
  - `getDictionary(storage, bundledUrl): Promise<Dictionary>` — `chrome.storage.local`의 `dictionary`가 유효하면 그것과 번들 중 `pickNewer`, 아니면 번들(`chrome.runtime.getURL('dictionary/brands.json')`).
  - `refreshDictionary(storage, fetchFn, now): Promise<'updated' | 'unchanged' | 'failed'>` — 원격 URL GET, JSON 파싱 실패/검증 실패 → `'failed'`(저장 안 함). `pickNewer`로 더 새로우면 저장. `dictionaryCheckedAt` 기록.
  - `sw.js`: `chrome.runtime.onInstalled` + `onStartup`에서 `chrome.alarms.create('dict', { periodInMinutes: 1440 })`, 알람과 설치 시 `refreshDictionary`. 팝업이 열릴 때 `dictionaryCheckedAt`이 24시간 넘었으면 `chrome.runtime.sendMessage({type:'refreshDictionary'})` → sw가 처리.

- [ ] **Step 1: 테스트 작성**
  - `hiding a brand removes it from selection` (normalize `{hidden:['paf'], selected:['paf','anotheroffice']}` → selected `['anotheroffice']`)
  - `unknown ids and category dropped`
  - `defaults when storage empty`
  - `refresh stores newer valid dictionary` → `'updated'`
  - `refresh ignores malformed json` (fetchFn이 `'{'` 텍스트) → `'failed'`, 저장소 변화 없음
  - `refresh ignores wrong schemaVersion` → `'failed'`
  - `refresh unchanged when not newer` → `'unchanged'`
  - `getDictionary falls back to bundled when stored is invalid`
- [ ] **Step 2:** FAIL → **Step 3:** 구현 → **Step 4:** PASS (`npx vitest run tests/lib/settings.test.js tests/lib/dictionaryStore.test.js`)
- [ ] **Step 5: Commit** `feat: settings and shared dictionary refresh`

---

### Task 9: 팝업 UI

**Files:**
- Create: `src/popup/popup.html`, `src/popup/popup.css`, `src/popup/popup.js`
- Test: 수동 (아래 확인 목록)

**Interfaces:**
- Consumes: `getDictionary`, `loadSettings`/`saveSettings`/`normalizeSettings` (Task 8)
- Produces: 결과 페이지 열기 — `chrome.tabs.create({ url: chrome.runtime.getURL('results/results.html') + '?' + new URLSearchParams({ brands: ids.join(','), cat: categoryKey }) })`

시각 기준: `.superpowers/brainstorm/24964-1793625972/content/popup-v3.html`의 마크업·스타일(폭 340px, 칩 그리드, 보기/숨기기 세그먼트, 파랑 `#3b5bfd` 선택, 빨강 `#e5484d` 숨김, 숨긴 칩은 보기 탭에서 점선·흐림). 다크 모드는 `prefers-color-scheme`로 배경/글자만 반전.

- [ ] **Step 1:** 헤더 "패션 브랜드 필터" + `사전 v<version>`.
- [ ] **Step 2:** 보기 탭: 카테고리 칩(단일 선택, 사전 `categories` 순서), 그룹별 브랜드 칩(다중 선택, 숨김 브랜드는 비활성), 선택 별명 요약 `검색 포함: <brand1 searchTerms 쉼표> · <brand2 …>`, 하단 `초기화` / `<N>개 브랜드 · <카테고리명> 보기` (N=0이면 비활성, 문구 `브랜드를 골라주세요`). 선택이 바뀔 때마다 `saveSettings`.
- [ ] **Step 3:** 숨기기 탭: 탭 라벨 `숨기기 · <N>`, 설명 `고른 브랜드는 패션 게시판 목록과 검색 결과에서 보이지 않아요.`, 같은 칩 그리드(빨강), 하단 `모두 해제` / `저장`. 저장 시 `normalizeSettings` 후 저장 → 보기 탭 반영.
- [ ] **Step 4:** 빌드 → 확장 다시 로드 → 확인: (a) 칩 선택이 팝업을 닫았다 열어도 유지 (b) 숨긴 브랜드가 보기 탭에서 선택 불가 (c) 선택된 브랜드를 숨기면 선택에서 빠짐 (d) "보기"가 올바른 쿼리로 새 탭을 연다.
- [ ] **Step 5: Commit** `feat: popup with view/hide tabs`

---

### Task 10: 결과 페이지

**Files:**
- Create: `src/results/results.html`, `src/results/results.css`, `src/results/results.js`
- Test: 수동

**Interfaces:**
- Consumes: `getDictionary`, `loadSettings` (Task 8), `compileMatchers` (Task 3), `buildSearchJobs` (Task 4), `runSearch` (Task 7), `fetchPage` (Task 2), `filterRows`/`mergeRows` (Task 6)

- [ ] **Step 1:** URL 쿼리에서 brands/cat 읽기 → `normalizeSettings` 규칙으로 정리(숨김 브랜드 제거). 상단에 선택 브랜드·카테고리 칩(클릭으로 제거 시 재검색)과 별명 요약.
- [ ] **Step 2:** `buildSearchJobs` → `runSearch(page=1)`. `onRows`마다 `filterRows` → `mergeRows` → 표 다시 그리기(열: 탭, 제목(원글 링크, 새 탭), 댓글, 작성자, 날짜, 조회, 추천, 배지 `hits[].term`). 진행 표시 `<done>/<total> 검색 중 · "<term>"` + `취소` 버튼(AbortController).
- [ ] **Step 3:** `totalTerms > jobs.length`면 `별명 <totalTerms>개 중 <jobs.length>개만 검색했어요.` 표시.
- [ ] **Step 4:** 상태 문구: blocked → Global Constraints 문구, error → `검색 중 오류가 났어요. 다시 시도해 주세요.`, 결과 0 → `조건에 맞는 글이 없어요.`
- [ ] **Step 5:** `더 보기` 버튼 → 같은 jobs로 page+1 `runSearch`, 결과 누적. 자동 추가 로딩 없음.
- [ ] **Step 6:** 캐시: `chrome.storage.session`에 키 `results:<brands 정렬>|<cat>|<hidden 정렬>` → `{ rows, page, savedAt }`, 10분 이내면 요청 없이 표시(새로고침 버튼으로 무시).
- [ ] **Step 7:** 수동 확인 (실제 펨코, 천천히): 스테디에브리웨어+어나더오피스 / 착샷 → 별명 배지 섞인 최신순 목록, 차단 없음; 취소 동작; 더 보기 누적; 10분 내 재열기 시 즉시 표시.
- [ ] **Step 8: Commit** `feat: merged results page`

---

### Task 11: 게시판 목록 숨기기 (content script)

**Files:**
- Create: `src/content/board.js`, `src/lib/boardPage.js`
- Test: `tests/lib/boardPage.test.js` (jsdom, `board-list.html` 픽스처)

**Interfaces:**
- Consumes: `parseListDocument` (Task 5), `compileMatchers`/`matchBrands` (Task 3), `getDictionary`/`loadSettings` (Task 8)
- Produces:
  - `isFashionListUrl(url: string): boolean` — true: `/fashion`, `/fashion?...`, `/index.php?mid=fashion...`(document_srl 없음), `/search.php?mid=fashion...`(document_srl 없음). false: 그 외 모든 경로, 다른 mid, 글 보기(`/<숫자>` 또는 document_srl 있음).
  - `applyHiding(doc: Document, hiddenBrandIds, matchers): { hiddenCount: number }` — 매칭 `tr`에 `data-fmf-hidden="1"` + `display:none`. 목록 테이블 바로 위에 바(`#fmf-bar`) `숨긴 글 <N>개 · 보기`/`다시 숨기기` 토글을 1개만 삽입(재실행 시 중복 없음). N=0이면 바 없음.

- [ ] **Step 1: 테스트 작성**
  - `isFashionListUrl` 표 테스트: `https://www.fmkorea.com/fashion` true, `.../index.php?mid=fashion&category=18910473&page=2` true, `.../search.php?mid=fashion&search_keyword=x` true, `.../10501045295` false, `.../index.php?mid=fashion&document_srl=1` false, `.../index.php?mid=football` false, `.../best` false.
  - `hides matching rows and counts` — 픽스처 DOM에 제목을 하나 `파프터 CS 또 터짐`으로 바꾸고 hidden `['fafter']` → hiddenCount 1, 그 tr이 숨김.
  - `no bar when nothing hidden`
  - `idempotent` — 두 번 호출해도 `#fmf-bar` 1개, hiddenCount 동일.
  - `toggle shows and rehides`
- [ ] **Step 2:** FAIL → **Step 3:** 구현. `board.js`는 `isFashionListUrl(location.href)`이고 숨김 브랜드가 있을 때만 `applyHiding` 실행, `chrome.storage.onChanged`에서 다시 실행(숨김 해제 시 이전 숨김 복원).
- [ ] **Step 4:** PASS (`npx vitest run tests/lib/boardPage.test.js`) + 수동: 파프터 숨김 후 패션 게시판·검색 결과에서 해당 글 사라짐, 바 토글 동작, 다른 게시판엔 영향 없음.
- [ ] **Step 5: Commit** `feat: hide chosen brands on fashion board`

---

### Task 12: 배포 준비

**Files:**
- Create: `scripts/zip.mjs`, `STORE.md`, `README.md`
- Modify: `package.json` (zip 스크립트), `src/icons/*` (최종 아이콘)

- [ ] **Step 1:** `STORE.md`: 한 줄 설명, 상세 설명(범위: 패션 게시판 목록·검색 결과 / 확장 결과 페이지), 권한별 사용 이유, 개인정보 고지 `이 확장 프로그램은 어떤 개인 정보도 수집하거나 외부로 전송하지 않습니다. 설정은 브라우저에만 저장되며, 브랜드 사전 파일을 GitHub에서 내려받는 것 외의 네트워크 요청은 fmkorea.com 검색뿐입니다.`
- [ ] **Step 2:** `README.md`: 설치/빌드/테스트, 사전 기여 방법(`dictionary/brands.json` PR), 스키마 요약.
- [ ] **Step 3:** `npm test` 전체 PASS, `npm run build && npm run zip` → zip 생성 확인.
- [ ] **Step 4:** GitHub 저장소 `gaeeeguri/fmfashion`(public) 생성 및 push — **사용자에게 확인 후에만**. push 후 원격 사전 URL이 200을 반환하는지 `curl -sI` 확인.
- [ ] **Step 5: Commit** `chore: store listing and packaging`
