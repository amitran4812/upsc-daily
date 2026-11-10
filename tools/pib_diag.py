"""One-off check of which PIB feed variants return English releases (run in GitHub Actions)."""
import re, httpx, feedparser
UA = {"User-Agent": "UPSC-CA-Portal/1.0 (personal study tool; RSS reader)"}
for warm in ("https://pib.gov.in/allRel.aspx?reg=3&lang=1", "https://pib.gov.in/index.aspx?reg=3&lang=1",
             "https://pib.gov.in/allRel.aspx?lang=1&reg=3"):
    with httpx.Client(headers=UA, follow_redirects=True, timeout=25) as c:
        r = c.get(warm)
        print("WARM", warm, r.status_code, dict(c.cookies), re.findall(r'PRID=(\d+)[^>]*>([^<]{10,80})<', r.text)[:2])
        for l in (1, 2):
            f = feedparser.parse(c.get(f"https://pib.gov.in/RssMain.aspx?ModId=6&Lang={l}&Regid=3").content)
            print("  RSS Lang", l, len(f.entries), [e.get("title", "")[:60] for e in f.entries[:2]])
