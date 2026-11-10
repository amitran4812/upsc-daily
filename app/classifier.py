"""Rule-based UPSC classifier that scores news against syllabus topics and PYQs."""
import csv, json, re
from functools import lru_cache
from .config import PYQ_DIR
from .pyq_themes import TOPICS, NOISE

STOP = set("""a an the of in on for to and or with by from at as is are was were be been this that
these those which what why how its it their india indian discuss examine explain comment
analyse analyze critically evaluate consider following statements correct given above
there not can may has have""".split())


def _tokens(text):
    return {w for w in re.findall(r"[a-z][a-z\-]{2,}", text.lower()) if w not in STOP}


@lru_cache(maxsize=1)
def load_pyqs():
    """Load user-supplied PYQs from data/pyq/*.json or *.csv.

    JSON: list of {"year": 2023, "paper": "GS2", "question": "..."}
    CSV: columns year,paper,question
    """
    out = []
    for p in sorted(PYQ_DIR.glob("*")):
        try:
            if p.suffix == ".json":
                rows = json.loads(p.read_text(encoding="utf-8"))
            elif p.suffix == ".csv":
                rows = list(csv.DictReader(p.open(encoding="utf-8")))
            else:
                continue
        except Exception:
            continue
        for r in rows:
            q = (r.get("question") or "").strip()
            if q:
                out.append({"year": str(r.get("year", "")), "paper": r.get("paper", ""),
                            "question": q, "tokens": _tokens(q)})
    return out


def related_pyqs(text, limit=2):
    toks = _tokens(text)
    if not toks:
        return []
    scored = []
    for q in load_pyqs():
        overlap = len(toks & q["tokens"])
        if overlap >= 3:
            scored.append((overlap / (len(q["tokens"]) ** 0.5 + 1), q))
    scored.sort(key=lambda x: -x[0])
    return [{"year": q["year"], "paper": q["paper"], "question": q["question"]}
            for _, q in scored[:limit]]


def classify(title, excerpt, section="", source=""):
    text = f" {title} {title} {excerpt} {section} ".lower()  # title counts double
    noise = sum(1 for n in NOISE if n in text)
    hits = []
    for t in TOPICS:
        n = sum(1 for k in t["keywords"] if k in text)
        if n:
            hits.append((n * (1 + 0.25 * t["weight"]), t))
    hits.sort(key=lambda x: -x[0])

    score = sum(s for s, _ in hits[:3]) - 2.5 * noise
    if source == "PIB":
        score += 1.0          # official releases are usually exam-relevant
    if section in ("Editorial", "Lead (Op-Ed)"):
        score += 1.0          # editorials feed Mains answers

    top = [t for s, t in hits[:3] if s >= hits[0][0] * 0.5] if hits else []
    papers = sorted({t["paper"] for t in top})
    stages = {t["stage"] for t in top}
    if section in ("Editorial", "Lead (Op-Ed)"):
        stages.add("Mains")
    if "Both" in stages or ({"Prelims", "Mains"} <= stages):
        stage = "Both"
    elif stages:
        stage = stages.pop()
    else:
        stage = "Prelims"
    themes = []
    for t in top[:2]:
        themes.extend(t["themes"][:2])
    pyqs = related_pyqs(f"{title} {excerpt}")
    if pyqs:
        score += 1.5
    if score >= 8 or (pyqs and score >= 5):
        importance = "High"
    elif score >= 4.5 or section in ("Editorial", "Lead (Op-Ed)"):
        importance = "Medium"
    else:
        importance = "Low"
    return {
        "importance": importance,
        "score": round(score, 2),
        "papers": papers,
        "topics": [t["topic"] for t in top],
        "stage": stage,
        "pyq_themes": themes,
        "related_pyqs": pyqs,
    }
