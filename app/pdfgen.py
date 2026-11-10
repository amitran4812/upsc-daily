"""Build one PDF per day with reportlab."""
from datetime import date, datetime
from xml.sax.saxutils import escape
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (KeepTogether, Paragraph, SimpleDocTemplate,
                                Spacer, Table, TableStyle)
from .config import PDF_DIR
from .pyq_themes import PAPER_LABELS

INK = colors.HexColor("#1b2430")
ACCENT = colors.HexColor("#c2410c")
MUTED = colors.HexColor("#5b6675")
RULE = colors.HexColor("#e4e0d8")

ss = getSampleStyleSheet()
S = {
    "title": ParagraphStyle("t", parent=ss["Title"], fontName="Helvetica-Bold", fontSize=24,
                            textColor=INK, alignment=0, spaceAfter=4),
    "sub": ParagraphStyle("s", parent=ss["Normal"], fontSize=10.5, textColor=MUTED, spaceAfter=10),
    "h1": ParagraphStyle("h1", parent=ss["Heading1"], fontName="Helvetica-Bold", fontSize=15,
                         textColor=ACCENT, spaceBefore=10, spaceAfter=6),
    "h2": ParagraphStyle("h2", parent=ss["Heading2"], fontName="Helvetica-Bold", fontSize=11.5,
                         textColor=INK, spaceBefore=4, spaceAfter=2, leading=14),
    "meta": ParagraphStyle("m", parent=ss["Normal"], fontSize=8, textColor=MUTED, spaceAfter=3),
    "body": ParagraphStyle("b", parent=ss["Normal"], fontSize=9.5, leading=13, textColor=INK),
    "label": ParagraphStyle("l", parent=ss["Normal"], fontName="Helvetica-Bold", fontSize=8.5,
                            textColor=ACCENT, spaceBefore=3),
    "subj": ParagraphStyle("sj", parent=ss["Normal"], fontName="Helvetica-Bold", fontSize=9,
                           textColor=MUTED, spaceBefore=8, spaceAfter=2),
    "q": ParagraphStyle("q", parent=ss["Normal"], fontName="Helvetica-Oblique", fontSize=9.5,
                        leading=13, textColor=INK),
}

ORDER = ["GS1", "GS2", "GS3", "GS4", "Prelims"]


def _p(text, style="body"):
    return Paragraph(escape(str(text)), S[style])


def _bullets(lines):
    return [Paragraph("• " + escape(str(l)), S["body"]) for l in lines if l]


def source_label(it):
    when = ""
    if it.get("published"):
        try:
            when = ", " + datetime.fromisoformat(it["published"]).strftime("%d %b %Y")
        except ValueError:
            pass
    return f"{it['source']}, {it['section']}{when}"


def source_para(it):
    return Paragraph(f'<b>Source:</b> {escape(source_label(it))} · '
                     f'<link href="{escape(it["link"])}" color="#c2410c"><u>{escape(it["link"][:90])}</u></link>',
                     S["meta"])


def build_pdf(day: str, items: list, out_dir=None) -> str:
    out_dir = out_dir or PDF_DIR
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / f"UPSC-CA-{day}.pdf"
    doc = SimpleDocTemplate(str(path), pagesize=A4, leftMargin=16 * mm, rightMargin=16 * mm,
                            topMargin=16 * mm, bottomMargin=16 * mm,
                            title=f"UPSC Current Affairs {day}", author="UPSC CA Portal")
    d = date.fromisoformat(day)
    story = [_p("UPSC Current Affairs", "title"),
             _p(f"{d.strftime('%A, %d %B %Y')}  ·  Sources: PIB and The Hindu  ·  {len(items)} items", "sub")]

    groups = {k: [] for k in ORDER}
    for it in items:
        groups[(it["papers"] or ["Prelims"])[0]].append(it)

    # Summary table
    rows = [["Paper", "Items", "Top headlines"]]
    for k in ORDER:
        if groups[k]:
            heads = "; ".join(i["title"][:60] for i in groups[k][:2])
            rows.append([k, str(len(groups[k])), Paragraph(escape(heads), S["meta"])])
    t = Table(rows, colWidths=[22 * mm, 16 * mm, 140 * mm])
    t.setStyle(TableStyle([
        ("FONT", (0, 0), (-1, 0), "Helvetica-Bold", 9),
        ("FONT", (0, 1), (1, -1), "Helvetica", 9),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("BACKGROUND", (0, 0), (-1, 0), INK),
        ("LINEBELOW", (0, 1), (-1, -1), 0.4, RULE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    story += [t, Spacer(1, 6)]
    story.append(_p("Every item links to its original source: tap a headline or the Source line to "
                    "open the full article on thehindu.com or the press release on pib.gov.in. "
                    "The Hindu text here is only the short RSS excerpt.", "meta"))

    rank = {"High": 0, "Medium": 1, "Low": 2}
    for k in ORDER:
        if not groups[k]:
            continue
        paper_head = [_p(PAPER_LABELS[k], "h1")]
        full = [i for i in groups[k] if (i.get("importance") or "Low") != "Low"]
        brief = [i for i in groups[k] if (i.get("importance") or "Low") == "Low"]
        full.sort(key=lambda i: (i["topics"][0] if i["topics"] else "", rank.get(i.get("importance"), 3), -i["score"]))
        current = None
        for it in full:
            subj = it["topics"][0] if it["topics"] else "Other"
            head = []
            if subj != current:
                current = subj
                head = paper_head + [_p(subj.upper(), "subj")]   # kept with the item so headings never orphan
                paper_head = []
            n = it.get("notes") or {}
            block = head + [Paragraph(f'<link href="{escape(it["link"])}">{escape(it["title"])}</link>', S["h2"]),
                     _p(f"{(it.get('importance') or 'Low').upper()} IMPORTANCE · {it['stage']} · "
                        f"{', '.join(it['topics'])}", "meta")]
            if n.get("summary"):
                block += _bullets(n["summary"] if isinstance(n["summary"], list) else [n["summary"]])
            if n.get("prelims"):
                block.append(_p("Prelims pointers", "label"))
                block += _bullets(n["prelims"] if isinstance(n["prelims"], list) else [n["prelims"]])
            if n.get("mains"):
                block.append(_p("Mains angle", "label"))
                block.append(_p(n["mains"]))
            for q in (n.get("related_pyqs") or []):
                block.append(_p(f"Asked before: PYQ {q['year']} {q['paper']}: {q['question']}", "q"))
            if n.get("question"):
                block.append(_p("Practice question", "label"))
                block.append(_p(n["question"], "q"))
            block.append(source_para(it))
            block.append(Table([[""]], colWidths=[178 * mm], rowHeights=[2],
                               style=[("LINEBELOW", (0, 0), (-1, -1), 0.5, RULE)]))
            block.append(Spacer(1, 4))
            story.append(KeepTogether(block))
        if brief:
            rows = [_p("ALSO IN THE NEWS (LOWER PRIORITY)", "subj")]
            for it in brief:
                rows.append(Paragraph(
                    f'• <link href="{escape(it["link"])}">{escape(it["title"])}</link> '
                    f'<font color="#5b6675" size="8">({escape(source_label(it))})</font>', S["body"]))
            story.append(KeepTogether(paper_head + rows))

    def footer(canvas, doc_):
        canvas.saveState()
        canvas.setFont("Helvetica", 7.5)
        canvas.setFillColor(MUTED)
        canvas.drawString(16 * mm, 9 * mm, f"UPSC CA Portal · {day}")
        canvas.drawRightString(A4[0] - 16 * mm, 9 * mm, f"Page {doc_.page}")
        canvas.restoreState()

    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    return str(path)
