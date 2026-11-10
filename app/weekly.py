"""Weekly report (Monday to Sunday): the week's important current affairs with analysis.

Only High and the strongest Medium items go in, so the report stays short enough to revise in
one sitting. Each story keeps its source link. With a site-wide AI key, a short "week in brief"
overview is added at the top.
"""
import json
from datetime import date, timedelta
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.platypus import KeepTogether, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from . import db
from .ai import complete, parse_json, resolve, server_settings
from .config import PDF_DIR
from .pdfgen import INK, MUTED, RULE, S, _bullets, _p, analysis_block, source_label, source_para

MAX_MEDIUM = 30
WEEKLY_DIR = PDF_DIR / "weekly"


def week_start(d):
    d = date.fromisoformat(d) if isinstance(d, str) else d
    return d - timedelta(days=d.weekday())


def week_label(start):
    s = date.fromisoformat(start) if isinstance(start, str) else start
    e = s + timedelta(days=6)
    left = s.strftime("%d %B") if s.month != e.month else s.strftime("%d")
    return f"{left.lstrip('0')} – {e.strftime('%d %B %Y').lstrip('0')}"


def imp(it):
    return (it.get("notes") or {}).get("importance") or it.get("importance") or "Low"


def week_items(start):
    """Return (high, medium) items for the week, each list sorted by score."""
    s = date.fromisoformat(start) if isinstance(start, str) else start
    with db.conn() as c:
        rows = c.execute("SELECT * FROM items WHERE day BETWEEN ? AND ? ORDER BY score DESC",
                         (s.isoformat(), (s + timedelta(days=6)).isoformat())).fetchall()
    items = [db.row_to_item(r) for r in rows]
    seen, uniq = set(), []
    for it in items:                       # the same story can appear on two days
        k = it["title"].lower()[:70]
        if k not in seen:
            seen.add(k)
            uniq.append(it)
    high = [i for i in uniq if imp(i) == "High"]
    med = [i for i in uniq if imp(i) == "Medium"]
    med.sort(key=lambda i: (0 if (i.get("notes") or {}).get("analysis") else 1, -i["score"]))
    return high, med[:MAX_MEDIUM]


def week_overview(high, med, settings=None):
    """Optional AI 'week in brief'. Returns None without a key or on error."""
    settings = settings or server_settings()
    if not resolve(settings)[0] or not (high or med):
        return None
    lines = [f"- [{i['day']}] {i['title']}: {' '.join((i['notes'] or {}).get('summary') or [])[:300]}" for i in (high + med)[:40]]
    prompt = ("You are a UPSC CSE mentor. Below are this week's important current affairs. Write a short "
              "'week in brief' for revision. Return ONLY JSON: {\"intro\": 2-3 sentences, \"themes\": "
              "[{\"title\": theme name, \"points\": [2-3 one-line takeaways for India and UPSC]}] (3 to 5 themes)}. "
              "Use only the facts given.\n\n" + "\n".join(lines))
    try:
        d = parse_json(complete(prompt, settings, 2048))
        if isinstance(d, dict) and d.get("themes"):
            return {"intro": str(d.get("intro") or ""), "themes": [
                {"title": str(t.get("title", "")), "points": [str(p) for p in (t.get("points") or [])][:3]}
                for t in d["themes"] if isinstance(t, dict)][:5]}
    except Exception:
        pass
    return None


def revision_lists(items):
    prelims, statics, seen_p, seen_s = [], [], set(), set()
    for it in items:
        n = it.get("notes") or {}
        for p in (n.get("prelims") or []):
            if p.lower() not in seen_p and not p.startswith("Key terms"):
                seen_p.add(p.lower()); prelims.append(p)
        for st in (n.get("static") or []):
            t = st.get("title", "")
            if t and t.lower() not in seen_s:
                seen_s.add(t.lower()); statics.append(st)
    return prelims[:40], statics[:20]


def build_week_pdf(start, high, med, overview=None, out_dir=None):
    out_dir = out_dir or WEEKLY_DIR
    out_dir.mkdir(parents=True, exist_ok=True)
    start = start if isinstance(start, str) else start.isoformat()
    path = out_dir / f"UPSC-Weekly-{start}.pdf"
    doc = SimpleDocTemplate(str(path), pagesize=A4, leftMargin=16 * mm, rightMargin=16 * mm,
                            topMargin=16 * mm, bottomMargin=16 * mm,
                            title=f"UPSC Weekly Current Affairs {week_label(start)}", author="UPSC Daily")
    story = [_p("UPSC Weekly Current Affairs", "title"),
             _p(f"{week_label(start)}  ·  {len(high)} top stories  ·  {len(med)} also important  ·  Sources: PIB and The Hindu", "sub")]

    # glance table by subject
    by_subj = {}
    for it in high + med:
        by_subj.setdefault(it["topics"][0] if it["topics"] else "Other", []).append(it)
    rows = [["Subject", "Stories", "Headline to know"]]
    for subj, its in sorted(by_subj.items(), key=lambda kv: -len(kv[1])):
        rows.append([Paragraph(escape(subj), S["meta"]), str(len(its)), Paragraph(escape(its[0]["title"][:90]), S["meta"])])
    t = Table(rows, colWidths=[44 * mm, 16 * mm, 118 * mm])
    t.setStyle(TableStyle([("FONT", (0, 0), (-1, 0), "Helvetica-Bold", 9), ("FONT", (1, 1), (1, -1), "Helvetica", 9),
                           ("TEXTCOLOR", (0, 0), (-1, 0), colors.white), ("BACKGROUND", (0, 0), (-1, 0), INK),
                           ("LINEBELOW", (0, 1), (-1, -1), 0.4, RULE), ("VALIGN", (0, 0), (-1, -1), "TOP"),
                           ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4)]))
    story += [t, Spacer(1, 6)]

    if overview:
        story.append(_p("The week in brief", "h1"))
        if overview.get("intro"):
            story.append(_p(overview["intro"]))
        for th in overview["themes"]:
            story.append(_p(th["title"], "label"))
            story += _bullets(th["points"])

    def rule():
        return Table([[""]], colWidths=[178 * mm], rowHeights=[2], style=[("LINEBELOW", (0, 0), (-1, -1), 0.5, RULE)])

    if high:
        story.append(_p("Top stories of the week", "h1"))
    for it in high:
        n = it.get("notes") or {}
        block = [Paragraph(f'<link href="{escape(it["link"])}">{escape(it["title"])}</link>', S["h2"]),
                 _p(f"{date.fromisoformat(it['day']).strftime('%a %d %b')} · {', '.join(it['topics'][:2])} · {', '.join(it['papers'])}", "meta")]
        summ = n.get("summary") or []
        block += _bullets(summ if isinstance(summ, list) else [summ])
        block += analysis_block(n)
        for st in (n.get("static") or [])[:2]:
            block.append(_p(f"Static connect: {st.get('title', '')}", "label"))
            block += _bullets((st.get("facts") or [])[:3])
        if n.get("prelims"):
            block.append(_p("Prelims pointers", "label"))
            block += _bullets(n["prelims"] if isinstance(n["prelims"], list) else [n["prelims"]])
        if n.get("mains"):
            block += [_p("Mains angle", "label"), _p(n["mains"])]
        if n.get("question"):
            block += [_p("Practice question", "label"), _p(n["question"], "q")]
        block += [source_para(it), rule(), Spacer(1, 4)]
        story.append(KeepTogether(block))

    if med:
        story.append(_p("Also important this week", "h1"))
        cur = None
        for it in sorted(med, key=lambda i: (i["topics"][0] if i["topics"] else "Other", i["day"])):
            subj = it["topics"][0] if it["topics"] else "Other"
            n = it.get("notes") or {}
            block = [_p(subj.upper(), "subj")] if subj != cur else []
            cur = subj
            key = (n.get("summary") or [""])
            key = key[0] if isinstance(key, list) and key else key if isinstance(key, str) else ""
            block.append(Paragraph(f'• <link href="{escape(it["link"])}"><b>{escape(it["title"])}</b></link> '
                                   f'<font color="#5b6675" size="8">({escape(source_label(it))})</font>', S["body"]))
            if key:
                block.append(Paragraph(f'<font size="8.5">{escape(key[:260])}</font>', S["body"]))
            an = n.get("analysis") or {}
            if an.get("angles"):
                dims = "; ".join(f"<b>{escape(a.get('dim', ''))}</b>: {escape(a.get('point', '')[:160])}" for a in an["angles"][:2])
                block.append(Paragraph(f'<font size="8.5" color="#c2410c">Why it matters</font> <font size="8.5">{dims}</font>', S["body"]))
            block.append(Spacer(1, 3))
            story.append(KeepTogether(block))

    prelims, statics = revision_lists(high + med)
    if prelims:
        story.append(KeepTogether([_p("Prelims quick revision", "h1")] + _bullets(prelims[:3])))
        story += _bullets(prelims[3:])
    if statics:
        story.append(_p("Static topics that came up this week", "h1"))
        for st in statics:
            story.append(KeepTogether([_p(st.get("title", ""), "label")] + _bullets((st.get("facts") or [])[:3])))

    def footer(canvas, doc_):
        canvas.saveState(); canvas.setFont("Helvetica", 7.5); canvas.setFillColor(MUTED)
        canvas.drawString(16 * mm, 9 * mm, f"UPSC Daily · Weekly report · {week_label(start)}")
        canvas.drawRightString(A4[0] - 16 * mm, 9 * mm, f"Page {doc_.page}")
        canvas.restoreState()

    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    return str(path)


def build_weeks(today_iso, rebuild_days=8):
    """Build/refresh weekly reports. Returns a list of week summaries (newest first) for the app."""
    with db.conn() as c:
        days = [r[0] for r in c.execute("SELECT DISTINCT day FROM items ORDER BY day DESC")]
        meta = {r["key"]: json.loads(r["value"]) for r in c.execute("SELECT key,value FROM settings WHERE key LIKE 'week:%'")}
    today_d = date.fromisoformat(today_iso)
    starts = sorted({week_start(d) for d in days}, reverse=True)
    out = []
    for s in starts:
        key, end = f"week:{s.isoformat()}", s + timedelta(days=6)
        complete = end < today_d
        m = meta.get(key) or {}
        pdf = WEEKLY_DIR / f"UPSC-Weekly-{s.isoformat()}.pdf"
        high, med = week_items(s)
        fresh = (today_d - end).days < rebuild_days or not pdf.exists()
        if fresh and (high or med):
            ov = m.get("overview") if m.get("complete") else None
            if not ov and (complete or not m.get("overview")):
                ov = week_overview(high, med) or m.get("overview")
            build_week_pdf(s, high, med, ov)
            m = {"overview": ov, "complete": complete, "high": len(high), "medium": len(med)}
            db.set_setting(key, m)
            if complete and not meta.get(key, {}).get("notified"):
                db.notify("weekly", f"Weekly report ready: {week_label(s)}",
                          f"{len(high)} top stories with analysis, plus Prelims revision.", f"#/week/{s.isoformat()}")
                m["notified"] = True
                db.set_setting(key, m)
        out.append({"start": s.isoformat(), "end": end.isoformat(), "label": week_label(s), "complete": complete,
                    "high": len(high), "medium": len(med), "has_pdf": pdf.exists(),
                    "overview": m.get("overview"), "items": high + med})
    return out
