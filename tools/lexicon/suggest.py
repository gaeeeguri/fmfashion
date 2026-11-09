"""Suggestions for the brand review page: close spellings of each brand and the words that follow it (products).

python tools/lexicon/suggest.py --posts data/combined/crawl/posts.jsonl --review data/review/brands-review.tsv --out data/review/suggestions.json
"""
import argparse
import csv
import json
import re
import sys
from collections import Counter
from difflib import SequenceMatcher
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from score import general_frequency  # noqa: E402

JOSA = sorted(
    "은 는 이 가 을 를 의 에 도 로 으로 과 와 랑 이랑 에서 까지 만 보다 처럼 이나 나 하고 께서 한테 에게 부터 이라 라 인데 이고 꺼 거".split(),
    key=len,
    reverse=True,
)
TOKEN = re.compile(r"[가-힣A-Za-z0-9]+")


# particles that also end ordinary words (워커데이, 바이가, 알로) are dropped only when the stem is a word on its own
AMBIGUOUS = {"이", "가", "로", "과", "와", "나", "라", "만", "꺼", "거", "이라", "인데", "이고"}


def strip_josa(tok: str, vocab: set | None = None) -> str:
    """Drop a trailing particle."""
    for j in JOSA:
        if not tok.endswith(j) or len(tok) - len(j) < 2:
            continue
        if vocab is None or j not in AMBIGUOUS or tok[: -len(j)] in vocab:
            return tok[: -len(j)]
    return tok


def raw_vocab(posts: list[dict]) -> set:
    return {t for p in posts for t in TOKEN.findall(_text(p))}


def _text(p: dict) -> str:
    return f"{p.get('title') or ''}\n{p.get('text') or ''}".lower()


def token_counts(posts: list[dict]) -> Counter:
    vocab = raw_vocab(posts)
    c: Counter = Counter()
    for p in posts:
        for t in TOKEN.findall(_text(p)):
            c[strip_josa(t, vocab)] += 1
    return c


def _jamo(s: str) -> str:
    out = []
    for ch in s:
        code = ord(ch) - 0xAC00
        if 0 <= code < 11172:
            out += [chr(0x1100 + code // 588), chr(0x1161 + code % 588 // 28)]
            if code % 28:
                out.append(chr(0x11A7 + code % 28))
        else:
            out.append(ch)
    return "".join(out)


def variants(terms: list[str], counts: Counter, min_ratio: float = 0.6, is_word=lambda t: True,
             taken: set = frozenset()) -> list[tuple[str, int]]:
    """Tokens spelled close to one of the terms (compared letter by letter in jamo), closest first.
    is_word drops verb forms (먹고, 없어); taken holds other brands' terms."""
    known = {t.lower() for t in terms} | set(taken)
    js = [(_jamo(t.lower()), len(t)) for t in terms]
    out = []
    for tok, n in counts.items():
        # everyday words (사이즈, 박스) are near some brand by chance; brands and slang are rare in general text
        if tok in known or len(tok) < 2 or general_frequency(tok) > 1e-6:
            continue
        jt = _jamo(tok)
        best = max((SequenceMatcher(None, jt, j).ratio() for j, L in js if abs(len(tok) - L) <= 2), default=0)
        if best >= min_ratio and is_word(tok):
            out.append((tok, n, best))
    out.sort(key=lambda x: (-round(x[2], 1), -x[1], x[0]))
    return [(t, n) for t, n, _ in out]


def follow_words(terms: list[str], posts: list[dict], top: int = 12) -> list[tuple[str, int]]:
    """The word right after a brand mention (product names show up here), most frequent first."""
    alt = "|".join(re.escape(t.lower()) for t in sorted(terms, key=len, reverse=True))
    rx = re.compile(rf"(?:{alt})(?:{'|'.join(JOSA)})?[\s,/]+([가-힣A-Za-z0-9]+)")
    vocab = raw_vocab(posts)
    c: Counter = Counter()
    for p in posts:
        for m in rx.finditer(_text(p)):
            c[strip_josa(m.group(1), vocab)] += 1
    known = {t.lower() for t in terms}
    return [(w, n) for w, n in c.most_common() if w not in known][:top]


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--posts", required=True)
    ap.add_argument("--review", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args(argv)
    posts = [json.loads(l) for l in open(a.posts, encoding="utf-8")]
    counts = token_counts(posts)
    with open(a.review, encoding="utf-8", newline="") as f:
        rows = list(csv.DictReader(f, delimiter="\t"))
    from kiwipiepy import Kiwi

    kiwi = Kiwi()

    def is_word(tok: str) -> bool:
        # one noun-like piece (or a run of them) and nothing verb-like: 수에엑 yes, 먹고 / 입어봤어요 no
        toks = kiwi.tokenize(tok)
        return bool(toks) and all(t.tag in {"NNG", "NNP", "SL", "SN", "NA", "UN", "XR"} for t in toks)

    terms_of = {r["id"]: [t.strip() for t in (r.get("검색어") or "").split(";") if t.strip()] for r in rows}
    all_terms = {t.lower() for ts in terms_of.values() for t in ts}
    out = {}
    for r in rows:
        terms = terms_of[r["id"]]
        if terms:
            out[r["id"]] = {
                "variants": [v for v in variants(terms, counts, is_word=is_word, taken=all_terms) if v[1] >= 2][:12],
                "follow": [w for w in follow_words(terms, posts) if w[1] >= 2],
            }
    Path(a.out).write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
    print(f"{a.out}: {len(out)} brands")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
