"""Keyness: how much more often a word shows up here than in general Korean/English (spec §4.5)."""
import math
from functools import lru_cache

from wordfreq import get_frequency_dict


@lru_cache(maxsize=1)
def _general():
    # whole-word lookup: wordfreq's per-word API needs MeCab for Korean, the frequency dicts don't
    return get_frequency_dict("ko"), get_frequency_dict("en")


def general_frequency(word: str) -> float:
    ko, en = _general()
    return max(ko.get(word, 0.0), en.get(word, 0.0))


def keyness(df: int, n_docs: int, word: str, alpha: float = 0.0, beta: float = 1e-6) -> float:
    return math.log((df / n_docs + alpha) / (general_frequency(word) + beta))
