"""Fetch PIB and The Hindu RSS feeds politely (official feeds only)."""
import html, re, time
from datetime import datetime, timezone
import feedparser, httpx
from bs4 import BeautifulSoup
from .config import FEEDS, USER_AGENT, MAX_EXCERPT_CHARS


def clean(text):
    text = BeautifulSoup(html.unescape(text or ""), "html.parser").get_text(" ")
    return re.sub(r"\s+", " ", text).strip()


def shorten(text, n=MAX_EXCERPT_CHARS):
    if len(text) <= n:
        return text
    cut = text[:n].rsplit(" ", 1)[0]
    return cut.rstrip(",;:") + "…"


def _published(entry):
    for k in ("published_parsed", "updated_parsed"):
        if entry.get(k):
            return datetime(*entry[k][:6], tzinfo=timezone.utc).isoformat()
    return ""


def pib_excerpt(client, url):
    """PIB releases are government content; take the opening paragraph only."""
    try:
        r = client.get(url, timeout=20)
        soup = BeautifulSoup(r.text, "html.parser")
        paras = [clean(p.get_text(" ")) for p in soup.find_all("p")]
        paras = [p for p in paras if len(p) > 80 and "Posted On" not in p]
        return shorten(" ".join(paras[:2]))
    except Exception:
        return ""


def pib_listing(client, url, limit=30):
    """Parse PIB's English 'All Releases' page: <h3>Ministry</h3> followed by release links."""
    soup = BeautifulSoup(client.get(url, timeout=30).text, "html.parser")
    out = []
    for h3 in soup.find_all("h3"):
        ministry = clean(h3.get_text(" "))
        ul = h3.find_next_sibling("ul")
        if not ul:
            continue
        for a in ul.find_all("a", href=True):
            m = re.search(r"PRID=(\d+)", a["href"])
            title = clean(a.get("title") or a.get_text(" "))
            if m and title:
                out.append({"title": title, "ministry": ministry,
                            "link": f"https://pib.gov.in/PressReleasePage.aspx?PRID={m.group(1)}"})
    return out[:limit]


def fetch_all(feeds=FEEDS, get=None, log=None):
    """Return a list of raw items. `get(url)` can be injected for tests."""
    log = log if log is not None else []
    items, seen = [], set()
    with httpx.Client(headers={"User-Agent": USER_AGENT}, follow_redirects=True) as client:
        for f in feeds:
            if f.get("kind") == "pib_listing" and not get:
                try:
                    rel = pib_listing(client, f["url"])
                except Exception as e:
                    log.append(f"PIB listing: failed ({e.__class__.__name__})")
                    continue
                for x in rel:
                    if x["link"] in seen:
                        continue
                    seen.add(x["link"])
                    excerpt = pib_excerpt(client, x["link"])
                    time.sleep(0.4)   # be gentle with the server
                    items.append({"source": "PIB", "section": x["ministry"], "title": x["title"],
                                  "link": x["link"], "excerpt": excerpt,
                                  "published": datetime.now(timezone.utc).isoformat()})
                log.append(f"PIB / English releases: {len(rel)} items")
                continue
            try:
                body = get(f["url"]) if get else client.get(f["url"], timeout=25).content
                parsed = feedparser.parse(body)
            except Exception as e:
                log.append(f"{f['source']} / {f['section']}: failed ({e.__class__.__name__})")
                continue
            n = 0
            for e in parsed.entries:
                link = (e.get("link") or "").strip()
                title = clean(e.get("title"))
                if not link or not title or link in seen:
                    continue
                if sum(1 for ch in title if ord(ch) > 0x0900) > len(title) * 0.3:
                    continue   # English notes only (skip Hindi/regional-language releases)
                seen.add(link)
                excerpt = shorten(clean(e.get("summary") or e.get("description")))
                if not excerpt and f["source"] == "PIB" and not get:
                    excerpt = pib_excerpt(client, link)
                    time.sleep(0.3)   # be gentle with the server
                items.append({"source": f["source"], "section": f["section"], "title": title,
                              "link": link, "excerpt": excerpt, "published": _published(e)})
                n += 1
            log.append(f"{f['source']} / {f['section']}: {n} items")
    return items
