"""One-off check of which PIB feed variants return English releases (run in GitHub Actions)."""
import httpx, feedparser
UA = {"User-Agent": "UPSC-CA-Portal/1.0 (personal study tool; RSS reader)"}
urls = [f"https://{h}pib.gov.in/RssMain.aspx?ModId=6&Lang={l}&Regid={r}"
        for h in ("", "www.") for l in (1, 2) for r in (1, 3)]
for u in urls:
    for extra in ({}, {"Accept-Language": "en-IN,en;q=0.9"}, {"Cookie": "PIB_Accessibility=Lang=1&Region=3"}):
        try:
            r = httpx.get(u, headers={**UA, **extra}, timeout=25, follow_redirects=True)
            f = feedparser.parse(r.content)
            t = [e.get("title", "")[:60] for e in f.entries[:2]]
            print(u, list(extra)[:1], r.status_code, len(f.entries), t)
        except Exception as e:
            print(u, list(extra)[:1], "ERR", e)
# English listing page as a fallback source
r = httpx.get("https://pib.gov.in/allRel.aspx", headers=UA, timeout=25, follow_redirects=True)
print("allRel", r.status_code, len(r.text), r.text.count("PRID="))
import re
print(re.findall(r'PRID=(\d+)[^>]*>([^<]{10,90})<', r.text)[:5])
