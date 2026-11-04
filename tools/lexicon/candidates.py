"""Brand-candidate tokens: proper nouns, foreign words, unknowns, and re-joined split runs (spec §4.5)."""
from kiwipiepy import Kiwi

# Kiwi tags unseen slang (얼저고, 무탠) as NNG, so NNG stays in; keyness pushes general nouns down.
KEEP = {"NNG", "NNP", "SL", "NA", "UN"}
JOINABLE = {"NNG", "NNP", "SL", "SN"}
NOUNISH = {"NNG", "NNP", "SL", "NA", "UN"}
# where an eojeol's word part ends: particles, endings, suffixes, copula, verbs, punctuation
_FUNCTIONAL = ("J", "E", "XS", "VC", "VV", "VA", "VX", "SF", "SP", "SS", "SE", "SO", "SW")


def _eojeol_leads(text: str, toks) -> list[str]:
    """Kiwi splits an unseen word differently by context (얼저고 → 얼/NNG 저/MM 고/XPN).
    Recover it as the eojeol's leading run before any particle/ending, when that run is not all nouns."""
    out, eoj = [], []

    def flush():
        lead = []
        for t in eoj:
            if t.tag.startswith(_FUNCTIONAL):
                break
            lead.append(t)
        if len(lead) >= 2 and lead[0].tag in NOUNISH and not all(t.tag in JOINABLE for t in lead):
            out.append(text[lead[0].start: lead[-1].start + lead[-1].len])
        eoj.clear()

    for t in toks:
        if eoj and t.start != eoj[-1].start + eoj[-1].len:
            flush()
        eoj.append(t)
    flush()
    return out


def candidates(kiwi: Kiwi, text: str) -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = []
    run: list = []

    def flush():
        if len(run) >= 2:
            out.append(("".join(t.form for t in run), "JOIN"))
        run.clear()

    toks = kiwi.tokenize(text)
    out += [(f, "EOJ") for f in _eojeol_leads(text, toks)]
    for tok in toks:
        if tok.tag in KEEP and len(tok.form) >= 2:
            out.append((tok.form, tok.tag))
        if tok.tag in JOINABLE:
            if run and tok.start != run[-1].start + run[-1].len:
                flush()
            run.append(tok)
        else:
            flush()
    flush()
    return [(f, t) for f, t in out if len(f) >= 2]
