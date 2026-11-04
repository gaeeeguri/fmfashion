"""Brand-candidate tokens: proper nouns, foreign words, unknowns, and re-joined split runs (spec §4.5)."""
from kiwipiepy import Kiwi

# Kiwi tags unseen slang (얼저고, 무탠) as NNG, so NNG stays in; keyness pushes general nouns down.
KEEP = {"NNG", "NNP", "SL", "NA", "UN"}
JOINABLE = {"NNG", "NNP", "SL", "SN"}


def candidates(kiwi: Kiwi, text: str) -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = []
    run: list = []

    def flush():
        if len(run) >= 2:
            out.append(("".join(t.form for t in run), "JOIN"))
        run.clear()

    for tok in kiwi.tokenize(text):
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
