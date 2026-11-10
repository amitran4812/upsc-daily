"""One-off check of PIB's English release listing (run in GitHub Actions)."""
import re, httpx
UA = {"User-Agent": "UPSC-CA-Portal/1.0 (personal study tool; RSS reader)"}
with httpx.Client(headers=UA, follow_redirects=True, timeout=30) as c:
    r = c.get("https://pib.gov.in/allRel.aspx?reg=3&lang=1")
    t = r.text
    ids = re.findall(r"PRID=(\d+)", t)
    print("LEN", len(t), "PRIDS", len(ids), len(set(ids)))
    for m in list(re.finditer(r"PRID=\d+", t))[:4]:
        print("CTX", repr(t[max(0, m.start() - 200): m.end() + 200]))
    print("ULS", t.count("<li"), "MINISTRY", t.count("ministry"), t.count("Ministry"))
    i = t.find("Ministry of")
    print("MCTX", repr(t[i - 300:i + 600]))
    p = c.get(f"https://pib.gov.in/PressReleasePage.aspx?PRID={ids[0]}" if ids else "https://pib.gov.in")
    paras = [re.sub(r"<[^>]+>", " ", x) for x in re.findall(r"<p[^>]*>(.*?)</p>", p.text, re.S)]
    print("PAGE", p.status_code, [re.sub(r"\s+", " ", x).strip()[:150] for x in paras if len(x) > 80][:2])
