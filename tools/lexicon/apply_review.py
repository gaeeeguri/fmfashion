"""Apply the reviewed brand table to dictionary/brands.json (Phase 2-B).

Only rows whose 결정 is "y" become brands. Without --write it only prints what would change.

python tools/lexicon/apply_review.py --review data/review/brands-review.tsv --groups data/review/groups.tsv [--write]
"""
import argparse
import csv
import json
import re
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
KST = timezone(timedelta(hours=9))
HEADER = ["결정", "id", "이름", "영문", "그룹", "검색어", "패턴", "제외", "글수", "확신", "메모", "예문"]
DECISIONS = {"y", "n", "?", ""}
ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]*$")
JS_SYNTAX = set("^$\\.*+?()[]{}|/")  # the only characters JS allows escaping under the u flag


def split_list(cell: str) -> list[str]:
    return [s.strip() for s in (cell or "").split(";") if s.strip()]


def _escape(s: str) -> str:
    return "".join("\\" + c if c in JS_SYNTAX else c for c in s)


def patterns_for(terms: list[str]) -> list[str]:
    out = []
    for t in terms:
        p = r"\s?".join(_escape(part) for part in t.split())
        if re.search(r"[0-9A-Za-z]", t):  # rrl must not hit carrlot; 649 must not hit 2649 or a price like 649,000
            p = rf"(?<![0-9A-Za-z])(?<!\d[,.]){p}(?![0-9A-Za-z])(?![,.]\d)"
        out.append(p)
    return out


def bad_js_patterns(patterns: list[str]) -> set[str]:
    """Compile with the extension's flags ('iu') in node; returns the patterns that fail."""
    js = "const ps=JSON.parse(require('fs').readFileSync(0,'utf8'));const bad=[];" \
         "for(const p of ps){try{new RegExp(p,'iu')}catch{bad.push(p)}}process.stdout.write(JSON.stringify(bad))"
    r = subprocess.run(["node", "-e", js], input=json.dumps(patterns), capture_output=True, text=True, check=True)
    return set(json.loads(r.stdout))


def read_tsv(path: Path) -> list[dict]:
    with open(path, encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f, delimiter="\t"))


def build(rows: list[dict], groups: list[dict], current: dict) -> tuple[list[dict], list[str]]:
    errors: list[str] = []
    group_ids = {g["id"] for g in groups}
    old = {b["id"]: b for b in current["brands"]}
    brands, seen_ids, term_owner = [], set(), {}
    for n, r in enumerate(rows, start=2):
        decision = (r.get("결정") or "").strip().lower()
        where = f"{n}행 {r.get('이름') or r.get('id')}"
        if decision not in DECISIONS:
            errors.append(f"{where}: 결정은 y / n / ? 중 하나여야 합니다 ('{decision}')")
            continue
        if decision != "y":
            continue
        bid = (r.get("id") or "").strip()
        terms = split_list(r.get("검색어"))
        if not ID_RE.match(bid):
            errors.append(f"{where}: id는 영문 소문자·숫자·하이픈만 ('{bid}')")
        if bid in seen_ids:
            errors.append(f"{where}: 중복 id '{bid}'")
        seen_ids.add(bid)
        if (r.get("그룹") or "").strip() not in group_ids:
            errors.append(f"{where}: 그룹 '{r.get('그룹')}'이 groups.tsv에 없습니다")
        if not terms:
            errors.append(f"{where}: 검색어가 비어 있습니다")
        for t in terms:
            k = t.lower()
            if k in term_owner and term_owner[k] != bid:
                errors.append(f"{where}: 검색어 '{t}'가 '{term_owner[k]}'와 겹칩니다")
            term_owner.setdefault(k, bid)
        brand = {
            "id": bid,
            "name": (r.get("이름") or "").strip(),
            "nameEn": (r.get("영문") or "").strip() or None,
            "group": (r.get("그룹") or "").strip(),
            "searchTerms": terms,
            "matchPatterns": split_list(r.get("패턴")) or patterns_for(terms),
            "exclude": split_list(r.get("제외")) or None,
            "note": old.get(bid, {}).get("note"),
        }
        brands.append({k: v for k, v in brand.items() if v is not None})
    bad = bad_js_patterns([p for b in brands for p in b["matchPatterns"]])
    for b in brands:
        for p in b["matchPatterns"]:
            if p in bad:
                errors.append(f"{b['name']}: 패턴 '{p}'이 브라우저 정규식으로 잘못되었습니다")
    # keep the current order for brands already in the dictionary, then the new ones in table order
    order = {bid: i for i, bid in enumerate(old)}
    brands.sort(key=lambda b: order.get(b["id"], len(order)))
    return brands, errors


def summary(current: dict, brands: list[dict], groups: list[dict]) -> list[str]:
    old = {b["id"]: b for b in current["brands"]}
    new = {b["id"]: b for b in brands}
    added = [b["name"] for i, b in new.items() if i not in old]
    removed = [b["name"] for i, b in old.items() if i not in new]
    bare = lambda b: {k: v for k, v in b.items() if v not in ([], None, "")}  # noqa: E731
    changed = [b["name"] for i, b in new.items() if i in old and bare(b) != bare(old[i])]
    by_group = {g["id"]: 0 for g in groups}
    for b in brands:
        by_group[b["group"]] = by_group.get(b["group"], 0) + 1
    return [
        f"브랜드 {len(old)} → {len(new)}",
        f"추가 {len(added)}: {', '.join(added) or '-'}",
        f"삭제 {len(removed)}: {', '.join(removed) or '-'}",
        f"변경 {len(changed)}: {', '.join(changed) or '-'}",
        "그룹: " + ", ".join(f"{g['이름']}({by_group[g['id']]})" for g in groups),
    ]


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--review", required=True)
    ap.add_argument("--groups", required=True)
    ap.add_argument("--dict", default=str(ROOT / "dictionary" / "brands.json"))
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--today", help="YYYY-MM-DD (tests)")
    a = ap.parse_args(argv)

    dict_path = Path(a.dict)
    current = json.loads(dict_path.read_text(encoding="utf-8"))
    groups = read_tsv(Path(a.groups))
    brands, errors = build(read_tsv(Path(a.review)), groups, current)
    for line in summary(current, brands, groups):
        print(line)
    if errors:
        print(f"\n오류 {len(errors)}건 — brands.json은 바꾸지 않았습니다:")
        for e in errors:
            print(f"- {e}")
        return 1
    if not a.write:
        print("\n(미리보기) 반영하려면 --write")
        return 0
    now = datetime.fromisoformat(a.today).replace(tzinfo=KST) if a.today else datetime.now(KST)
    out = {
        **current,
        "version": now.strftime("%Y.%m.%d"),
        "updatedAt": now.replace(microsecond=0).isoformat(),
        "groups": [{"id": g["id"], "name": g["이름"]} for g in groups],
        "brands": brands,
    }
    dict_path.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"\n{dict_path} 저장")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
