import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from suggest import follow_words, strip_josa, token_counts, variants  # noqa: E402

POSTS = [
    {"title": "수에엑 셔츠", "text": "스웨에엑 좋다. 스에엑도 괜찮고 스테디는 무난"},
    {"title": "렆사 후기", "text": "러프사이두 워커데이 샀어요. 렆사 워커데이 바크 색"},
    {"title": "질문", "text": "레드윙 아이언레인저 vs 레드윙 목토, 레드윙의 아이언레인저 사이즈"},
]


def test_strip_josa_removes_trailing_particles_only():
    assert strip_josa("렆사는") == "렆사"
    assert strip_josa("러프사이드에서") == "러프사이드"
    assert strip_josa("스테디") == "스테디"
    assert strip_josa("는") == "는"


def test_token_counts_count_stems_across_title_and_text():
    c = token_counts(POSTS)
    assert c["렆사"] == 2
    assert c["스테디"] == 1
    assert c["레드윙"] == 3


def test_variants_find_close_spellings_not_already_listed():
    c = token_counts(POSTS)
    v = dict(variants(["스테디에브리웨어", "스테디", "스에웨", "스웨에"], c))
    assert "수에엑" in v and "스에엑" in v and "스웨에엑" in v
    assert "스테디" not in v
    assert "셔츠" not in v
    assert "러프사이두" in dict(variants(["러프사이드", "렆사"], c))


def test_follow_words_rank_what_comes_right_after_the_brand():
    f = dict(follow_words(["레드윙"], POSTS))
    assert f["아이언레인저"] == 2
    assert f["목토"] == 1
    assert dict(follow_words(["렆사", "러프사이드", "러프사이두"], POSTS))["워커데이"] == 2


def test_variants_skip_words_the_checker_rejects_and_other_brands_terms():
    c = Counter({"수에엑": 3, "먹고": 20, "스투시": 9})
    v = dict(variants(["스에웨"], c, is_word=lambda t: t != "먹고", taken={"스투시"}))
    assert "수에엑" in v
    assert "먹고" not in v and "스투시" not in v


def test_variants_list_the_closest_spelling_first():
    c = Counter({"정사이즈": 70, "럽사": 4})
    assert [t for t, _ in variants(["러프사이드", "렆사"], c)][0] == "럽사"
