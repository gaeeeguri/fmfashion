"""Text normalization shared by candidate extraction and known-term matching (spec §4.5)."""
import re
import unicodedata

_URL = re.compile(r"https?://\S+")
_REPEAT = re.compile(r"(.)\1{2,}")
_SPACE = re.compile(r"[ \t ]+")


def normalize(text: str) -> str:
    # NFKC would turn compatibility jamo (ㅋ) into conjoining jamo (ᄏ); keep jamo as typed
    t = unicodedata.normalize("NFC", text)
    t = "".join(c if "\u3131" <= c <= "\u318e" else unicodedata.normalize("NFKC", c) for c in t)
    t = _URL.sub(" ", t)
    t = _REPEAT.sub(r"\1\1", t)
    t = _SPACE.sub(" ", t)
    t = "\n".join(line.strip() for line in t.split("\n"))
    return t.lower().strip()
