"""Daily pipeline: fetch -> classify -> notes -> PDF -> notify."""
import json
from datetime import date, datetime
from zoneinfo import ZoneInfo
from . import db
from .ai import ai_notes, merge_notes, server_settings
from .classifier import classify
from .config import (MAX_ITEMS_PER_DAY, MAX_PER_HINDU_SECTION, MAX_PIB_PER_DAY,
                     MIN_RELEVANCE, TIMEZONE)
from .fetcher import fetch_all
from .notes import rule_notes
from .pdfgen import build_pdf


def today():
    return datetime.now(ZoneInfo(TIMEZONE)).date().isoformat()


def day_items(day):
    with db.conn() as c:
        rows = c.execute("SELECT * FROM items WHERE day=? ORDER BY score DESC", (day,)).fetchall()
    return [db.row_to_item(r) for r in rows]


def rank_importance(day):
    """High = roughly the top 30% of the day (and strongly relevant), Medium = next 40%."""
    items = [i for i in day_items(day) if not i["notes"].get("ai")]
    if not items:
        return
    scores = sorted((i["score"] for i in items), reverse=True)
    hi_cut = scores[max(0, round(len(scores) * 0.3) - 1)]
    med_cut = scores[max(0, round(len(scores) * 0.7) - 1)]
    with db.conn() as c:
        for i in items:
            pyq = bool(i["notes"].get("related_pyqs"))
            if (i["score"] >= hi_cut and i["score"] >= 8) or (pyq and i["score"] >= 6):
                imp = "High"
            elif i["score"] >= med_cut and i["score"] >= 4.5 or i["section"] in ("Editorial", "Lead (Op-Ed)"):
                imp = "Medium"
            else:
                imp = "Low"
            c.execute("UPDATE items SET importance=? WHERE id=?", (imp, i["id"]))


def _stale(published, day, max_days=2):
    """Feeds also carry older stories; keep only the last couple of days."""
    if not published:
        return False
    try:
        return (date.fromisoformat(day) - datetime.fromisoformat(published).date()).days > max_days
    except ValueError:
        return False


def run_daily(day=None, get=None, feeds=None, fetch=True):
    day = day or today()
    log = []
    raw = fetch_all(get=get, log=log, **({"feeds": feeds} if feeds else {})) if fetch else []
    with db.conn() as c:
        known = {r[0] for r in c.execute("SELECT link FROM items").fetchall()}
    fresh = []
    for it in raw:
        if it["link"] in known or _stale(it.get("published"), day):
            continue
        cl = classify(it["title"], it["excerpt"], it["section"], it["source"])
        if cl["score"] < MIN_RELEVANCE or not cl["topics"]:
            continue
        it.update(cl)
        fresh.append(it)
    fresh.sort(key=lambda x: -x["score"])
    pib = [i for i in fresh if i["source"] == "PIB"][:MAX_PIB_PER_DAY]
    per_section, hindu = {}, []
    for i in fresh:
        if i["source"] != "PIB" and per_section.get(i["section"], 0) < MAX_PER_HINDU_SECTION:
            per_section[i["section"]] = per_section.get(i["section"], 0) + 1
            hindu.append(i)
    fresh = sorted(pib + hindu[: MAX_ITEMS_PER_DAY - len(pib)], key=lambda x: -x["score"])
    for r in [r for r in raw if r["source"] == "PIB"][:6]:
        cl = classify(r["title"], r["excerpt"], r["section"], r["source"])
        log.append(f"  PIB sample: [{r['published'][:16]}] score={cl['score']} stale={_stale(r.get('published'), day)} "
                   f"{r['title'][:70]} | {r['link'][:60]}")
    log.append(f"PIB: {len([r for r in raw if r['source'] == 'PIB'])} fetched, {len(pib)} kept "
               f"(PIB items with no excerpt: {sum(1 for r in raw if r['source'] == 'PIB' and not r['excerpt'])})")
    if fetch:
        log.append(f"{len(raw)} fetched, {len(fresh)} new UPSC-relevant items kept")
    else:
        log.append("Rebuilt notes and PDF without fetching")

    with db.conn() as c:
        for it in fresh:
            cur = c.execute(
                "INSERT OR IGNORE INTO items(day,source,section,title,link,excerpt,published,stage,"
                "papers,topics,pyq_themes,score,importance,notes) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (day, it["source"], it["section"], it["title"], it["link"], it["excerpt"],
                 it["published"], it["stage"], json.dumps(it["papers"]), json.dumps(it["topics"]),
                 json.dumps(it["pyq_themes"]), it["score"], it["importance"],
                 json.dumps({"related_pyqs": it["related_pyqs"]})))
            it["id"] = cur.lastrowid

    rank_importance(day)
    pending = [i for i in day_items(day) if "summary" not in i["notes"]]
    if pending:
        ai, err = ai_notes(pending, server_settings())
        if err:
            log.append(f"AI summaries partly failed, used rule-based notes instead ({err})")
        elif ai:
            log.append(f"AI notes written for {len(ai)} items")
        with db.conn() as c:
            for it in pending:
                n = merge_notes(rule_notes(it), ai.get(it["id"]))
                a = ai.get(it["id"]) or {}
                if a.get("stage") in ("Prelims", "Mains", "Both"):
                    c.execute("UPDATE items SET stage=? WHERE id=?", (a["stage"], it["id"]))
                if n.get("importance"):
                    c.execute("UPDATE items SET importance=? WHERE id=?", (n["importance"], it["id"]))
                n["related_pyqs"] = it["notes"].get("related_pyqs", [])
                c.execute("UPDATE items SET notes=? WHERE id=?", (json.dumps(n), it["id"]))

    items = day_items(day)
    pdf = build_pdf(day, items) if items else None
    with db.conn() as c:
        c.execute("INSERT INTO runs(day,fetched_at,item_count,pdf_path,log) VALUES(?,?,?,?,?) "
                  "ON CONFLICT(day) DO UPDATE SET fetched_at=excluded.fetched_at, "
                  "item_count=excluded.item_count, pdf_path=excluded.pdf_path, log=excluded.log",
                  (day, datetime.now(ZoneInfo(TIMEZONE)).isoformat(timespec="seconds"),
                   len(items), pdf, "\n".join(log)))
    if fresh and pdf:
        db.notify("daily", f"Daily notes ready: {day}",
                  f"{len(items)} UPSC-relevant items. PDF is ready to download.", f"#/day/{day}")
    return {"day": day, "items": len(items), "new": len(fresh), "pdf": pdf, "log": log}
