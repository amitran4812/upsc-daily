// "My documents": upload a PDF / Word / text / image, get a UPSC summary, key points and questions.
// Reading uses the user's own AI key (Gemini preferred because it reads PDFs and scans natively).
// The original file stays on this device (IndexedDB). The summary, points and questions are saved
// in localStorage ("upsc:docs") and synced by username when sync is on.
(() => {
  const CDN = {
    pdf: "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js",
    pdfWorker: "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js",
    mammoth: "https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js",
  };
  const MAX_MB = 15;
  const DEFAULT_MODEL = { claude: "claude-haiku-5-5", gemini: "gemini-2.5-flash", openai: "gpt-4.1-mini" };
  const LABEL = { claude: "Claude", gemini: "Gemini", openai: "ChatGPT", none: "built-in reader (no AI)" };
  const ls = {
    get: (k, d) => { try { const v = localStorage.getItem("upsc:" + k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set: (k, v) => { try { localStorage.setItem("upsc:" + k, JSON.stringify(v)); } catch { throw new Error("This device's storage is full. Delete an old document and try again."); } if (window.SYNC?.SYNCED.includes(k)) window.SYNC.push(); },
  };
  const e$ = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const listDocs = () => { const gone = new Set(ls.get("docs_deleted", [])); return ls.get("docs", []).filter((d) => !gone.has(d.id)).sort((a, b) => (b.added_at || "").localeCompare(a.added_at || "")); };
  const getDoc = (id) => listDocs().find((d) => d.id === id);
  const saveDoc = (d) => { const all = ls.get("docs", []).filter((x) => x.id !== d.id); all.push(d); ls.set("docs", all); };
  const deleteDoc = async (id) => {
    ls.set("docs", ls.get("docs", []).filter((x) => x.id !== id));
    ls.set("docs_deleted", [...new Set([...ls.get("docs_deleted", []), id])].slice(-300));
    await idb("delete", id).catch(() => {});
  };

  // ---------- IndexedDB for original files (device only) ----------
  function idb(op, key, val) {
    return new Promise((res, rej) => {
      const o = indexedDB.open("upsc-docs", 1);
      o.onupgradeneeded = () => o.result.createObjectStore("files");
      o.onerror = () => rej(o.error);
      o.onsuccess = () => {
        const tx = o.result.transaction("files", op === "get" ? "readonly" : "readwrite"), st = tx.objectStore("files");
        const r = op === "get" ? st.get(key) : op === "put" ? st.put(val, key) : st.delete(key);
        r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
      };
    });
  }

  // ---------- File reading helpers ----------
  const loadScript = (src) => new Promise((res, rej) => {
    if (document.querySelector(`script[src="${src}"]`)) return res();
    const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => rej(new Error("Could not load the document reader. Check the internet connection."));
    document.head.appendChild(s);
  });
  const toB64 = (buf) => { let s = ""; const b = new Uint8Array(buf); for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); };
  function kindOf(file) {
    const n = file.name.toLowerCase(), t = file.type;
    if (t === "application/pdf" || n.endsWith(".pdf")) return "pdf";
    if (n.endsWith(".docx")) return "docx";
    if (t.startsWith("image/")) return "image";
    if (t.startsWith("text/") || /\.(txt|md|csv|html?)$/.test(n)) return "text";
    return "other";
  }
  async function pdfText(buf, onStep) {
    await loadScript(CDN.pdf);
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = CDN.pdfWorker;
    const pdf = await window.pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
    const out = [];
    for (let i = 1; i <= Math.min(pdf.numPages, 300); i++) {
      if (i % 10 === 1) onStep?.(`Reading page ${i} of ${pdf.numPages}…`);
      const c = await (await pdf.getPage(i)).getTextContent();
      out.push(c.items.map((x) => x.str + (x.hasEOL ? "\n" : " ")).join(""));
    }
    return { text: out.join("\n\n"), pages: pdf.numPages };
  }
  async function docxText(buf) {
    await loadScript(CDN.mammoth);
    return (await window.mammoth.extractRawText({ arrayBuffer: buf })).value;
  }

  // ---------- AI ----------
  function pickProvider() {
    const s = ls.get("settings", {});
    if (s.gemini_key) return { p: "gemini", key: s.gemini_key, model: s.gemini_model || DEFAULT_MODEL.gemini };
    for (const p of [s.provider, "claude", "openai"]) if (p && s[p + "_key"]) return { p, key: s[p + "_key"], model: s[p + "_model"] || DEFAULT_MODEL[p] };
    return { p: "none" };
  }
  const PROMPT = `You are a UPSC Civil Services mentor. Read the attached document carefully and prepare study material from it for a UPSC CSE aspirant.
Return ONLY JSON with this shape:
{"title": "short title of the document",
 "doc_type": "e.g. Government report, Budget speech, Bill, Article, Notes, Judgment",
 "summary": "a clear summary in 6 to 10 sentences, simple English",
 "key_points": [{"point": "one important fact or idea from the document", "why": "why it matters for UPSC, one line", "paper": "GS1|GS2|GS3|GS4|Prelims|Essay", "importance": "High|Medium"}],
 "prelims_facts": ["numbers, names, dates, definitions worth remembering"],
 "mains_angles": ["how this can be used in a Mains answer, one line each"],
 "static_connect": [{"title": "related static topic", "facts": ["1 to 3 short facts"]}],
 "mcqs": [{"question": "UPSC Prelims style question", "options": ["a","b","c","d"], "answer": 0, "explanation": "why, citing the document"}],
 "mains_questions": [{"question": "UPSC Mains style question", "paper": "GS2", "hint": "points to cover"}]}
Rules: 6 to 12 key points ordered by importance. Up to 6 prelims facts. Up to 4 Mains angles. 0 to 2 static connects.
Questions must come from the document's content. Write up to 5 MCQs and up to 2 Mains questions, fewer if the document is short or has little UPSC value. Do not pad with filler.
"answer" is the 0-based index of the correct option. If the document has nothing useful for UPSC, say so in the summary and keep the lists short.`;

  async function callAI(ai, kind, file, buf, text, maxTokens = 8192) {
    const mime = kind === "pdf" ? "application/pdf" : file.type || "application/octet-stream";
    const useBinary = (kind === "pdf" || kind === "image") && !text;
    const textPart = text ? `${PROMPT}\n\nDOCUMENT (${file.name}):\n"""\n${text.slice(0, 180000)}\n"""` : PROMPT;
    let r;
    if (ai.p === "gemini") {
      const parts = useBinary ? [{ inline_data: { mime_type: mime, data: toB64(buf) } }, { text: PROMPT }] : [{ text: textPart }];
      r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${ai.model}:generateContent`, { method: "POST",
        headers: { "x-goog-api-key": ai.key, "content-type": "application/json" },
        body: JSON.stringify({ contents: [{ parts }], generationConfig: { maxOutputTokens: maxTokens, responseMimeType: "application/json" } }) });
      if (!r.ok) throw new Error(`Gemini: ${r.status} ${(await r.text()).slice(0, 200)}`);
      const c = (await r.json()).candidates || [];
      return c.length ? c[0].content.parts.map((x) => x.text || "").join("") : "";
    }
    if (ai.p === "claude") {
      const content = useBinary
        ? [{ type: kind === "pdf" ? "document" : "image", source: { type: "base64", media_type: mime, data: toB64(buf) } }, { type: "text", text: PROMPT }]
        : textPart;
      r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: {
        "x-api-key": ai.key, "anthropic-version": "2023-06-01", "content-type": "application/json", "anthropic-dangerous-direct-browser-access": "true" },
        body: JSON.stringify({ model: ai.model, max_tokens: maxTokens, messages: [{ role: "user", content }] }) });
      if (!r.ok) throw new Error(`Claude: ${r.status} ${(await r.text()).slice(0, 200)}`);
      return (await r.json()).content.map((b) => b.text || "").join("");
    }
    const content = useBinary
      ? [kind === "pdf" ? { type: "file", file: { filename: file.name, file_data: `data:${mime};base64,${toB64(buf)}` } }
                        : { type: "image_url", image_url: { url: `data:${mime};base64,${toB64(buf)}` } }, { type: "text", text: PROMPT }]
      : textPart;
    r = await fetch("https://api.openai.com/v1/chat/completions", { method: "POST", headers: { authorization: `Bearer ${ai.key}`, "content-type": "application/json" },
      body: JSON.stringify({ model: ai.model, max_completion_tokens: maxTokens, response_format: { type: "json_object" }, messages: [{ role: "user", content }] }) });
    if (!r.ok) throw new Error(`ChatGPT: ${r.status} ${(await r.text()).slice(0, 200)}`);
    return (await r.json()).choices[0].message.content || "";
  }
  function parseJson(t) {
    t = (t || "").trim(); const m = t.match(/```(?:json)?\s*([\s\S]*?)```/); if (m) t = m[1];
    const i = t.indexOf("{"); return JSON.parse(t.slice(i >= 0 ? i : 0, t.lastIndexOf("}") + 1));
  }

  // ---------- No-AI fallback: pick the most informative sentences ----------
  const UPSC_WORDS = ["constitution", "article", "act", "bill", "court", "parliament", "ministry", "scheme", "policy", "government", "india", "economy", "gdp", "inflation",
    "rbi", "budget", "tax", "trade", "export", "climate", "environment", "forest", "species", "water", "agriculture", "farmer", "health", "education", "rights", "women",
    "security", "defence", "border", "treaty", "agreement", "international", "un ", "technology", "space", "isro", "energy", "renewable", "infrastructure", "rural",
    "urban", "poverty", "employment", "governance", "federal", "state", "commission", "report", "index", "percent", "%", "crore", "lakh", "billion", "target"];
  function basicDigest(text, name) {
    const sents = text.split(/\n{2,}|\s*[•▪●■◦]\s*|(?<=[.!?])\s+(?=[A-Z0-9"“])/).map((x) => x.replace(/\s+/g, " ").trim())
      .filter((x) => x.length > 40 && x.length < 400 && !/https?:\/\/|www\./i.test(x));
    const freq = {}; for (const w of text.toLowerCase().match(/[a-z]{5,}/g) || []) freq[w] = (freq[w] || 0) + 1;
    const scored = sents.map((s, i) => {
      const l = s.toLowerCase(); let sc = 0;
      for (const w of UPSC_WORDS) if (l.includes(w)) sc += 2;
      if (/\d/.test(s)) sc += 1.5;
      for (const w of l.match(/[a-z]{5,}/g) || []) sc += Math.min(freq[w], 8) / 8;
      return { s, i, sc: sc / Math.sqrt(s.length / 80) };
    });
    const top = [...scored].sort((a, b) => b.sc - a.sc);
    const summary = top.slice(0, 5).sort((a, b) => a.i - b.i).map((x) => x.s.replace(/([^.!?])$/, "$1.")).join(" ");
    const facts = sents.filter((s) => /\d/.test(s) && /(per ?cent|%|crore|lakh|billion|million|\b(19|20)\d\d\b)/i.test(s)).slice(0, 6);
    return {
      title: name.replace(/\.[^.]+$/, ""), doc_type: "Document", summary: summary || "This file had very little readable text.",
      key_points: (top.length > 12 ? top.slice(5, 15) : top.slice(0, 10)).sort((a, b) => a.i - b.i).map((x) => ({ point: x.s, why: "", paper: "", importance: "Medium" })),
      prelims_facts: facts, mains_angles: [], static_connect: [], mcqs: [], mains_questions: [], basic: true,
    };
  }

  async function analyse(file, onStep) {
    if (file.size > MAX_MB * 1024 * 1024) throw new Error(`Please use a file smaller than ${MAX_MB} MB.`);
    const kind = kindOf(file);
    if (kind === "other") throw new Error("Use a PDF, Word (.docx), text file or a photo of a page.");
    const buf = await file.arrayBuffer();
    const ai = pickProvider();
    let text = "", pages = null;
    // Gemini and Claude read PDFs and photos directly (including scanned pages). Others need the text first.
    const nativeOk = (kind === "pdf" || kind === "image") && ai.p !== "none" && !(kind === "pdf" && file.size > 14 * 1024 * 1024 && ai.p !== "gemini");
    if (kind === "docx") { onStep("Opening the Word file…"); text = await docxText(buf); }
    else if (kind === "text") text = new TextDecoder().decode(buf);
    else if (kind === "pdf" && !nativeOk) { onStep("Reading the PDF…"); ({ text, pages } = await pdfText(buf, onStep)); }
    else if (kind === "image" && ai.p === "none") throw new Error("Reading a photo needs an AI key. Add a free Gemini key in AI & settings.");
    if (!nativeOk && !text.trim()) throw new Error("No readable text found. If this is a scanned PDF, add a Gemini key in AI & settings so it can read the scan.");

    let result, used = ai.p;
    if (ai.p === "none") { onStep("Picking out the key points…"); result = basicDigest(text, file.name); }
    else {
      onStep(`${LABEL[ai.p]} is reading the document… this can take up to a minute.`);
      try { result = parseJson(await callAI(ai, kind, file, buf, text)); }
      catch (err) {
        if (kind !== "pdf" || text) throw err;
        onStep("Trying again with the PDF's text…");     // e.g. very long PDF: send text instead of the file
        ({ text, pages } = await pdfText(buf, onStep));
        result = parseJson(await callAI(ai, kind, file, buf, text));
      }
    }
    const id = "d" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    try { await idb("put", id, { name: file.name, type: file.type || (kind === "pdf" ? "application/pdf" : ""), blob: new Blob([buf], { type: file.type }) }); } catch {}
    const doc = { id, name: file.name, kind, size: file.size, pages, added_at: new Date().toISOString(), reader: used, ...sanitize(result) };
    saveDoc(doc);
    return doc;
  }
  function sanitize(r) {
    const arr = (x) => (Array.isArray(x) ? x : []);
    return {
      title: String(r.title || "").slice(0, 160), doc_type: String(r.doc_type || "").slice(0, 60), summary: String(r.summary || "").slice(0, 3000), basic: !!r.basic,
      key_points: arr(r.key_points).slice(0, 14).map((k) => (typeof k === "string" ? { point: k } : { point: String(k.point || ""), why: String(k.why || ""), paper: String(k.paper || ""), importance: k.importance === "High" ? "High" : "Medium" })),
      prelims_facts: arr(r.prelims_facts).slice(0, 8).map(String),
      mains_angles: arr(r.mains_angles).slice(0, 5).map(String),
      static_connect: arr(r.static_connect).slice(0, 3).map((s) => ({ title: String(s.title || ""), facts: arr(s.facts).slice(0, 4).map(String) })),
      mcqs: arr(r.mcqs).filter((q) => q && Array.isArray(q.options) && q.options.length >= 2).slice(0, 8)
        .map((q) => ({ question: String(q.question || ""), options: q.options.slice(0, 4).map(String), answer: Math.max(0, Math.min(3, +q.answer || 0)), explanation: String(q.explanation || "") })),
      mains_questions: arr(r.mains_questions).slice(0, 3).map((q) => ({ question: String(q.question || q), paper: String(q.paper || ""), hint: String(q.hint || "") })),
    };
  }

  // ---------- Views ----------
  const KIND_ICON = { pdf: "📕", docx: "📘", text: "📄", image: "🖼️" };
  const fmtSize = (b) => (b > 1048576 ? (b / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(b / 1024)) + " KB");
  const fmtDate = (s) => new Date(s).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

  function viewList() {
    document.querySelector("#crumb").textContent = "My documents";
    const docs = listDocs(), ai = pickProvider();
    const v = document.querySelector("#view");
    v.innerHTML = `<div class="hero"><div><h1>My documents</h1><p>Upload any PDF, Word file, notes or a photo of a page. You get a short summary, the points that matter for UPSC, and practice questions. Everything is saved here so you can come back to it.</p></div></div>
    <label class="dropzone card" id="drop">
      <input type="file" id="docFile" accept=".pdf,.docx,.txt,.md,text/plain,application/pdf,image/*" hidden>
      <div class="dz-ico">⬆</div>
      <div><b>Tap to upload a document</b><span class="muted small">PDF, Word (.docx), text or a photo · up to ${MAX_MB} MB</span></div>
    </label>
    <p class="muted small reader-line">Read by: <b>${e$(LABEL[ai.p])}</b>${ai.p === "none" ? ` · <a href="#/settings">Add a free Gemini key</a> for full notes, scanned PDFs and questions.` : ai.p === "gemini" ? "" : ` · Gemini is used first whenever a Gemini key is saved.`}</p>
    <div id="dzStatus" class="dz-status" hidden></div>
    ${docs.length ? `<h2 class="h2s">Saved (${docs.length})</h2><div class="doc-grid">${docs.map((d) => `<a class="doc-tile" href="#/docs/${d.id}">
        <span class="doc-ico">${KIND_ICON[d.kind] || "📄"}</span>
        <b>${e$(d.title || d.name)}</b>
        <span class="muted small">${e$(d.doc_type || "")}${d.doc_type ? " · " : ""}${fmtDate(d.added_at)}</span>
        <span class="doc-meta"><span>${d.key_points.length} points</span>${d.mcqs.length ? `<span>${d.mcqs.length} MCQs</span>` : ""}${d.mains_questions.length ? `<span>${d.mains_questions.length} Mains</span>` : ""}</span></a>`).join("")}</div>`
      : `<div class="empty"><h2>No documents yet</h2><p class="muted">Try a PIB backgrounder, an Economic Survey chapter, a committee report or your own notes.</p></div>`}`;
    const inp = document.querySelector("#docFile"), st = document.querySelector("#dzStatus");
    inp.onchange = async () => {
      const f = inp.files[0]; if (!f) return;
      document.querySelector("#drop").classList.add("busy");
      st.hidden = false; st.className = "dz-status"; st.innerHTML = `<span class="spin">⟳</span> <span id="dzMsg">Opening ${e$(f.name)}…</span>`;
      try {
        const d = await analyse(f, (m) => { const x = document.querySelector("#dzMsg"); if (x) x.textContent = m; });
        location.hash = `#/docs/${d.id}`;
      } catch (err) {
        st.className = "dz-status err"; st.textContent = err.message;
        document.querySelector("#drop").classList.remove("busy"); inp.value = "";
      }
    };
  }

  async function viewDoc(id) {
    const d = getDoc(id);
    const v = document.querySelector("#view");
    if (!d) { v.innerHTML = `<div class="empty"><h2>Document not found</h2><p><a href="#/docs">Back to My documents</a></p></div>`; return; }
    document.querySelector("#crumb").textContent = "My documents";
    const hasFile = await idb("get", id).then((x) => !!x).catch(() => false);
    const high = d.key_points.filter((k) => k.importance === "High"), rest = d.key_points.filter((k) => k.importance !== "High");
    const kp = (k) => `<div class="kp ${k.importance === "High" ? "hi" : ""}"><div>${e$(k.point)}</div>${k.why ? `<span class="muted small">Why it matters: ${e$(k.why)}</span>` : ""}${k.paper ? `<span class="paper-tag">${e$(k.paper)}</span>` : ""}</div>`;
    v.innerHTML = `<div class="doc-hero">
      <a href="#/docs" class="small">← My documents</a>
      <h1>${KIND_ICON[d.kind] || "📄"} ${e$(d.title || d.name)}</h1>
      <p class="muted small">${e$(d.name)} · ${fmtSize(d.size)}${d.pages ? ` · ${d.pages} pages` : ""} · saved ${fmtDate(d.added_at)} · read by ${e$(LABEL[d.reader] || d.reader)}</p>
      <div class="row-btns">${hasFile ? `<button class="btn" id="openOrig">Open original</button>` : `<span class="muted small">The original file is on the device it was uploaded from.</span>`}
        <button class="btn ghost" id="delDoc">Delete</button></div></div>
    <div class="doc-stats">
      <div><b>${d.key_points.length}</b><span>key points</span></div>
      <div><b>${d.prelims_facts.length}</b><span>Prelims facts</span></div>
      <div><b>${d.mcqs.length}</b><span>MCQs</span></div>
      <div><b>${d.mains_questions.length}</b><span>Mains Qs</span></div></div>
    <div class="doc-jump">${["Summary", "Key points", d.prelims_facts.length && "Prelims", d.mains_angles.length && "Mains", d.mcqs.length + d.mains_questions.length && "Practice"].filter(Boolean)
      .map((x) => `<a href="#" data-jump="${x}">${x}</a>`).join("")}</div>
    <section class="card doc-sec" data-sec="Summary"><h2>📝 Summary</h2><p class="doc-summary">${e$(d.summary)}</p>
      ${d.basic ? `<p class="note">This is a quick summary picked from the document's own sentences. Add a free Gemini key in <a href="#/settings">AI &amp; settings</a> and upload again for full notes and questions.</p>` : ""}</section>
    <section class="doc-sec" data-sec="Key points"><h2 class="h2s">🎯 Key points</h2><div class="kp-grid">${[...high, ...rest].map(kp).join("")}</div></section>
    ${d.prelims_facts.length || d.static_connect.length ? `<section class="doc-sec" data-sec="Prelims"><div class="tile-grid">
      ${d.prelims_facts.length ? `<div class="tile-box"><div class="lbl">Prelims facts</div><ul>${d.prelims_facts.map((x) => `<li>${e$(x)}</li>`).join("")}</ul></div>` : ""}
      ${d.static_connect.map((s) => `<div class="tile-box static"><div class="lbl">Static connect: ${e$(s.title)}</div><ul>${s.facts.map((x) => `<li>${e$(x)}</li>`).join("")}</ul></div>`).join("")}</div></section>` : ""}
    ${d.mains_angles.length ? `<section class="doc-sec" data-sec="Mains"><div class="tile-box"><div class="lbl">Use it in Mains</div><ul>${d.mains_angles.map((x) => `<li>${e$(x)}</li>`).join("")}</ul></div></section>` : ""}
    ${d.mcqs.length || d.mains_questions.length ? `<section class="doc-sec" data-sec="Practice"><h2 class="h2s">✎ Practice</h2>
      <div id="dqs">${d.mcqs.map((q, i) => `<div class="card question" data-i="${i}"><div class="qt">${i + 1}. ${e$(q.question)}</div>
        ${q.options.map((o, j) => `<button class="opt" data-j="${j}">(${"abcd"[j]}) ${e$(o)}</button>`).join("")}
        <div class="explain" hidden></div></div>`).join("")}</div>
      ${d.mains_questions.map((q) => `<div class="card question"><div class="qt">${q.paper ? `<span class="paper-tag">${e$(q.paper)}</span> ` : ""}${e$(q.question)}</div>
        ${q.hint ? `<details><summary class="small">Points to cover</summary><p class="small">${e$(q.hint)}</p></details>` : ""}</div>`).join("")}</section>` : ""}`;
    v.querySelectorAll("[data-jump]").forEach((a) => (a.onclick = (ev) => { ev.preventDefault(); v.querySelector(`[data-sec="${a.dataset.jump}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" }); }));
    const qs = v.querySelector("#dqs");
    if (qs) qs.addEventListener("click", (ev) => {
      const b = ev.target.closest(".opt"); if (!b) return;
      const card = b.closest(".question"); if (card.dataset.done) return;
      const q = d.mcqs[+card.dataset.i]; card.dataset.done = 1;
      card.querySelectorAll(".opt").forEach((o, j) => { if (j === q.answer) o.classList.add("right"); else if (o === b) o.classList.add("wrong"); });
      const ex = card.querySelector(".explain"); ex.textContent = (+b.dataset.j === q.answer ? "Correct. " : "Not quite. ") + q.explanation; ex.hidden = false;
    });
    const op = v.querySelector("#openOrig");
    if (op) op.onclick = async () => {
      const f = await idb("get", id); const url = URL.createObjectURL(f.blob);
      const a = document.createElement("a"); a.href = url; a.target = "_blank"; a.rel = "noopener";
      if (!/pdf|image|text/.test(f.type)) a.download = f.name;
      a.click(); setTimeout(() => URL.revokeObjectURL(url), 60000);
    };
    v.querySelector("#delDoc").onclick = async () => { if (!confirm("Delete this document and its notes?")) return; await deleteDoc(id); location.hash = "#/docs"; };
  }

  window.DOCS = { view: (id) => (id ? viewDoc(id) : viewList()), list: listDocs };
  window.addEventListener("upsc-synced", () => { if (location.hash === "#/docs" && !document.querySelector(".dropzone.busy")) window.DOCS.view(); });
})();
