# 펨코 패션 브랜드 필터

에펨코리아 패션 게시판용 크롬 확장 프로그램(MV3). 브랜드 별명 사전을 기반으로 클릭만으로 브랜드별 글을 모아 보고, 원하지 않는 브랜드는 숨깁니다.

## 개발

```bash
npm install
npm test          # vitest
npm run build     # → dist/
npm run zip       # → fmfashion-<version>.zip (웹스토어 업로드용)
```

파서·실행기 테스트 일부는 펨코 페이지 스냅샷(`tests/fixtures/*.html`)을 씁니다. 다른 사용자 닉네임이 들어 있어 저장소에는 포함하지 않으며, 파일이 없으면 해당 테스트는 건너뜁니다(`tests/lib/fixtures.js` 참고: `board-list.html`, `search-result.html`, `search-empty.html`, `blocked-430.html`).

크롬 `chrome://extensions` → 개발자 모드 → "압축해제된 확장 프로그램 로드" → `dist/` 선택.

## 브랜드 사전

`dictionary/brands.json`이 공유 사전입니다. 확장 프로그램은 하루 한 번
`https://raw.githubusercontent.com/gaeeeguri/fmfashion/main/dictionary/brands.json`을 받아,
`updatedAt`이 더 새롭고 형식이 올바르면 교체합니다. 번들 사본은 최초 실행/오프라인용입니다.

새 별명이나 브랜드는 이 파일을 고치는 PR로 제보해 주세요. 수정할 때는 `updatedAt`을 올려야 사용자에게 반영됩니다.

| 필드 | 설명 |
|---|---|
| `categories[].ids` | 칩 하나에 묶이는 펨코 탭 category ID들 (빈 배열 = 전체) |
| `categories[].excludeIds` | 해당 칩에서 뺄 탭 ID |
| `brands[].searchTerms` | 펨코 검색에 쓰는 평문 별명. 앞쪽일수록 먼저 검색됨 |
| `brands[].matchPatterns` | 제목 매칭용 정규식 (`iu` 플래그). 숨기기·결과 재필터에 사용 |
| `brands[].exclude` | 이 브랜드 검색 시 항상 `!`로 붙일 단어 (예: 파프 → 파프터) |

`npm test`가 사전 형식을 검사합니다.

## 구조

- `src/lib/` — 순수 로직 (사전 검증, 매처, 검색어 생성, 파서, 병합, 토큰 버킷, 병렬 실행기, 검색 세션, `#fmf` 상태, 결과 화면, 저장소)
- `src/ui/panel.js` · `panel.css` — 보기/숨기기 패널 (툴바 팝업과 페이지 배지가 같이 씀)
- `src/ui/badge.js` — 패션 게시판 페이지 오른쪽 아래 떠 있는 `필터` 배지 (Shadow DOM, 펼침 상태 기억)
- `src/popup/` — 툴바 팝업. `보기`는 펨코 탭을 `fmkorea.com/fashion#fmf=…`로 이동
- `src/content/board.js` — 패션 게시판 목록·글 화면:
  - `#fmf=b:<브랜드>;c:<카테고리>` → 목록(또는 글 아래 목록) 자리에 합쳐진 결과, 무한 스크롤
  - `#fmf=b:;c:<카테고리>` → 브랜드 없이 숨긴 브랜드만 뺀 카테고리 목록
  - 해시 없음 → 목록 화면에서 숨김 브랜드 숨기기
- `src/background/sw.js` — 사전 갱신
- 설계: `docs/superpowers/specs/`, 계획: `docs/superpowers/plans/`
