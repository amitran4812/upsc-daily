"""Build the free static version (GitHub Pages).

Run by the daily GitHub Action:
  1. fetch PIB + The Hindu and update the database in state/ (kept in the repo),
  2. publish the monthly quiz when due,
  3. export everything as JSON + PDFs into site/, which GitHub Pages serves.
Usage: python build_static.py [--no-fetch]
"""
import json, os, shutil, sys
from datetime import date, datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent
os.environ.setdefault("UPSC_DATA_DIR", str(ROOT / "state"))

from app import db                                  # noqa: E402
from app.ai import NOTES_PROMPT                     # noqa: E402
from app.config import PDF_DIR                      # noqa: E402
from app.pipeline import day_items, run_daily, today  # noqa: E402
from app.pyq_themes import PAPER_LABELS             # noqa: E402
from app.quiz import generate_quiz                  # noqa: E402

SITE = ROOT / "site"
STATIC = ROOT / "app" / "static"


def write(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def prev_month():
    t = date.today().replace(day=1)
    return (t - timedelta(days=1)).strftime("%Y-%m")


def main():
    db.init()
    with db.conn() as c:   # migrate older databases
        cols = {r[1] for r in c.execute("PRAGMA table_info(items)")}
        if "importance" not in cols:
            c.execute("ALTER TABLE items ADD COLUMN importance TEXT")
    if "--no-fetch" not in sys.argv:
        print(run_daily())
    with db.conn() as c:
        has_quiz = c.execute("SELECT 1 FROM quizzes WHERE month=?", (prev_month(),)).fetchone()
    if not has_quiz:
        print(generate_quiz(prev_month()))

    if SITE.exists():
        shutil.rmtree(SITE)
    (SITE / "static").mkdir(parents=True)
    for f in STATIC.iterdir():
        if f.name not in ("index.html", "sw.js", "manifest.webmanifest"):
            shutil.copy(f, SITE / "static" / f.name)

    html = (STATIC / "index.html").read_text(encoding="utf-8")
    html = html.replace('"/static/', '"static/').replace('href="/manifest.webmanifest"', 'href="manifest.webmanifest"')
    html = html.replace('<script src="static/app.js"></script>',
                        '<script src="static/static-api.js"></script>\n<script src="static/app.js"></script>')
    (SITE / "index.html").write_text(html, encoding="utf-8")
    man = json.loads((STATIC / "manifest.webmanifest").read_text(encoding="utf-8"))
    man.update(start_url="./#/today", scope="./")
    for i in man["icons"]:
        i["src"] = i["src"].lstrip("/")
    write(SITE / "manifest.webmanifest", man)
    sw = (STATIC / "sw.js").read_text(encoding="utf-8")
    sw = (sw.replace('["/", "/static/styles.css", "/static/app.js", "/static/icon-192.png", "/manifest.webmanifest"]',
                     '["./", "static/styles.css", "static/app.js", "static/static-api.js", "static/icon-192.png", "manifest.webmanifest"]')
            .replace('url.pathname.startsWith("/api/pdf/")', 'url.pathname.includes("/pdfs/")')
            .replace('url.pathname.startsWith("/api/")', 'url.pathname.includes("/data/")')
            .replace('(url.pathname.startsWith("/api/day/") || url.pathname === "/api/overview")', 'true')
            .replace('caches.match("/")', 'caches.match("./")')
            .replace('const link = "/" + (e.notification.data?.link || "#/today");',
                     'const link = self.registration.scope + (e.notification.data?.link || "#/today");'))
    (SITE / "sw.js").write_text(sw, encoding="utf-8")
    (SITE / ".nojekyll").write_text("")

    # ---- data ----
    with db.conn() as c:
        runs = [dict(r) for r in c.execute(
            "SELECT day,fetched_at,item_count,pdf_path FROM runs WHERE item_count>0 ORDER BY day DESC")]
        quizzes = [dict(r) for r in c.execute("SELECT * FROM quizzes ORDER BY month DESC")]
        notes = [dict(r) for r in c.execute(
            "SELECT id,kind,title,body,link,created_at FROM notifications ORDER BY id DESC LIMIT 30")]
        total = c.execute("SELECT COUNT(*) FROM items").fetchone()[0]
    for r in runs:
        r["has_pdf"] = bool(r.pop("pdf_path"))
    write(SITE / "data" / "overview.json", {"today": today(), "runs": runs, "total_items": total,
                                             "papers": PAPER_LABELS, "built_at": datetime.now().isoformat()})
    cutoff = (date.today() - timedelta(days=365)).isoformat()
    every = []
    for r in runs:
        items = day_items(r["day"])
        write(SITE / "data" / "day" / f"{r['day']}.json", {"day": r["day"], "run": {"fetched_at": r["fetched_at"]}, "items": items})
        if r["day"] >= cutoff:
            every += items
    write(SITE / "data" / "all.json", every)
    write(SITE / "data" / "quizzes.json", [{"month": q["month"], "created_at": q["created_at"], "ai": q["ai"],
                                             "count": len(json.loads(q["questions"]))} for q in quizzes])
    for q in quizzes:
        write(SITE / "data" / "quiz" / f"{q['month']}.json", {"month": q["month"], "ai": q["ai"], "questions": json.loads(q["questions"])})
    write(SITE / "data" / "notifications.json", notes)
    write(SITE / "data" / "meta.json", {"notes_prompt": NOTES_PROMPT})
    shutil.copytree(PDF_DIR, SITE / "pdfs", ignore=shutil.ignore_patterns("users"))
    print(f"site built: {len(runs)} days, {len(every)} items, {len(quizzes)} quizzes")


if __name__ == "__main__":
    main()
