"""Rule-based notes used when no AI key is configured (or as a fallback)."""
import re



def sentences(text):
    return [s.strip() for s in re.split(r"(?<=[.!?])\s+", text or "") if len(s.strip()) > 25]


GENERIC = {"The", "This", "India", "Indian", "Union", "Government", "Centre", "State", "States",
           "Ministry", "It", "In", "On", "A", "An", "Minister", "He", "She", "They", "Editorial",
           "Recent", "Recently", "After", "Following", "Amid", "With", "However", "As", "According",
           "New", "First", "Officials", "Experts", "Now", "Today", "Also", "While", "But"}


def key_terms(text, limit=5):
    """Pick proper nouns and acronyms (schemes, bodies, places) as Prelims pointers."""
    found = []
    for m in re.finditer(r"(?:[A-Z][A-Za-z0-9\-]+(?:\s+(?:of|for|and|the)?\s*[A-Z][A-Za-z0-9\-]+)*)", text or ""):
        t = re.sub(r"^(The|A|An|In|On)\s+", "", m.group(0).strip())
        if t in GENERIC or len(t) < 3 or t.lower() in (f.lower() for f in found):
            continue
        found.append(t)
    return found[:limit]


def rule_notes(item):
    sents = sentences(item["excerpt"]) or [item["title"]]
    facts = [s for s in sents[2:] if re.search(r"\d|[A-Z]{2,}|Scheme|Mission|Act|Index|Ministry", s)]
    terms = key_terms(item["title"] + ". " + item["excerpt"])
    if terms:
        facts.append("Key terms: " + ", ".join(terms))
    imp = item.get("importance") or "Low"
    n = {"summary": sents[:2], "ai": False}
    if imp == "Low":
        return n                      # low-priority news: headline + summary only, no filler
    if facts:
        n["prelims"] = facts[:2]
    # No templated Mains lines or practice questions here: those are written only by AI,
    # and only where the item is genuinely exam-important (see ai.NOTES_PROMPT).
    return n
