import json
import re
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from apply_review import HEADER, main, patterns_for  # noqa: E402

DICT = {
    "schemaVersion": 1,
    "version": "2026.11.02",
    "updatedAt": "2026-11-02T00:00:00+09:00",
    "categories": [{"key": "all", "name": "전체", "ids": []}],
    "groups": [{"id": "street", "name": "스트릿"}],
    "brands": [
        {"id": "paf", "name": "PAF", "group": "street", "searchTerms": ["파프"],
         "matchPatterns": ["파프(?!터)"], "exclude": ["파프터"]},
        {"id": "old", "name": "올드", "group": "street", "searchTerms": ["올드"], "matchPatterns": ["올드"]},
    ],
}


def row(**kw):
    base = {h: "" for h in HEADER}
    base.update(kw)
    return "\t".join(base[h] for h in HEADER)


def setup(tmp: Path, rows: list[str], groups: list[tuple[str, str]]):
    (tmp / "review.tsv").write_text("\n".join(["\t".join(HEADER), *rows]) + "\n", encoding="utf-8")
    (tmp / "groups.tsv").write_text("id\t이름\n" + "".join(f"{a}\t{b}\n" for a, b in groups), encoding="utf-8")
    (tmp / "brands.json").write_text(json.dumps(DICT, ensure_ascii=False), encoding="utf-8")
    return ["--review", str(tmp / "review.tsv"), "--groups", str(tmp / "groups.tsv"), "--dict", str(tmp / "brands.json")]


def load(tmp: Path):
    return json.loads((tmp / "brands.json").read_text(encoding="utf-8"))


def test_auto_patterns_escape_korean_and_guard_latin():
    assert patterns_for(["러프사이드", "렆사"]) == ["러프사이드", "렆사"]
    assert patterns_for(["랄프 로렌"]) == ["랄프\\s?로렌"]
    assert patterns_for(["rrl"]) == ["(?<![0-9A-Za-z])rrl(?![0-9A-Za-z])"]
    assert patterns_for(["no.5"]) == ["(?<![0-9A-Za-z])no\\.5(?![0-9A-Za-z])"]
    assert patterns_for(["808"]) == ["(?<![0-9A-Za-z])808(?![0-9A-Za-z])"]


def test_only_y_rows_are_written_and_existing_order_is_kept(tmp_path):
    args = setup(tmp_path, [
        row(결정="y", id="paf", 이름="PAF", 그룹="street", 검색어="파프", 패턴="파프(?!터)", 제외="파프터"),
        row(결정="y", id="roughside", 이름="러프사이드", 영문="roughside", 그룹="amekaji", 검색어="러프사이드;렆사"),
        row(결정="?", id="maybe", 이름="마원", 그룹="street", 검색어="마원"),
        row(결정="n", id="old", 이름="올드", 그룹="street", 검색어="올드"),
    ], [("street", "스트릿"), ("amekaji", "아메카지")])
    assert main(args + ["--write", "--today", "2026-11-05"]) == 0
    d = load(tmp_path)
    assert [b["id"] for b in d["brands"]] == ["paf", "roughside"]
    rough = d["brands"][1]
    assert rough["searchTerms"] == ["러프사이드", "렆사"]
    assert rough["matchPatterns"] == ["러프사이드", "렆사"]
    assert rough["nameEn"] == "roughside"
    assert d["brands"][0]["exclude"] == ["파프터"]
    assert [g["id"] for g in d["groups"]] == ["street", "amekaji"]
    assert d["version"] == "2026.11.05"
    assert d["updatedAt"].startswith("2026-11-05")
    assert d["categories"] == DICT["categories"]


def test_dry_run_reports_changes_and_leaves_file_alone(tmp_path, capsys):
    args = setup(tmp_path, [
        row(결정="y", id="paf", 이름="PAF", 그룹="street", 검색어="파프", 패턴="파프(?!터)", 제외="파프터"),
        row(결정="y", id="new", 이름="새것", 그룹="street", 검색어="새것"),
    ], [("street", "스트릿")])
    assert main(args) == 0
    out = capsys.readouterr().out
    assert "추가 1" in out and "새것" in out
    assert "삭제 1" in out and "올드" in out
    assert load(tmp_path) == DICT


@pytest.mark.parametrize("bad, message", [
    (row(결정="y", id="x", 이름="엑스", 그룹="nope", 검색어="엑스"), "그룹"),
    (row(결정="y", id="Bad Id", 이름="엑스", 그룹="street", 검색어="엑스"), "id"),
    (row(결정="y", id="x", 이름="엑스", 그룹="street", 검색어=""), "검색어"),
    (row(결정="y", id="x", 이름="엑스", 그룹="street", 검색어="엑스", 패턴="("), "패턴"),
    (row(결정="maybe", id="x", 이름="엑스", 그룹="street", 검색어="엑스"), "결정"),
])
def test_invalid_rows_stop_without_writing(tmp_path, capsys, bad, message):
    args = setup(tmp_path, [bad], [("street", "스트릿")])
    assert main(args + ["--write"]) == 1
    assert message in capsys.readouterr().out
    assert load(tmp_path) == DICT


def test_duplicate_ids_and_shared_search_terms_are_errors(tmp_path, capsys):
    args = setup(tmp_path, [
        row(결정="y", id="a", 이름="에이", 그룹="street", 검색어="같은말"),
        row(결정="y", id="a", 이름="에이2", 그룹="street", 검색어="다른말"),
        row(결정="y", id="b", 이름="비", 그룹="street", 검색어="같은말"),
    ], [("street", "스트릿")])
    assert main(args + ["--write"]) == 1
    out = capsys.readouterr().out
    assert "중복 id" in out and "같은말" in out


def test_generated_patterns_match_their_terms_in_titles():
    for terms, title in [(["랄프 로렌"], "랄프로렌 셔츠"), (["rrl"], "RRL 데님 후기"), (["렆사"], "렆사 워크자켓")]:
        assert any(re.search(p, title, re.I) for p in patterns_for(terms))
    assert not any(re.search(p, "carrlot", re.I) for p in patterns_for(["rrl"]))
    assert not any(re.search(p, "2808 사이즈", re.I) for p in patterns_for(["808"]))
    assert any(re.search(p, "킨치 808 후기", re.I) for p in patterns_for(["808"]))


def test_an_empty_exclude_list_is_not_a_change(tmp_path, capsys):
    args = setup(tmp_path, [
        row(결정="y", id="paf", 이름="PAF", 그룹="street", 검색어="파프", 패턴="파프(?!터)", 제외="파프터"),
        row(결정="y", id="old", 이름="올드", 그룹="street", 검색어="올드"),
    ], [("street", "스트릿")])
    d = load(tmp_path)
    d["brands"][1]["exclude"] = []
    (tmp_path / "brands.json").write_text(json.dumps(d, ensure_ascii=False), encoding="utf-8")
    assert main(args) == 0
    assert "변경 0" in capsys.readouterr().out
