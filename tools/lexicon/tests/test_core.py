import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest
from kiwipiepy import Kiwi

from normalize import normalize
from candidates import candidates
from score import keyness


@pytest.fixture(scope="module")
def kiwi():
    return Kiwi()


def forms(kiwi, text):
    return {f for f, _ in candidates(kiwi, normalize(text))}


def test_normalize_width_case_repeats_urls():
    assert normalize("ＳＥＷ 후기 ㅋㅋㅋㅋ 스웨에에에엑 https://a.b/c") == "sew 후기 ㅋㅋ 스웨에에엑"


def test_joined_run_recovers_split_brand(kiwi):
    assert ("블랙야크", "JOIN") in candidates(kiwi, normalize("코오롱이나 블랙야크 아이더"))


def test_joined_run_recovers_letter_digit_brand(kiwi):
    assert ("k2", "JOIN") in candidates(kiwi, normalize("k2 콜롬비아"))


def test_slang_alias_is_a_candidate(kiwi):
    assert "얼저고" in forms(kiwi, "얼저고 코트 샀어")


def test_no_single_char_candidates(kiwi):
    assert all(len(f) >= 2 for f, _ in candidates(kiwi, normalize("k 2 이 옷 a b 블랙야크")))


def test_common_word_scores_below_unseen_slang():
    assert keyness(30, 1000, "서울") < keyness(30, 1000, "얼저고")


def test_general_noun_scores_below_slang_noun():
    # both NNG candidates now; keyness must separate them
    assert keyness(30, 1000, "사이즈") < keyness(30, 1000, "무탠")


def test_word_split_by_context_is_recovered_from_its_eojeol(kiwi):
    # Kiwi splits 얼저고 into 얼/NNG 저/MM 고/XPN in this sentence
    assert "얼저고" in forms(kiwi, "요즘 얼저고 인기 많네")


def test_eojeol_lead_stops_at_particle_and_skips_verbs(kiwi):
    f = forms(kiwi, "얼저고는 좋다. 셔츠 샀는데 따뜻함")
    assert "얼저고" in f
    assert not any(x.startswith("샀") or x.startswith("사었") for x in f)
