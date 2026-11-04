# 본문 수집기 (brand dictionary Phase 2-A)

설계: `docs/superpowers/specs/2026-11-04-brand-dictionary-crawl-design.md`

펨코 패션 게시판 최근 글의 본문을 **초당 2건**으로 모은다. 끊기거나 중단돼도 다시 실행하면 이어서 받는다.
수집한 글은 다른 사용자의 글이므로 `data/` 아래에만 두고 git에 넣지 않는다.

## 준비 (한 번)

```sh
npm install
npx playwright install chromium          # 수집 전용 Chromium
python3 -m venv tools/lexicon/.venv
tools/lexicon/.venv/bin/pip install -r tools/lexicon/requirements.txt
```

## 실행

```sh
tmux new -s fmf                           # 터미널을 닫아도 계속 돌게
npm run crawl -- --probe-depth 5000       # 깊은 목록 페이지가 열리는지 1건만 확인
npm run crawl -- --for 1h --until 2026-11-05T09:40:00+09:00   # 파일럿 1시간
npm run crawl -- --until 2026-11-05T09:40:00+09:00            # 밤샘 (같은 명령으로 이어받기)
# 빠져나오기: Ctrl-b d   · 다시 보기: tmux attach -t fmf
```

- 수집용 Chromium 창이 따로 뜬다. 그 창에서 펨코가 보안 페이지나 로그인 화면을 보이면 직접 해결한 뒤 다시 실행한다.
- `run.sh`는 `caffeinate -dims`로 맥이 잠들지 않게 한다. 클램쉘 모드(뚜껑 닫고 외부 모니터 사용)에서는 **모니터 전원을 끄거나 케이블을 뽑지 말 것** — 맥이 바로 잠든다.
- Ctrl-C 한 번: 처리 중인 요청을 끝내고 상태를 저장한 뒤 종료(보고서 없음). 두 번: 즉시 종료.

## 멈추는 조건

| 조건 | 동작 |
|---|---|
| 429 | 모든 요청을 5분 멈춤. 1시간에 3번이면 속도 2 → 1.5 → 1건/초 |
| 430 / 보안 페이지 | 즉시 종료 (자동 재시도 없음) |
| 본문 없는 응답 연속 20번 | 종료. 해당 글은 다음 실행 때 다시 받음 |
| 네트워크 끊김 | 연결될 때까지 기다렸다 같은 요청부터 이어감 |
| `--for` / `--until` / `--target` | 처리 중인 요청을 저장하고 종료 |

## 파일

- `data/crawl/posts.jsonl` 받은 글 (한 줄에 하나, 덧붙이기만 함)
- `data/crawl/state.json` 다음 목록 페이지, 대기 중인 글, 속도 단계, 실행한 점검
- `data/crawl/requests.jsonl` 모든 요청의 결과와 응답 시간
- `data/crawl/crawl.log` 진행 로그
- `data/crawl/config.json` (선택) `{"categories": [null]}` 또는 `{"categories": ["186586204", "4022646597", null]}` — 목록을 받을 순서
- `data/reports/checkpoint-*.md` 점검 보고서 (2만 / 5만 / 10만 / pilot / final)
