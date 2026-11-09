"""Build the word lexicon and a checkpoint report from crawled posts (spec §4.5, §4.6).

python tools/lexicon/build.py --data data --upto 20000 --label 20000
"""
import argparse
import json
import statistics
import sys
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from kiwipiepy import Kiwi  # noqa: E402

from candidates import candidates  # noqa: E402
from normalize import normalize  # noqa: E402
from score import keyness  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
KST = timezone(timedelta(hours=9))
MIN_DF = 3
TOP_REPORT = 100
TOP_RECALL = 500
TOP_STABLE = 200


def read_jsonl(path: Path, limit: int | None = None) -> list[dict]:
    out = []
    if not path.exists():
        return out
    with open(path, encoding="utf-8") as f:
        for line in f:
            if limit is not None and len(out) >= limit:
                break
            try:
                out.append(json.loads(line))
            except json.JSONDecodeError:
                continue  # a torn last line from an interrupted write
    return out


def read_lines(path: Path) -> list[str]:
    if not path.exists():
        return []
    return [s for s in (line.strip() for line in path.read_text(encoding="utf-8").splitlines()) if s]


def example(text: str, form: str) -> str | None:
    i = text.find(form)
    if i < 0:
        return None
    return text[max(0, i - 20): i + len(form) + 20].replace("\n", " ")


def build_lexicon(posts: list[dict], stop: set[str], alpha: float, beta: float) -> tuple[list[dict], list[set]]:
    kiwi = Kiwi()
    df: Counter = Counter()
    count: Counter = Counter()
    tags: dict = defaultdict(set)
    by_cat: dict = defaultdict(Counter)
    examples: dict = defaultdict(list)
    per_post: list[set] = []
    for p in posts:
        text = normalize(p.get("text") or "")
        cands = candidates(kiwi, text)
        forms = set()
        for form, tag in cands:
            count[form] += 1
            tags[form].add(tag)
            forms.add(form)
        for form in forms:
            df[form] += 1
            by_cat[form][p.get("categoryName") or "?"] += 1
            if len(examples[form]) < 3:
                ex = example(text, form)
                if ex:
                    examples[form].append(ex)
        per_post.append(forms)

    n = len(posts)
    items = [
        {
            "form": form,
            "tags": sorted(tags[form]),
            "count": count[form],
            "df": d,
            "keyness": round(keyness(d, n, form, alpha, beta), 4),
            "byCategory": dict(by_cat[form].most_common()),
            "examples": examples[form],
        }
        for form, d in df.items()
        if d >= MIN_DF and form not in stop
    ]
    items.sort(key=lambda it: (-it["keyness"], -it["df"], it["form"]))
    return items, per_post


def known_terms(brands_path: Path, known_path: Path) -> list[str]:
    terms: list[str] = []
    if brands_path.exists():
        for b in json.loads(brands_path.read_text(encoding="utf-8")).get("brands", []):
            terms += b.get("searchTerms", [])
    terms += read_lines(known_path)
    seen, out = set(), []
    for t in (normalize(x) for x in terms):
        if t and t not in seen:
            seen.add(t)
            out.append(t)
    return out


def previous_lexicon(lex_dir: Path, current: Path) -> Path | None:
    others = [p for p in lex_dir.glob("lexicon-*.json") if p.resolve() != current.resolve()]
    return max(others, key=lambda p: p.stat().st_mtime) if others else None


def pct(a: float, b: float) -> str:
    return f"{100 * a / b:.1f}%" if b else "-"


def section_crawl(posts_all: list[dict], posts: list[dict], requests: list[dict], state: dict) -> list[str]:
    statuses = Counter(r.get("status") for r in requests)
    http_err = sum(c for s, c in statuses.items() if isinstance(s, int) and s not in (200, 429, 430))
    lines = ["## 1. 수집", ""]
    lines.append(f"- 글: {len(posts_all)}건 (본문 인식 {len(posts)}건, 미인식 {pct(len(posts_all) - len(posts), len(posts_all))})")
    if requests:
        elapsed = (requests[-1]["t"] - requests[0]["t"]) / 1000
        rate = len(posts_all) / elapsed if elapsed > 0 else 0
        lines.append(f"- 요청: {len(requests)}건 · 경과 {elapsed / 3600:.2f}시간 · 실제 {rate:.2f}글/초")
    lines.append(
        f"- 429: {statuses.get(429, 0)} · 차단(430): {statuses.get(430, 0)} · network: {statuses.get('network', 0)}"
        f" · timeout: {statuses.get('timeout', 0)} · http-error: {http_err}"
    )
    short = sum(1 for p in posts if len((p.get("text") or "").strip()) < 10)
    lines.append(f"- 10자 미만 본문: {pct(short, len(posts))}")
    if state.get("stopReason"):
        lines.append(f"- 마지막 종료 사유: {state['stopReason']}")
    hours: dict = defaultdict(list)
    for r in requests:
        if isinstance(r.get("ms"), (int, float)):
            hours[datetime.fromtimestamp(r["t"] / 1000, KST).strftime("%m-%d %H시")].append(r["ms"])
    if hours:
        lines += ["", "| 시간(KST) | 요청 | 중앙값 ms | p95 ms |", "|---|---|---|---|"]
        for h, ms in sorted(hours.items()):
            ms.sort()
            p95 = ms[min(len(ms) - 1, int(0.95 * len(ms)))]
            lines.append(f"| {h} | {len(ms)} | {statistics.median(ms):.0f} | {p95} |")
    return lines + [""]


def section_top(items: list[dict]) -> list[str]:
    lines = [f"## 2. 상위 후보 {TOP_REPORT}", "", "| # | 단어 | 글 수 | keyness | 가장 많은 카테고리 |", "|---|---|---|---|---|"]
    for i, it in enumerate(items[:TOP_REPORT], 1):
        top_cat = next(iter(it["byCategory"]), "-")
        lines.append(f"| {i} | {it['form']} | {it['df']} | {it['keyness']:.2f} | {top_cat} |")
    return lines + [""]


def section_recall(items: list[dict], known: list[str]) -> list[str]:
    top = {it["form"] for it in items[:TOP_RECALL]}
    found = [t for t in known if t in top]
    missed = [t for t in known if t not in top]
    return [
        "## 3. 알려진 브랜드 재현율",
        "",
        f"- 상위 {TOP_RECALL}개 안에서 찾음: {len(found)}/{len(known)} ({pct(len(found), len(known))})",
        f"- 찾음: {', '.join(found) or '없음'}",
        f"- 놓친: {', '.join(missed) or '없음'}",
        "",
    ]


def section_stability(items: list[dict], prev: Path | None) -> list[str]:
    lines = ["## 4. 안정성", ""]
    if prev is None:
        return lines + ["- 이전 없음", ""]
    old = [it["form"] for it in json.loads(prev.read_text(encoding="utf-8"))[:TOP_STABLE]]
    new = {it["form"] for it in items[:TOP_STABLE]}
    shared = sum(1 for f in old if f in new)
    return lines + [f"- 상위 {TOP_STABLE}개 중 {prev.name}와 겹침: {shared}/{max(len(old), 1)} ({pct(shared, len(old))})", ""]


def section_categories(posts: list[dict], per_post: list[set], items: list[dict]) -> list[str]:
    top = {it["form"] for it in items[:TOP_RECALL]}
    agg: dict = defaultdict(lambda: [0, 0])
    for p, forms in zip(posts, per_post):
        a = agg[p.get("categoryName") or "?"]
        a[0] += 1
        a[1] += len(forms & top)
    lines = ["## 5. 카테고리별 글당 후보 언급 수", "", "| 카테고리 | 글 | 글당 후보 |", "|---|---|---|"]
    for cat, (n, m) in sorted(agg.items(), key=lambda kv: -kv[1][1] / kv[1][0]):
        lines.append(f"| {cat} | {n} | {m / n:.2f} |")
    return lines + [""]


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--upto", type=int, required=True)
    ap.add_argument("--label", required=True)
    ap.add_argument("--alpha", type=float, default=0.0)
    ap.add_argument("--beta", type=float, default=1e-6)
    ap.add_argument("--brands", default=str(ROOT / "dictionary" / "brands.json"))
    a = ap.parse_args(argv)

    data = Path(a.data)
    lex_dir, rep_dir = data / "lexicon", data / "reports"
    lex_dir.mkdir(parents=True, exist_ok=True)
    rep_dir.mkdir(parents=True, exist_ok=True)

    posts_all = read_jsonl(data / "crawl" / "posts.jsonl", a.upto)
    posts = [p for p in posts_all if not p.get("unrecognized")]
    requests = read_jsonl(data / "crawl" / "requests.jsonl")
    state_path = data / "crawl" / "state.json"
    state = json.loads(state_path.read_text()) if state_path.exists() else {}
    stop = {normalize(s) for s in read_lines(lex_dir / "stop.txt")}

    items, per_post = build_lexicon(posts, stop, a.alpha, a.beta)
    out = lex_dir / f"lexicon-{a.label}.json"
    prev = previous_lexicon(lex_dir, out)
    out.write_text(json.dumps(items, ensure_ascii=False, indent=1), encoding="utf-8")

    known = known_terms(Path(a.brands), lex_dir / "known.txt")
    now = datetime.now(KST).strftime("%Y-%m-%d %H:%M")
    report = [f"# 점검 보고서 — {a.label} ({len(posts)}글, {now} KST)", ""]
    report += section_crawl(posts_all, posts, requests, state)
    report += section_top(items)
    report += section_recall(items, known)
    report += section_stability(items, prev)
    report += section_categories(posts, per_post, items)
    path = rep_dir / f"checkpoint-{a.label}.md"
    path.write_text("\n".join(report), encoding="utf-8")
    print(f"lexicon {out} ({len(items)} words) · report {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
