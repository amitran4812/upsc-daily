"""SQLite storage."""
import json, sqlite3, threading
from contextlib import contextmanager
from .config import DB_PATH

_lock = threading.Lock()

SCHEMA = """
CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day TEXT NOT NULL,
  source TEXT, section TEXT, title TEXT, link TEXT UNIQUE,
  excerpt TEXT, published TEXT,
  stage TEXT,            -- Prelims / Mains / Both
  papers TEXT,           -- JSON list e.g. ["GS2","GS3"]
  topics TEXT,           -- JSON list of subject tags
  pyq_themes TEXT,       -- JSON list of matched PYQ themes
  score REAL,
  importance TEXT,       -- High / Medium / Low
  notes TEXT,            -- JSON {summary, prelims, mains, question, ai}
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_items_day ON items(day);
CREATE TABLE IF NOT EXISTS runs (
  day TEXT PRIMARY KEY, fetched_at TEXT, item_count INTEGER,
  pdf_path TEXT, log TEXT
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE COLLATE NOCASE,
  pw_hash TEXT, salt TEXT, settings TEXT DEFAULT '{}', notif_seen INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY, user_id INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS user_notes (
  user_id INTEGER, item_id INTEGER, notes TEXT, PRIMARY KEY(user_id, item_id)
);
CREATE TABLE IF NOT EXISTS bookmarks (
  user_id INTEGER, item_id INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(user_id, item_id)
);
CREATE TABLE IF NOT EXISTS quizzes (
  month TEXT PRIMARY KEY, created_at TEXT, questions TEXT, ai TEXT
);
CREATE TABLE IF NOT EXISTS quiz_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, month TEXT, score INTEGER, total INTEGER,
  answers TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT, title TEXT, body TEXT,
  link TEXT, read INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
"""


@contextmanager
def conn():
    with _lock:
        c = sqlite3.connect(DB_PATH)
        c.row_factory = sqlite3.Row
        try:
            yield c
            c.commit()
        finally:
            c.close()


def init():
    with conn() as c:
        c.executescript(SCHEMA)


def get_setting(key, default=None):
    with conn() as c:
        r = c.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
    return json.loads(r["value"]) if r else default


def set_setting(key, value):
    with conn() as c:
        c.execute("INSERT INTO settings(key,value) VALUES(?,?) "
                  "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                  (key, json.dumps(value)))


def notify(kind, title, body, link=""):
    with conn() as c:
        c.execute("INSERT INTO notifications(kind,title,body,link) VALUES(?,?,?,?)",
                  (kind, title, body, link))


def row_to_item(r):
    d = dict(r)
    for k in ("papers", "topics", "pyq_themes", "notes"):
        d[k] = json.loads(d[k]) if d.get(k) else ([] if k != "notes" else {})
    return d
