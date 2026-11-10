"""AI summaries with each user's own Claude, Gemini or ChatGPT (OpenAI) API key."""
import json, os, re
import httpx

PROVIDERS = {
    "claude": {"label": "Claude (Anthropic)", "model": "claude-haiku-5-5",
               "key_hint": "console.anthropic.com → API keys"},
    "gemini": {"label": "Gemini (Google)", "model": "gemini-flash-latest",
               "key_hint": "aistudio.google.com → Get API key (free tier available)"},
    "openai": {"label": "ChatGPT (OpenAI)", "model": "gpt-4.1-mini",
               "key_hint": "platform.openai.com → API keys"},
}


def resolve(settings):
    """Return (provider, key, model) from a user's settings dict, or (None,..)."""
    s = settings or {}
    p = s.get("provider", "none")
    if p in PROVIDERS and s.get(f"{p}_key"):
        return p, s[f"{p}_key"], s.get(f"{p}_model") or PROVIDERS[p]["model"]
    return None, None, None


def server_settings():
    """Optional site-wide key (env vars) used for the shared daily notes and quizzes."""
    for p in PROVIDERS:
        k = os.environ.get(f"{p.upper()}_API_KEY")
        if k:
            return {"provider": p, f"{p}_key": k,
                    f"{p}_model": os.environ.get(f"{p.upper()}_MODEL", "")}
    return {}


def complete(prompt, settings, max_tokens=4096):
    p, key, model = resolve(settings)
    if not p:
        raise RuntimeError("No AI provider configured")
    if p == "claude":
        r = httpx.post("https://api.anthropic.com/v1/messages", timeout=180, headers={
            "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
            json={"model": model, "max_tokens": max_tokens,
                  "messages": [{"role": "user", "content": prompt}]})
        r.raise_for_status()
        return "".join(b.get("text", "") for b in r.json().get("content", []))
    if p == "openai":
        r = httpx.post("https://api.openai.com/v1/chat/completions", timeout=180, headers={
            "authorization": f"Bearer {key}", "content-type": "application/json"},
            json={"model": model, "max_completion_tokens": max_tokens,
                  "messages": [{"role": "user", "content": prompt}]})
        r.raise_for_status()
        return r.json()["choices"][0]["message"]["content"] or ""
    body = {"contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {"maxOutputTokens": max(max_tokens, 8192), "responseMimeType": "application/json"}}
    go = lambda m: httpx.post(f"https://generativelanguage.googleapis.com/v1beta/models/{m}:generateContent",
                              timeout=180, headers={"x-goog-api-key": key, "content-type": "application/json"}, json=body)
    r = go(model)
    if r.status_code in (400, 404):            # model retired: switch to the newest Flash model this key can use
        pick = best_gemini(key)
        if pick and pick != model:
            r = go(pick)
    if r.status_code >= 400:
        raise RuntimeError(f"Gemini {r.status_code}: {r.text[:500]}")
    cands = r.json().get("candidates", [])
    return "".join(x.get("text", "") for x in cands[0].get("content", {}).get("parts", [])) if cands else ""


def best_gemini(key):
    try:
        r = httpx.get("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000",
                      headers={"x-goog-api-key": key}, timeout=30)
        names = [m["name"].split("/", 1)[-1] for m in r.json().get("models", [])
                 if "generateContent" in m.get("supportedGenerationMethods", [])]
    except Exception:
        return None
    if "gemini-flash-latest" in names:
        return "gemini-flash-latest"
    bad = re.compile(r"(image|tts|audio|live|embed|vision|robotics|computer|exp|learnlm|gemma|nano|customtools)")

    def rank(n):
        m = re.search(r"gemini-(\d+(?:\.\d+)?)", n)
        return (float(m.group(1)) if m else 0) * 10 - ("preview" in n) - 4 * ("lite" in n) - 2 * ("pro" in n)
    ok = sorted((n for n in names if n.startswith("gemini-") and not bad.search(n)), key=rank, reverse=True)
    return next((n for n in ok if "flash" in n), ok[0] if ok else None)


def parse_json(text):
    text = text.strip()
    m = re.search(r"```(?:json)?\s*(.*?)```", text, re.S)
    if m:
        text = m.group(1)
    starts = [i for i in (text.find("["), text.find("{")) if i >= 0]
    return json.loads(text[min(starts) if starts else 0:])


NOTES_PROMPT = """You are a UPSC Civil Services Examination mentor. For each news item below,
write concise exam notes. Use only the facts in the item; do not invent numbers or names.
Return ONLY a JSON array, one object per item, with keys:
  "id": the item id,
  "importance": "High", "Medium" or "Low" for UPSC CSE (be strict: High only for issues UPSC
                is likely to ask about, judged by 2013-2025 previous-year patterns),
  "summary": 2-3 short bullet strings explaining the news,
  "prelims": 1-3 short factual pointers for Prelims, or [] if there is nothing exam-worthy,
  "mains": one sentence on the Mains angle and GS paper, or "" if it has no real Mains value,
  "question": a UPSC-style Mains practice question ONLY if importance is "High" and the topic is
              genuinely likely to be examined; otherwise "",
  "stage": "Prelims", "Mains" or "Both",
  "static": for Medium/High items, 1-2 objects {"title": ..., "facts": [2-3 short, well-established
            textbook facts], "upsc": one line on the exam angle} giving the STATIC syllabus background
            of a place, institution, law, constitutional article, species, scheme or concept in the
            news (e.g. a strait's location, which body publishes a report). Only facts you are sure of;
            otherwise [].
  "analysis": for Medium/High items, {"why": 1-2 sentences on why this news matters for India and
            for the UPSC aspirant, "angles": 2-4 objects {"dim": one of "International relations",
            "Internal security", "Economy", "Governance & polity", "Environment", "Society",
            "Science & tech", "Ethics", "Geography & disasters", "point": the specific implication for
            India in that dimension, 1-2 sentences}}. Example: for a request to extradite a former
            leader of Bangladesh, cover India–Bangladesh ties (IR), border management, illegal migration
            and North-East insurgent groups (Internal security), and the Extradition Act 1962 /
            political-offence exception (Governance). For Low items use null.
Avoid filler. Leave a field empty rather than writing something generic.

Items:
{items}
"""


def ai_notes(items, settings, batch=12):
    """Return ({id: notes}, error) for the given items using the given settings."""
    p, _, _ = resolve(settings)
    if not p:
        return {}, None
    out, errors = {}, None
    for i in range(0, len(items), batch):
        chunk = [{"id": it["id"], "source": it["source"], "title": it["title"],
                  "excerpt": it["excerpt"], "topics": it["topics"]} for it in items[i:i + batch]]
        try:
            data = parse_json(complete(NOTES_PROMPT.replace(
                "{items}", json.dumps(chunk, ensure_ascii=False)), settings))
            for d in data:
                if isinstance(d, dict) and "id" in d:
                    out[int(d["id"])] = d
        except Exception as e:
            errors = f"{PROVIDERS[p]['label']}: {e.__class__.__name__}: {str(e)[:160]}"
    return out, errors


def merge_notes(base, a):
    """Merge AI output `a` over rule-based notes `base`."""
    if not a:
        return base
    n = dict(base)
    if isinstance(a.get("static"), list) and a["static"]:
        n["static"] = [x for x in a["static"] if isinstance(x, dict) and x.get("title")][:2] or n.get("static", [])
    an = a.get("analysis")
    if isinstance(an, dict) and isinstance(an.get("angles"), list):
        angles = [x for x in an["angles"] if isinstance(x, dict) and x.get("point")][:4]
        if angles:
            n["analysis"] = {"why": str(an.get("why") or ""), "angles": angles,
                             "themes": (base.get("analysis") or {}).get("themes", [])}
    for k in ("summary", "prelims", "mains"):
        if k in a:
            n[k] = a[k] or ([] if k != "mains" else "")
    if a.get("importance") in ("High", "Medium", "Low"):
        n["importance"] = a["importance"]
    if a.get("question") and n.get("importance", a.get("importance")) == "High":
        n["question"] = a["question"]
    else:
        n.pop("question", None)
    if not n.get("summary"):
        n["summary"] = base.get("summary", [])
    n["ai"] = True
    return n
