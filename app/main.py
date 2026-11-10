"""FastAPI app: JSON API, user accounts with cross-device sync, static PWA, scheduler."""
import hashlib, json, os, secrets, threading, time
from datetime import date
from pathlib import Path
from apscheduler.schedulers.background import BackgroundScheduler
from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from . import db
from .ai import PROVIDERS, ai_notes, complete, merge_notes
from .config import DAILY_FETCH_HOUR, DAILY_FETCH_MINUTE, PDF_DIR, TIMEZONE
from .notes import rule_notes
from .pdfgen import build_pdf
from .pipeline import day_items, run_daily, today
from .pyq_themes import PAPER_LABELS
from .quiz import generate_quiz

app = FastAPI(title="UPSC Current Affairs")
STATIC = Path(__file__).parent / "static"
COOKIE = "upsc_session"
SECURE_COOKIE = os.environ.get("SECURE_COOKIES", "1") == "1"
_job_lock = threading.Lock()
status = {"running": False, "last": None}


# ---------------- background jobs ----------------
def _run_job(day=None, **kw):
    if not _job_lock.acquire(blocking=False):
        return
    status["running"] = True
    try:
        status["last"] = run_daily(day, **kw)
    except Exception as e:
        status["last"] = {"error": f"{e.__class__.__name__}: {e}"}
    finally:
        status["running"] = False
        _job_lock.release()


def _prev_month():
    t = date.today().replace(day=1)
    return (date(t.year - 1, 12, 1) if t.month == 1 else date(t.year, t.month - 1, 1)).strftime("%Y-%m")


def _catch_up():
    with db.conn() as c:
        has_today = c.execute("SELECT 1 FROM runs WHERE day=?", (today(),)).fetchone()
        has_quiz = c.execute("SELECT 1 FROM quizzes WHERE month=?", (_prev_month(),)).fetchone()
    if not has_today:
        _run_job()
    if not has_quiz:
        generate_quiz(_prev_month())


scheduler = BackgroundScheduler(timezone=TIMEZONE)


@app.on_event("startup")
def startup():
    db.init()
    with db.conn() as c:   # light migration for databases created by older builds
        cols = {r[1] for r in c.execute("PRAGMA table_info(items)")}
        if "importance" not in cols:
            c.execute("ALTER TABLE items ADD COLUMN importance TEXT")
    if os.environ.get("UPSC_DISABLE_SCHEDULER"):
        return
    scheduler.add_job(_run_job, "cron", hour=DAILY_FETCH_HOUR, minute=DAILY_FETCH_MINUTE,
                      id="daily", replace_existing=True, misfire_grace_time=6 * 3600)
    # a second, later pass picks up PIB releases published during the day
    scheduler.add_job(_run_job, "cron", hour=19, minute=30, id="evening",
                      replace_existing=True, misfire_grace_time=3 * 3600)
    scheduler.add_job(lambda: generate_quiz(_prev_month()), "cron", day=1, hour=8,
                      id="monthly", replace_existing=True, misfire_grace_time=24 * 3600)
    scheduler.start()
    threading.Thread(target=_catch_up, daemon=True).start()


@app.on_event("shutdown")
def shutdown():
    if scheduler.running:
        scheduler.shutdown(wait=False)


# ---------------- accounts ----------------
def _hash(pw, salt):
    return hashlib.scrypt(pw.encode(), salt=bytes.fromhex(salt), n=2 ** 14, r=8, p=1).hex()


_fails = {}


def current_user(request: Request):
    tok = request.cookies.get(COOKIE) or request.headers.get("x-session")
    if not tok:
        return None
    with db.conn() as c:
        r = c.execute("SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=?",
                      (tok,)).fetchone()
    if not r:
        return None
    u = dict(r)
    u["settings"] = json.loads(u["settings"] or "{}")
    return u


def require_user(u=Depends(current_user)):
    if not u:
        raise HTTPException(401, "Please sign in")
    return u


class Credentials(BaseModel):
    username: str
    password: str


def _start_session(resp: Response, user_id: int):
    tok = secrets.token_urlsafe(32)
    with db.conn() as c:
        c.execute("INSERT INTO sessions(token,user_id) VALUES(?,?)", (tok, user_id))
    resp.set_cookie(COOKIE, tok, max_age=365 * 86400, httponly=True, samesite="lax",
                    secure=SECURE_COOKIE)


def _public_user(u):
    return {"username": u["username"]}


@app.post("/api/auth/register")
def register(cr: Credentials, resp: Response):
    name = cr.username.strip()
    if not (3 <= len(name) <= 30) or not name.replace("_", "").replace(".", "").isalnum():
        raise HTTPException(400, "Username: 3-30 letters, numbers, dot or underscore")
    if len(cr.password) < 6:
        raise HTTPException(400, "Password must be at least 6 characters")
    salt = secrets.token_hex(16)
    try:
        with db.conn() as c:
            cur = c.execute("INSERT INTO users(username,pw_hash,salt) VALUES(?,?,?)",
                            (name, _hash(cr.password, salt), salt))
            uid = cur.lastrowid
            # new users start with all past notifications already seen
            mx = c.execute("SELECT COALESCE(MAX(id),0) FROM notifications").fetchone()[0]
            c.execute("UPDATE users SET notif_seen=? WHERE id=?", (mx, uid))
    except Exception:
        raise HTTPException(409, "That username is taken")
    _start_session(resp, uid)
    return {"username": name}


@app.post("/api/auth/login")
def login(cr: Credentials, resp: Response, request: Request):
    key = (request.client.host if request.client else "?", cr.username.lower())
    recent = [t for t in _fails.get(key, []) if t > time.time() - 600]
    if len(recent) >= 8:
        raise HTTPException(429, "Too many attempts. Try again in 10 minutes.")
    with db.conn() as c:
        r = c.execute("SELECT * FROM users WHERE username=?", (cr.username.strip(),)).fetchone()
    if not r or not secrets.compare_digest(_hash(cr.password, r["salt"]), r["pw_hash"]):
        _fails[key] = recent + [time.time()]
        raise HTTPException(401, "Wrong username or password")
    _start_session(resp, r["id"])
    return {"username": r["username"]}


@app.post("/api/auth/logout")
def logout(request: Request, resp: Response):
    tok = request.cookies.get(COOKIE)
    if tok:
        with db.conn() as c:
            c.execute("DELETE FROM sessions WHERE token=?", (tok,))
    resp.delete_cookie(COOKIE)
    return {"ok": True}


@app.get("/api/me")
def me(u=Depends(current_user)):
    return _public_user(u) if u else None


# ---------------- news ----------------
def _with_user_notes(items, u):
    if not u or not items:
        return items
    ids = [i["id"] for i in items]
    with db.conn() as c:
        rows = c.execute(f"SELECT item_id,notes FROM user_notes WHERE user_id=? AND item_id IN "
                         f"({','.join('?' * len(ids))})", [u["id"], *ids]).fetchall()
        marks = {r[0] for r in c.execute("SELECT item_id FROM bookmarks WHERE user_id=?", (u["id"],))}
    mine = {r["item_id"]: json.loads(r["notes"]) for r in rows}
    for i in items:
        if i["id"] in mine:
            i["notes"] = {**mine[i["id"]], "related_pyqs": i["notes"].get("related_pyqs", [])}
            i["importance"] = mine[i["id"]].get("importance") or i["importance"]
        i["bookmarked"] = i["id"] in marks
    return items


@app.get("/api/overview")
def overview(u=Depends(current_user)):
    with db.conn() as c:
        runs = [dict(r) for r in c.execute(
            "SELECT day,fetched_at,item_count,pdf_path FROM runs ORDER BY day DESC LIMIT 400")]
        total = c.execute("SELECT COUNT(*) FROM items").fetchone()[0]
    for r in runs:
        r["has_pdf"] = bool(r.pop("pdf_path"))
    job = scheduler.get_job("daily") if scheduler.running else None
    return {"today": today(), "runs": runs, "total_items": total, "user": _public_user(u) if u else None,
            "running": status["running"],
            "next_fetch": job.next_run_time.isoformat() if job and job.next_run_time else None,
            "papers": PAPER_LABELS}


@app.get("/api/day/{day}")
def get_day(day: str, u=Depends(current_user)):
    with db.conn() as c:
        run = c.execute("SELECT day,fetched_at,item_count,log FROM runs WHERE day=?", (day,)).fetchone()
    return {"day": day, "run": dict(run) if run else None, "items": _with_user_notes(day_items(day), u)}


@app.post("/api/fetch")
def fetch_now(u=Depends(require_user)):
    if status["running"]:
        return {"started": False, "message": "A fetch is already running."}
    threading.Thread(target=_run_job, daemon=True).start()
    return {"started": True}


@app.get("/api/pdf/{day}")
def pdf(day: str, mine: int = 0, u=Depends(current_user)):
    try:
        date.fromisoformat(day)
    except ValueError:
        raise HTTPException(400, "Bad date")
    if mine and u:
        items = _with_user_notes(day_items(day), u)
        if not items:
            raise HTTPException(404, "No notes for this day")
        p = Path(build_pdf(day, items, PDF_DIR / "users" / str(u["id"])))
    else:
        p = PDF_DIR / f"UPSC-CA-{day}.pdf"
    if not p.exists():
        raise HTTPException(404, "No PDF for this day")
    return FileResponse(p, media_type="application/pdf", filename=p.name)


@app.get("/api/search")
def search(q: str = "", paper: str = "", stage: str = "", importance: str = "",
           saved: int = 0, limit: int = 100, u=Depends(current_user)):
    sql, args = "SELECT * FROM items WHERE 1=1", []
    if q:
        sql += " AND (title LIKE ? OR excerpt LIKE ? OR topics LIKE ?)"
        args += [f"%{q}%"] * 3
    if paper:
        sql += " AND papers LIKE ?"
        args.append(f'%"{paper}"%')
    if stage:
        sql += " AND (stage=? OR stage='Both')"
        args.append(stage)
    if importance:
        sql += " AND importance=?"
        args.append(importance)
    if saved and u:
        sql += " AND id IN (SELECT item_id FROM bookmarks WHERE user_id=?)"
        args.append(u["id"])
    sql += " ORDER BY day DESC, score DESC LIMIT ?"
    args.append(min(limit, 300))
    with db.conn() as c:
        items = [db.row_to_item(r) for r in c.execute(sql, args)]
    return _with_user_notes(items, u)


@app.post("/api/bookmark/{item_id}")
def bookmark(item_id: int, u=Depends(require_user)):
    with db.conn() as c:
        if c.execute("SELECT 1 FROM bookmarks WHERE user_id=? AND item_id=?", (u["id"], item_id)).fetchone():
            c.execute("DELETE FROM bookmarks WHERE user_id=? AND item_id=?", (u["id"], item_id))
            return {"bookmarked": False}
        c.execute("INSERT INTO bookmarks(user_id,item_id) VALUES(?,?)", (u["id"], item_id))
    return {"bookmarked": True}


# ---------------- per-user AI notes ----------------
ai_jobs = {}


class DayReq(BaseModel):
    day: str


@app.post("/api/ai/notes")
def ai_day_notes(r: DayReq, u=Depends(require_user)):
    """Write AI notes for a day with the user's own key (stored for this user only)."""
    if ai_jobs.get(u["id"]) == "running":
        return {"started": False, "message": "Already working on it."}
    items = day_items(r.day)
    if not items:
        raise HTTPException(404, "No items for this day")

    def job():
        ai_jobs[u["id"]] = "running"
        try:
            out, err = ai_notes(items, u["settings"])
            with db.conn() as c:
                for it in items:
                    if it["id"] in out:
                        n = merge_notes(rule_notes(it), out[it["id"]])
                        c.execute("INSERT INTO user_notes(user_id,item_id,notes) VALUES(?,?,?) "
                                  "ON CONFLICT(user_id,item_id) DO UPDATE SET notes=excluded.notes",
                                  (u["id"], it["id"], json.dumps(n)))
            ai_jobs[u["id"]] = f"error: {err}" if err and not out else f"done:{len(out)}"
        except Exception as e:
            ai_jobs[u["id"]] = f"error: {e}"

    threading.Thread(target=job, daemon=True).start()
    return {"started": True}


@app.get("/api/ai/status")
def ai_status(u=Depends(require_user)):
    return {"status": ai_jobs.get(u["id"], "idle")}


# ---------------- quiz ----------------
@app.get("/api/quizzes")
def quizzes(u=Depends(current_user)):
    with db.conn() as c:
        qs = [dict(r) for r in c.execute("SELECT month,created_at,ai,questions FROM quizzes ORDER BY month DESC")]
        att = {}
        if u:
            att = {r["month"]: dict(r) for r in c.execute(
                "SELECT month,MAX(score) score,total FROM quiz_attempts WHERE user_id=? GROUP BY month",
                (u["id"],))}
    for q in qs:
        q["count"] = len(json.loads(q.pop("questions")))
        q["best"] = att.get(q["month"])
    return qs


@app.get("/api/quiz/{month}")
def quiz(month: str):
    with db.conn() as c:
        r = c.execute("SELECT * FROM quizzes WHERE month=?", (month,)).fetchone()
    if not r:
        raise HTTPException(404, "No quiz for this month")
    return {"month": month, "ai": r["ai"], "questions": json.loads(r["questions"])}


class Attempt(BaseModel):
    answers: list


@app.post("/api/quiz/{month}/attempt")
def attempt(month: str, a: Attempt, u=Depends(current_user)):
    qs = quiz(month)["questions"]
    score = sum(1 for q, ans in zip(qs, a.answers) if ans == q["answer"])
    if u:
        with db.conn() as c:
            c.execute("INSERT INTO quiz_attempts(user_id,month,score,total,answers) VALUES(?,?,?,?,?)",
                      (u["id"], month, score, len(qs), json.dumps(a.answers)))
    return {"score": score, "total": len(qs)}


class QuizReq(BaseModel):
    month: str | None = None


@app.post("/api/quiz/generate")
def quiz_generate(r: QuizReq, u=Depends(require_user)):
    return generate_quiz(r.month, settings=u["settings"])


# ---------------- notifications ----------------
@app.get("/api/notifications")
def notifications(u=Depends(current_user)):
    seen = u["notif_seen"] if u else 10 ** 12
    with db.conn() as c:
        ns = [dict(r) for r in c.execute("SELECT id,kind,title,body,link,created_at FROM notifications "
                                         "ORDER BY id DESC LIMIT 30")]
    for n in ns:
        n["read"] = n["id"] <= seen
    return ns


@app.post("/api/notifications/read")
def notifications_read(u=Depends(require_user)):
    with db.conn() as c:
        mx = c.execute("SELECT COALESCE(MAX(id),0) FROM notifications").fetchone()[0]
        c.execute("UPDATE users SET notif_seen=? WHERE id=?", (mx, u["id"]))
    return {"ok": True}


# ---------------- settings (synced per user) ----------------
def _mask(k):
    return (k[:5] + "…" + k[-4:]) if k and len(k) > 12 else ("set" if k else "")


@app.get("/api/settings")
def get_settings(u=Depends(require_user)):
    s = u["settings"]
    out = {"provider": s.get("provider", "none"), "providers": PROVIDERS}
    for p in PROVIDERS:
        out[f"{p}_key"] = _mask(s.get(f"{p}_key", ""))
        out[f"{p}_model"] = s.get(f"{p}_model") or PROVIDERS[p]["model"]
    return out


class SettingsReq(BaseModel):
    provider: str = "none"
    claude_key: str | None = None
    gemini_key: str | None = None
    openai_key: str | None = None
    claude_model: str | None = None
    gemini_model: str | None = None
    openai_model: str | None = None


@app.post("/api/settings")
def save_settings(r: SettingsReq, u=Depends(require_user)):
    cur = dict(u["settings"])
    cur["provider"] = r.provider if r.provider in PROVIDERS else "none"
    for p in PROVIDERS:
        v = getattr(r, f"{p}_key")
        if v is not None and "…" not in v and v != "set":     # masked value means unchanged
            cur[f"{p}_key"] = v.strip()
        m = getattr(r, f"{p}_model")
        if m:
            cur[f"{p}_model"] = m.strip()
    with db.conn() as c:
        c.execute("UPDATE users SET settings=? WHERE id=?", (json.dumps(cur), u["id"]))
    u["settings"] = cur
    return get_settings(u)


@app.post("/api/settings/test")
def test_ai(u=Depends(require_user)):
    s = u["settings"]
    if s.get("provider", "none") == "none":
        return {"ok": False, "message": "Choose Claude, Gemini or ChatGPT first."}
    try:
        out = complete('Reply with exactly this JSON: {"ok": true}', s, max_tokens=50)
        return {"ok": True, "message": f"Connected. {PROVIDERS[s['provider']]['label']} replied: {out.strip()[:60]}"}
    except Exception as e:
        return {"ok": False, "message": f"Could not connect: {str(e)[:200]}"}


# ---------------- static PWA ----------------
app.mount("/static", StaticFiles(directory=STATIC), name="static")


@app.get("/sw.js")
def sw():
    return FileResponse(STATIC / "sw.js", media_type="application/javascript",
                        headers={"Service-Worker-Allowed": "/", "Cache-Control": "no-cache"})


@app.get("/manifest.webmanifest")
def manifest():
    return FileResponse(STATIC / "manifest.webmanifest", media_type="application/manifest+json")


@app.get("/api/lan")
def lan_links(request: Request):
    """Links other devices on the same Wi-Fi can use to open the portal."""
    import socket
    ips = set()
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))
            ips.add(s.getsockname()[0])
    except OSError:
        pass
    port = request.url.port or 8765
    return {"links": [f"http://{ip}:{port}" for ip in sorted(ips) if not ip.startswith("127.")]}


@app.get("/healthz")
def health():
    return {"ok": True}


@app.get("/")
def index():
    return FileResponse(STATIC / "index.html", headers={"Cache-Control": "no-cache"})
