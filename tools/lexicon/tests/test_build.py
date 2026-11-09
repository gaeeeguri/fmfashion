import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from build import main  # noqa: E402

POSTS = [
    ("1", "100", "질문", "얼저고 바지 사이즈 어떤가요"),
    ("2", "100", "질문", "얼저고 셔츠 샀는데 좋네요"),
    ("3", "100", "질문", "요즘 얼저고 인기 많네"),
    ("4", "200", "자유", "블랙야크 패딩 따뜻함"),
    ("5", "200", "자유", "블랙야크 플리스 추천"),
    ("6", "200", "자유", "블랙야크 할인 중이네요"),
]


def make_data(tmp: Path, known: str | None = None) -> Path:
    crawl = tmp / "crawl"
    crawl.mkdir(parents=True)
    with open(crawl / "posts.jsonl", "w") as f:
        for doc_id, cat_id, cat, text in POSTS:
            rec = {"docId": doc_id, "categoryId": cat_id, "categoryName": cat, "title": "t",
                   "text": text, "imgCount": 0, "date": None, "status": 200, "fetchedAt": 1000 * int(doc_id)}
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
    with open(crawl / "requests.jsonl", "w") as f:
        for status in (200, 429, 200):
            f.write(json.dumps({"t": 1000, "kind": "post", "status": status, "ms": 100}) + "\n")
    (crawl / "state.json").write_text(json.dumps({"stopReason": None}))
    if known is not None:
        (tmp / "lexicon").mkdir()
        (tmp / "lexicon" / "known.txt").write_text(known)
    return tmp


def run(tmp: Path) -> tuple[list, str]:
    main(["--data", str(tmp), "--upto", "6", "--label", "t", "--brands", str(tmp / "none.json")])
    lex = json.loads((tmp / "lexicon" / "lexicon-t.json").read_text())
    report = (tmp / "reports" / "checkpoint-t.md").read_text()
    return lex, report


def test_lexicon_has_both_brands_with_df_3(tmp_path):
    lex, _ = run(make_data(tmp_path))
    by_form = {it["form"]: it for it in lex}
    assert by_form["얼저고"]["df"] == 3
    assert by_form["블랙야크"]["df"] == 3
    assert by_form["블랙야크"]["byCategory"] == {"자유": 3}
    assert all(it["df"] >= 3 for it in lex)
    assert [it["keyness"] for it in lex] == sorted((it["keyness"] for it in lex), reverse=True)


def test_report_counts_429_and_has_no_previous(tmp_path):
    _, report = run(make_data(tmp_path))
    assert "429: 1" in report
    assert "이전 없음" in report


def test_known_term_found_in_recall(tmp_path):
    _, report = run(make_data(tmp_path, known="얼저고\n없는브랜드\n"))
    recall = report.split("## 3.")[1].split("## 4.")[0]
    assert "1/2" in recall
    assert "없는브랜드" in recall.split("놓친")[1]


def test_stop_list_removes_form(tmp_path):
    make_data(tmp_path)
    (tmp_path / "lexicon").mkdir()
    (tmp_path / "lexicon" / "stop.txt").write_text("블랙야크\n")
    lex, _ = run(tmp_path)
    assert "블랙야크" not in {it["form"] for it in lex}


def test_second_build_reports_overlap_with_previous(tmp_path):
    make_data(tmp_path)
    main(["--data", str(tmp_path), "--upto", "6", "--label", "a", "--brands", str(tmp_path / "none.json")])
    _, report = run(tmp_path)
    assert "이전 없음" not in report
    assert "lexicon-a.json" in report
