import re
import unicodedata

_NON_ALNUM = re.compile(r"[^a-z0-9ñ ]+")
_SPACES = re.compile(r"\s+")


def strip_accents(text: str) -> str:
    text = text.replace("ñ", "\x00").replace("Ñ", "\x01")
    text = "".join(c for c in unicodedata.normalize("NFKD", text) if not unicodedata.combining(c))
    return text.replace("\x00", "ñ").replace("\x01", "Ñ")


def normalize(text: str | None) -> str:
    if not text:
        return ""
    text = strip_accents(text.lower())
    text = _NON_ALNUM.sub(" ", text)
    return _SPACES.sub(" ", text).strip()


def contains_term(normalized_text: str, term: str) -> bool:
    return re.search(rf"(?<![a-z0-9ñ]){re.escape(term)}(?![a-z0-9ñ])", normalized_text) is not None
