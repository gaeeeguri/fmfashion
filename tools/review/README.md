# 브랜드 검토 화면 (Phase 2-B)

사전 후보에서 고른 브랜드 표(`data/review/brands-review.tsv`)를 브라우저에서 검토하고 `dictionary/brands.json`에 반영한다.
표에는 다른 사용자의 글 일부(예문)가 들어 있으므로 `data/` 아래에만 두고, 화면은 이 맥(127.0.0.1)에서만 연다.

```sh
tools/lexicon/.venv/bin/python tools/lexicon/suggest.py --posts data/combined/crawl/posts.jsonl \
  --review data/review/brands-review.tsv --out data/review/suggestions.json   # 변형·제품 후보 (선택)
npm run review        # → http://127.0.0.1:47824
```

- 카드마다 넣기 / 보류 / 빼기, 그룹, 검색어(첫 칩이 대표), 제외어를 고친다. 변형·제품 후보는 클릭하면 검색어에 들어간다.
- **미리보기**: 추가·삭제·변경과 오류(없는 그룹, 겹치는 검색어, 잘못된 정규식)를 보여 준다. 파일은 바꾸지 않는다.
- **brands.json에 반영**: 넣기(y)인 브랜드만 저장하고 익스텐션 테스트(`tests/lib`)를 돌린다. 커밋은 따로 한다.
