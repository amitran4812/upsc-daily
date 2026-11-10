"""Monthly quiz built from that month's notes."""
import json, random
from datetime import date, datetime
from . import db
from .ai import complete, parse_json, resolve, server_settings

QUIZ_PROMPT = """You are setting a UPSC Civil Services Prelims-style monthly current affairs quiz.
Using ONLY the facts in these news notes, write {n} multiple-choice questions in the style of
UPSC previous-year papers (2013-2025): mix "Consider the following statements... Which of the
statements given above is/are correct?", "With reference to...", and match-the-following formats.
Each must have exactly 4 options and one correct answer. Do not invent facts.
Return ONLY a JSON array of objects with keys:
  "question" (string, may contain line breaks), "options" (4 strings),
  "answer" (index 0-3), "explanation" (1-2 sentences), "item_id" (source item id).

Notes:
{notes}
"""


def quiz_source(it):
    """Where a question came from, shown in the answer review."""
    return {"title": it["title"], "source": it["source"], "section": it.get("section", ""),
            "day": it["day"], "link": it["link"]}


def month_items(month):
    with db.conn() as c:
        rows = c.execute("SELECT * FROM items WHERE substr(day,1,7)=? ORDER BY score DESC",
                         (month,)).fetchall()
    return [db.row_to_item(r) for r in rows]


def _rule_quiz(items, n=15):
    rng = random.Random(int(items[0]["day"][:7].replace("-", "")) if items else 0)
    qs = []
    pool = items[: n * 3]
    for it in pool:
        topic = it["topics"][0] if it["topics"] else None
        others = [o for o in items if o["topics"] and o["topics"][0] != topic]
        if not topic or len(others) < 3:
            continue
        wrong = rng.sample(others, 3)
        opts = [it["title"]] + [w["title"] for w in wrong]
        rng.shuffle(opts)
        qs.append({
            "question": f"Which of the following developments from this month is most relevant to "
                        f"'{topic}' in the UPSC syllabus?",
            "options": opts, "answer": opts.index(it["title"]),
            "explanation": (it["notes"].get("summary") or [it["excerpt"]])[0] if it["notes"] else it["excerpt"],
            "item_id": it["id"]})
        if len(qs) >= n:
            break
    return qs


def generate_quiz(month=None, n=15, notify=True, settings=None):
    if not month:
        t = date.today().replace(day=1)
        month = (date(t.year - 1, 12, 1) if t.month == 1 else date(t.year, t.month - 1, 1)).strftime("%Y-%m")
    items = month_items(month)
    if len(items) < 4:
        return {"month": month, "error": "Not enough notes for this month yet (need at least 4)."}
    s = settings if resolve(settings)[0] else server_settings()
    provider = resolve(s)[0]
    qs, used_ai = [], None
    if provider:
        notes = [{"item_id": i["id"], "title": i["title"], "excerpt": i["excerpt"],
                  "notes": {k: i["notes"].get(k) for k in ("summary", "prelims")}} for i in items[:45]]
        try:
            data = parse_json(complete(QUIZ_PROMPT.replace("{n}", str(n)).replace(
                "{notes}", json.dumps(notes, ensure_ascii=False)), s, max_tokens=8000))
            qs = [q for q in data if isinstance(q, dict) and len(q.get("options", [])) == 4
                  and isinstance(q.get("answer"), int) and 0 <= q["answer"] < 4]
            used_ai = provider
        except Exception:
            qs = []
    if not qs:
        qs = _rule_quiz(items, n)
    by_id = {i["id"]: i for i in items}
    for q in qs:
        it = by_id.get(q.get("item_id"))
        q["link"] = it["link"] if it else ""
        if it:
            q["source"] = quiz_source(it)
    with db.conn() as c:
        c.execute("INSERT INTO quizzes(month,created_at,questions,ai) VALUES(?,?,?,?) "
                  "ON CONFLICT(month) DO UPDATE SET created_at=excluded.created_at, "
                  "questions=excluded.questions, ai=excluded.ai",
                  (month, datetime.now().isoformat(timespec="seconds"), json.dumps(qs), used_ai or ""))
    if notify:
        label = datetime.strptime(month, "%Y-%m").strftime("%B %Y")
        db.notify("quiz", f"Monthly quiz ready: {label}",
                  f"{len(qs)} questions on {label} current affairs. Test yourself now.", f"#/quiz/{month}")
    return {"month": month, "questions": len(qs), "ai": used_ai}
