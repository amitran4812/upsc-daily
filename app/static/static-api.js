// Serverless API used by the GitHub Pages build. News, PDFs and quizzes come from JSON files that
// the daily GitHub Action publishes; personal data (saved items, quiz scores, AI keys, AI notes)
// stays in this browser's storage. AI calls go straight from the device to the chosen provider.
(() => {
  const PROVIDERS = {
    claude: { label: "Claude (Anthropic)", model: "claude-haiku-5-5", key_hint: "console.anthropic.com → API keys" },
    gemini: { label: "Gemini (Google)", model: "gemini-flash-latest", key_hint: "aistudio.google.com → Get API key (free tier available)" },
    openai: { label: "ChatGPT (OpenAI)", model: "gpt-4.1-mini", key_hint: "platform.openai.com → API keys" },
  };
  const ls = {
    get(k, d) { try { const v = localStorage.getItem("upsc:" + k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) {
      try { localStorage.setItem("upsc:" + k, JSON.stringify(v)); } catch {}
      if (window.SYNC?.SYNCED.includes(k)) window.SYNC.push();
    },
  };
  const cache = {};
  async function json(path, fresh = false) {
    if (!fresh && cache[path]) return cache[path];
    const r = await fetch(path + (fresh ? `?t=${Date.now()}` : ""), { cache: fresh ? "no-store" : "default" });
    if (!r.ok) { if (r.status === 404) return null; throw new Error(r.statusText); }
    return (cache[path] = await r.json());
  }
  function personalise(items) {
    const marks = new Set(ls.get("bookmarks", [])), mine = ls.get("ai_notes", {});
    return (items || []).map((i) => {
      const n = mine[i.id];
      const out = { ...i, bookmarked: marks.has(i.id) };
      if (n) { out.notes = { ...n, related_pyqs: i.notes?.related_pyqs || [] }; out.importance = n.importance || i.importance; }
      return out;
    });
  }
  const mask = (k) => (k && k.length > 12 ? k.slice(0, 5) + "…" + k.slice(-4) : k ? "set" : "");

  // ---- AI (browser → provider) ----
  async function errText(r) {
    const t = await r.text();
    try { const j = JSON.parse(t); return `${r.status} ${j.error?.message || j.message || t}`.slice(0, 600); } catch { return `${r.status} ${t.slice(0, 600)}`; }
  }
  // Google retires Gemini model names now and then. If the saved model is gone (404), look up
  // the models this key can use, pick the newest regular Flash model, save it and try again.
  async function geminiModels(key) {
    const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000", { headers: { "x-goog-api-key": key } });
    if (!r.ok) throw new Error(await errText(r));
    return ((await r.json()).models || []).filter((m) => (m.supportedGenerationMethods || []).includes("generateContent")).map((m) => m.name.replace(/^models\//, ""));
  }
  function bestGemini(names) {
    if (names.includes("gemini-flash-latest")) return "gemini-flash-latest";
    const bad = /(image|tts|audio|live|embed|vision|robotics|computer|exp|learnlm|gemma|nano|customtools)/;
    const ver = (n) => parseFloat((n.match(/gemini-(\d+(?:\.\d+)?)/) || [])[1] || 0);
    const rank = (n) => ver(n) * 10 - (/preview/.test(n) ? 1 : 0) - (/lite/.test(n) ? 4 : 0) - (/pro/.test(n) ? 2 : 0);
    const ok = names.filter((n) => /^gemini-/.test(n) && !bad.test(n)).sort((a, b) => rank(b) - rank(a));
    return ok.find((n) => /flash/.test(n)) || ok[0] || null;
  }
  async function geminiGenerate(s, body) {
    const key = s.gemini_key; let model = s.gemini_model || PROVIDERS.gemini.model;
    if (!key) throw new Error("No Gemini API key saved");
    const go = (m) => fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, { method: "POST",
      headers: { "x-goog-api-key": key, "content-type": "application/json" }, body: JSON.stringify(body) });
    let r = await go(model);
    if (r.status === 404 || r.status === 400) {
      const err = await errText(r);
      if (r.status === 400 && !/model|not found|not supported/i.test(err)) throw new Error("Gemini: " + err);
      const pick = bestGemini(await geminiModels(key).catch(() => []));
      if (!pick || pick === model) throw new Error("Gemini: " + err);
      model = pick; r = await go(model);
      if (r.ok) { const st = ls.get("settings", {}); st.gemini_model = model; ls.set("settings", st); s.gemini_model = model; }
    }
    if (!r.ok) throw new Error("Gemini: " + (await errText(r)));
    const j = await r.json(); j._model = model; return j;
  }
  window.UPSC_GEMINI = { generate: geminiGenerate, models: geminiModels, best: bestGemini };
  async function complete(prompt, s, maxTokens = 4096) {
    const p = s.provider, key = s[p + "_key"], model = s[p + "_model"] || PROVIDERS[p].model;
    if (!key) throw new Error("No API key saved");
    let r;
    if (p === "claude") {
      r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: {
        "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json",
        "anthropic-dangerous-direct-browser-access": "true" },
        body: JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: "user", content: prompt }] }) });
      if (!r.ok) throw new Error(await errText(r));
      return (await r.json()).content.map((b) => b.text || "").join("");
    }
    if (p === "openai") {
      r = await fetch("https://api.openai.com/v1/chat/completions", { method: "POST", headers: {
        authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({ model, max_completion_tokens: maxTokens, messages: [{ role: "user", content: prompt }] }) });
      if (!r.ok) throw new Error(await errText(r));
      return (await r.json()).choices[0].message.content || "";
    }
    const j = await geminiGenerate(s, { contents: [{ parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: Math.max(maxTokens, 8192), responseMimeType: "application/json" } });
    const c = j.candidates || [];
    return c.length && c[0].content ? (c[0].content.parts || []).map((x) => x.text || "").join("") : "";
  }
  function parseJson(t) {
    t = t.trim(); const m = t.match(/```(?:json)?\s*([\s\S]*?)```/); if (m) t = m[1];
    const starts = [t.indexOf("["), t.indexOf("{")].filter((i) => i >= 0);
    return JSON.parse(t.slice(starts.length ? Math.min(...starts) : 0));
  }
  let aiStatus = "idle";
  async function aiNotes(day) {
    const s = ls.get("settings", { provider: "none" });
    const d = await json(`data/day/${day}.json`);
    const prompt = (await json("data/meta.json")).notes_prompt;
    aiStatus = "running";
    try {
      const store = ls.get("ai_notes", {}); let n = 0;
      for (let i = 0; i < d.items.length; i += 12) {
        const chunk = d.items.slice(i, i + 12).map((x) => ({ id: x.id, source: x.source, title: x.title, excerpt: x.excerpt, topics: x.topics }));
        const out = parseJson(await complete(prompt.replace("{items}", JSON.stringify(chunk)), s));
        for (const a of out) {
          const base = d.items.find((x) => x.id === +a.id); if (!base) continue;
          const note = { ...base.notes, ai: true };
          ["summary", "prelims", "mains"].forEach((k) => { if (k in a) note[k] = a[k]; });
          if (["High", "Medium", "Low"].includes(a.importance)) note.importance = a.importance;
          if (a.analysis && Array.isArray(a.analysis.angles) && a.analysis.angles.length)
            note.analysis = { why: a.analysis.why || "", angles: a.analysis.angles.filter((x) => x && x.point).slice(0, 4), themes: base.notes.analysis?.themes || [] };
          if (Array.isArray(a.static) && a.static.length) note.static = a.static.filter((x) => x && x.title).slice(0, 2);
          if (a.question && (note.importance || base.importance) === "High") note.question = a.question; else delete note.question;
          store[base.id] = note; n++;
        }
      }
      ls.set("ai_notes", store);
      aiStatus = `done:${n}`;
    } catch (e) { aiStatus = "error: " + e.message; }
  }

  window.STATIC_API = async (path, opts = {}) => {
    const method = (opts.method || "GET").toUpperCase();
    const body = opts.body ? JSON.parse(opts.body) : {};
    const url = new URL(path, location.href); const p = url.pathname.replace(/^.*?\/api\//, "/api/"); const q = url.searchParams;
    if (p === "/api/overview") { const o = await json("data/overview.json", true); return { ...(o || { runs: [], total_items: 0 }), user: { username: "" }, running: false, next_fetch: null }; }
    if (p.startsWith("/api/day/")) { const d = await json(`data/day/${p.split("/").pop()}.json`); return d ? { ...d, items: personalise(d.items) } : { day: p.split("/").pop(), items: [] }; }
    if (p === "/api/search") {
      const all = personalise((await json("data/all.json", true)) || []);
      const s = (q.get("q") || "").toLowerCase(), paper = q.get("paper"), stage = q.get("stage"), imp = q.get("importance"), saved = q.get("saved") === "1";
      return all.filter((i) => (!s || (i.title + i.excerpt + i.topics.join(" ")).toLowerCase().includes(s)) && (!paper || i.papers.includes(paper)) &&
        (!stage || i.stage === stage || i.stage === "Both") && (!imp || i.importance === imp) && (!saved || i.bookmarked)).slice(0, 200);
    }
    if (p.startsWith("/api/bookmark/")) {
      const id = +p.split("/").pop(); const m = new Set(ls.get("bookmarks", []));
      const on = !m.has(id); on ? m.add(id) : m.delete(id); ls.set("bookmarks", [...m]); return { bookmarked: on };
    }
    if (p === "/api/quizzes") {
      const best = ls.get("quiz_best", {});
      return ((await json("data/quizzes.json", true)) || []).map((x) => ({ ...x, best: best[x.month] || null }));
    }
    if (p.match(/^\/api\/quiz\/[\d-]+\/attempt$/)) {
      const m = p.split("/")[3]; const qz = await json(`data/quiz/${m}.json`);
      const score = qz.questions.reduce((a, x, i) => a + (body.answers[i] === x.answer ? 1 : 0), 0);
      const best = ls.get("quiz_best", {}); if (!best[m] || best[m].score < score) best[m] = { score, total: qz.questions.length }; ls.set("quiz_best", best);
      return { score, total: qz.questions.length };
    }
    if (p === "/api/quiz/generate") return { error: "New quizzes are published automatically on the 1st of each month." };
    if (p.startsWith("/api/quiz/")) { const qz = await json(`data/quiz/${p.split("/").pop()}.json`); if (!qz) throw new Error("No quiz for this month"); return qz; }
    if (p === "/api/notifications") {
      const seen = ls.get("notif_seen", null);
      const ns = (await json("data/notifications.json", true)) || [];
      if (seen === null) { ls.set("notif_seen", ns[0]?.id || 0); return ns.map((n) => ({ ...n, read: true })); }
      return ns.map((n) => ({ ...n, read: n.id <= seen }));
    }
    if (p === "/api/notifications/read") { const ns = (await json("data/notifications.json")) || []; ls.set("notif_seen", ns[0]?.id || 0); return { ok: true }; }
    if (p === "/api/settings" && method === "GET") {
      const s = ls.get("settings", { provider: "none" }); const out = { provider: s.provider || "none", providers: PROVIDERS };
      for (const k of Object.keys(PROVIDERS)) { out[k + "_key"] = mask(s[k + "_key"]); out[k + "_model"] = s[k + "_model"] || PROVIDERS[k].model; }
      return out;
    }
    if (p === "/api/settings") {
      const s = ls.get("settings", {}); s.provider = PROVIDERS[body.provider] ? body.provider : "none";
      for (const k of Object.keys(PROVIDERS)) {
        const v = body[k + "_key"]; if (v != null && !v.includes("…") && v !== "set") s[k + "_key"] = v.trim();
        if (body[k + "_model"]) s[k + "_model"] = body[k + "_model"].trim();
      }
      ls.set("settings", s); return window.STATIC_API("api/settings");
    }
    if (p === "/api/settings/test") {
      const s = ls.get("settings", { provider: "none" });
      if (!PROVIDERS[s.provider]) return { ok: false, message: "Choose Claude, Gemini or ChatGPT first." };
      try { const o = await complete('Reply with exactly this JSON: {"ok": true}', s, 1024); return { ok: true, message: `Connected. ${PROVIDERS[s.provider].label}${s.provider === "gemini" ? ` (model ${s.gemini_model || PROVIDERS.gemini.model})` : ""} replied: ${o.trim().slice(0, 60)}` }; }
      catch (e) { return { ok: false, message: "Could not connect: " + e.message }; }
    }
    if (p === "/api/ai/notes") { if (aiStatus === "running") return { started: false, message: "Already working on it." }; aiNotes(body.day); return { started: true }; }
    if (p === "/api/ai/status") return { status: aiStatus };
    if (p === "/api/fetch") return { started: false, message: "News updates automatically every morning." };
    throw new Error("Not available in this version");
  };
})();
