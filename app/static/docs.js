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
  const DEFAULT_MODEL = { claude: "claude-haiku-5-5", gemini: "gemini-flash-latest", openai: "gpt-4.1-mini" };
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
 "relevance": {"level": "High|Medium|Low", "papers": ["GS2","GS3"], "why": "2-3 sentences: how relevant this document is for UPSC CSE and which syllabus topics it serves"},
 "angles": [{"dim": "International relations|Internal security|Economy|Governance & polity|Environment|Society|Science & tech|Ethics|Geography & disasters", "point": "what the document means for India in this dimension, 1-2 sentences"}],
 "key_points": [{"point": "one important fact or idea from the document", "why": "why it matters for UPSC, one line", "paper": "GS1|GS2|GS3|GS4|Prelims|Essay", "importance": "High|Medium"}],
 "prelims_facts": ["numbers, names, dates, definitions worth remembering"],
 "mains_angles": ["how this can be used in a Mains answer, one line each"],
 "static_connect": [{"title": "related static topic", "facts": ["1 to 3 short facts"]}],
 "mcqs": [{"question": "UPSC Prelims style question", "options": ["a","b","c","d"], "answer": 0, "explanation": "why, citing the document", "ref": {"where": "page number or section heading where the answer is", "quote": "exact short quote from the document, at most 25 words"}}],
 "mains_questions": [{"question": "UPSC Mains style question", "paper": "GS2", "hint": "points to cover", "ref": {"where": "page or section", "quote": "short quote"}}]}
Rules: 2 to 4 angles, only dimensions that really apply. 6 to 12 key points ordered by importance. Up to 6 prelims facts. Up to 4 Mains angles. 0 to 2 static connects.
Questions must come from the document's content. Write up to 5 MCQs and up to 2 Mains questions, fewer if the document is short or has little UPSC value. Do not pad with filler.
"answer" is the 0-based index of the correct option. If the document has nothing useful for UPSC, say so in the summary and keep the lists short.`;

  const MAX_TEXT = 100000;   // ~25k tokens: enough for long reports, keeps answers fast
  async function callAI(ai, kind, file, buf, text, maxTokens = 8192, opts = {}) {
    const mime = kind === "pdf" ? "application/pdf" : file.type || "application/octet-stream";
    const useBinary = (kind === "pdf" || kind === "image") && !text;
    const cut = text.length > MAX_TEXT;
    const textPart = text ? `${PROMPT}\n\nDOCUMENT (${file.name})${cut ? " — long document, first part only" : ""}:\n"""\n${text.slice(0, MAX_TEXT)}\n"""` : PROMPT;
    let r;
    if (ai.p === "gemini") {
      const parts = useBinary ? [{ inline_data: { mime_type: mime, data: toB64(buf) } }, { text: PROMPT }] : [{ text: textPart }];
      const j = await window.UPSC_GEMINI.generate(ls.get("settings", {}), { contents: [{ parts }], generationConfig: { maxOutputTokens: maxTokens, responseMimeType: "application/json" } },
        { stream: true, onText: opts.onText, signal: opts.signal, idleMs: 90000 });
      const c = j.candidates || [];
      return c.length && c[0].content ? (c[0].content.parts || []).map((x) => x.text || "").join("") : "";
    }
    if (ai.p === "claude") {
      const content = useBinary
        ? [{ type: kind === "pdf" ? "document" : "image", source: { type: "base64", media_type: mime, data: toB64(buf) } }, { type: "text", text: PROMPT }]
        : textPart;
      r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: {
        "x-api-key": ai.key, "anthropic-version": "2023-06-01", "content-type": "application/json", "anthropic-dangerous-direct-browser-access": "true" },
        body: JSON.stringify({ model: ai.model, max_tokens: maxTokens, messages: [{ role: "user", content }] }), signal: opts.signal });
      if (!r.ok) throw new Error(`Claude: ${r.status} ${(await r.text()).slice(0, 200)}`);
      return (await r.json()).content.map((b) => b.text || "").join("");
    }
    const content = useBinary
      ? [kind === "pdf" ? { type: "file", file: { filename: file.name, file_data: `data:${mime};base64,${toB64(buf)}` } }
                        : { type: "image_url", image_url: { url: `data:${mime};base64,${toB64(buf)}` } }, { type: "text", text: PROMPT }]
      : textPart;
    r = await fetch("https://api.openai.com/v1/chat/completions", { method: "POST", headers: { authorization: `Bearer ${ai.key}`, "content-type": "application/json" },
      body: JSON.stringify({ model: ai.model, max_completion_tokens: maxTokens, response_format: { type: "json_object" }, messages: [{ role: "user", content }] }), signal: opts.signal });
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

  function checkFile(file) {
    if (file.size > MAX_MB * 1024 * 1024) throw new Error(`Please use a file smaller than ${MAX_MB} MB.`);
    if (kindOf(file) === "other") throw new Error("Use a PDF, Word (.docx), text file or a photo of a page.");
  }
  async function saveOnly(file) {
    checkFile(file);
    const kind = kindOf(file), buf = await file.arrayBuffer();
    const id = "d" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    await idb("put", id, { name: file.name, type: file.type || (kind === "pdf" ? "application/pdf" : ""), blob: new Blob([buf], { type: file.type }) });
    const doc = { id, name: file.name, kind, size: file.size, pages: null, added_at: new Date().toISOString(), analysed: false, reader: "",
      ...sanitize({ title: file.name.replace(/\.[^.]+$/, "") }) };
    saveDoc(doc);
    return doc;
  }
  async function analyse(file, onStep, old, opts = {}) {
    if (file.size > MAX_MB * 1024 * 1024) throw new Error(`Please use a file smaller than ${MAX_MB} MB.`);
    const kind = kindOf(file);
    if (kind === "other") throw new Error("Use a PDF, Word (.docx), text file or a photo of a page.");
    const buf = await file.arrayBuffer();
    const ai = pickProvider();
    let text = "", pages = null;
    // PDFs: pull the text out on the device first (fast) and send only the text. Only scanned PDFs
    // with no text layer are sent as the file itself, which is much slower to upload and read.
    if (kind === "docx") { onStep("Opening the Word file…"); text = await docxText(buf); }
    else if (kind === "text") text = new TextDecoder().decode(buf);
    else if (kind === "pdf") {
      onStep("Reading the PDF on this device…");
      try { ({ text, pages } = await pdfText(buf, onStep)); } catch { text = ""; }
      if (text.replace(/\s+/g, "").length < 1500) {
        if (ai.p === "none") throw new Error("This looks like a scanned PDF. Add a free Gemini key in AI & settings so it can read the scan.");
        text = "";                                // scanned: send the file
      }
    } else if (kind === "image" && ai.p === "none") throw new Error("Reading a photo needs an AI key. Add a free Gemini key in AI & settings.");
    if (!text.trim() && !(kind === "pdf" || kind === "image")) throw new Error("No readable text found in this file.");

    let result, used = ai.p;
    if (ai.p === "none") { onStep("Picking out the key points…"); result = basicDigest(text, file.name); }
    else {
      const t0 = Date.now(), ctl = new AbortController(), LIMIT = 240000;
      opts.onCancel?.(() => ctl.abort(new Error("cancelled")));
      const kill = setTimeout(() => ctl.abort(new Error("timeout")), LIMIT);
      const sec = () => Math.round((Date.now() - t0) / 1000);
      let chars = 0;
      const tick = setInterval(() => onStep(chars ? `${LABEL[ai.p]} is writing your notes… ${sec()}s · ${chars.toLocaleString("en-IN")} characters so far`
        : `${LABEL[ai.p]} is reading ${text ? `the text (${Math.round(Math.min(text.length, MAX_TEXT) / 1000)}k characters)` : "the file"}… ${sec()}s`), 1000);
      let wake = null; try { wake = await navigator.wakeLock?.request("screen"); } catch {}
      try { result = parseJson(await callAI(ai, kind, file, buf, text, 8192, { signal: ctl.signal, onText: (n) => (chars = n) })); }
      catch (err) {
        if (ctl.signal.aborted) throw new Error(ctl.signal.reason?.message === "cancelled" ? "Stopped. Your document is saved; tap Analyze again any time."
          : `${LABEL[ai.p]} took longer than ${LIMIT / 60000} minutes. Your document is saved; tap Analyze to try again.`);
        if (err instanceof SyntaxError) throw new Error(`${LABEL[ai.p]}'s answer was cut off. Please tap Analyze again.`);
        throw err;
      } finally { clearTimeout(kill); clearInterval(tick); try { wake?.release(); } catch {} }
    }
    const id = old?.id || "d" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    if (!old) try { await idb("put", id, { name: file.name, type: file.type || (kind === "pdf" ? "application/pdf" : ""), blob: new Blob([buf], { type: file.type }) }); } catch {}
    const doc = { id, name: file.name, kind, size: file.size, pages, added_at: old?.added_at || new Date().toISOString(), analysed_at: new Date().toISOString(), analysed: true, reader: used, ...sanitize(result) };
    saveDoc(doc);
    return doc;
  }
  const ref = (x) => (x && typeof x === "object" && (x.where || x.quote) ? { where: String(x.where || "").slice(0, 80), quote: String(x.quote || "").slice(0, 240) } : null);
  // Reference block for a question from a saved document (used here and in the monthly quiz)
  function docRefHtml(d, q) {
    const r = q.ref || {};
    return `<a class="rv-src" href="#/docs/${e$(d.id)}">📄 <span><b>${e$(d.title || d.name)}</b><span class="muted small">Your document · ${e$(d.name)}${r.where ? " · " + e$(r.where) : ""}</span>${r.quote ? `<span class="rv-quote">“${e$(r.quote)}”</span>` : ""}</span></a>`;
  }
  // Questions from documents saved in a given month, for the monthly quiz (max 10, spread across documents)
  function monthQuestions(month, max = 10) {
    const docs = listDocs().filter((d) => (d.added_at || "").startsWith(month) && d.mcqs.length);
    const out = [];
    for (let round = 0; out.length < max && docs.some((d) => d.mcqs[round]); round++)
      for (const d of docs) if (d.mcqs[round] && out.length < max) out.push({ ...d.mcqs[round], doc: { id: d.id, title: d.title, name: d.name }, srcHtml: docRefHtml(d, d.mcqs[round]) });
    return out;
  }
  function sanitize(r) {
    const arr = (x) => (Array.isArray(x) ? x : []);
    return {
      relevance: r.relevance && typeof r.relevance === "object" ? { level: ["High", "Medium", "Low"].includes(r.relevance.level) ? r.relevance.level : "", papers: arr(r.relevance.papers).slice(0, 5).map(String), why: String(r.relevance.why || "") } : null,
      angles: arr(r.angles).filter((a) => a && a.point).slice(0, 4).map((a) => ({ dim: String(a.dim || ""), point: String(a.point) })),
      title: String(r.title || "").slice(0, 160), doc_type: String(r.doc_type || "").slice(0, 60), summary: String(r.summary || "").slice(0, 3000), basic: !!r.basic,
      key_points: arr(r.key_points).slice(0, 14).map((k) => (typeof k === "string" ? { point: k } : { point: String(k.point || ""), why: String(k.why || ""), paper: String(k.paper || ""), importance: k.importance === "High" ? "High" : "Medium" })),
      prelims_facts: arr(r.prelims_facts).slice(0, 8).map(String),
      mains_angles: arr(r.mains_angles).slice(0, 5).map(String),
      static_connect: arr(r.static_connect).slice(0, 3).map((s) => ({ title: String(s.title || ""), facts: arr(s.facts).slice(0, 4).map(String) })),
      mcqs: arr(r.mcqs).filter((q) => q && Array.isArray(q.options) && q.options.length >= 2).slice(0, 8)
        .map((q) => ({ question: String(q.question || ""), options: q.options.slice(0, 4).map(String), answer: Math.max(0, Math.min(3, +q.answer || 0)), explanation: String(q.explanation || ""), ref: ref(q.ref) })),
      mains_questions: arr(r.mains_questions).slice(0, 3).map((q) => ({ question: String(q.question || q), paper: String(q.paper || ""), hint: String(q.hint || ""), ref: ref(q.ref) })),
    };
  }

  // ---------- Views ----------
  const KIND_ICON = { pdf: "📕", docx: "📘", text: "📄", image: "🖼️" };
  const fmtSize = (b) => (b > 1048576 ? (b / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(b / 1024)) + " KB");
  const fmtDate = (s) => new Date(s).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  const fmtWhen = (s) => new Date(s).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
  const dayKey = (s) => { const d = new Date(s); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  function groupLabel(s) {
    const d = new Date(s), t = new Date(); t.setHours(0, 0, 0, 0);
    const days = Math.round((t - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 864e5);
    if (days <= 0) return "Today";
    if (days === 1) return "Yesterday";
    if (days < 7) return "Earlier this week";
    return d.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
  }
  const SORTS = { new: "Newest first", old: "Oldest first", az: "A to Z" };
  let sortBy = (() => { try { return localStorage.getItem("upsc:docs_sort") || "new"; } catch { return "new"; } })();
  const docTile = (d) => `<a class="doc-tile" href="#/docs/${d.id}">
        <span class="doc-ico">${KIND_ICON[d.kind] || "📄"}</span>
        <b>${e$(d.title || d.name)}</b>
        <span class="up-date">⬆ Uploaded ${fmtWhen(d.added_at)}</span>
        ${d.doc_type ? `<span class="muted small">${e$(d.doc_type)}</span>` : ""}
        <span class="doc-meta">${d.analysed === false ? `<span class="to-read">📖 Saved to read · not analysed</span>` : `<span>${d.key_points.length} points</span>${d.mcqs.length ? `<span>${d.mcqs.length} MCQs</span>` : ""}${d.mains_questions.length ? `<span>${d.mains_questions.length} Mains</span>` : ""}`}</span></a>`;
  function savedList(docs) {
    const sorted = [...docs].sort((a, b) => sortBy === "az" ? (a.title || a.name).localeCompare(b.title || b.name)
      : sortBy === "old" ? (a.added_at || "").localeCompare(b.added_at || "") : (b.added_at || "").localeCompare(a.added_at || ""));
    if (sortBy === "az") return `<div class="doc-grid">${sorted.map(docTile).join("")}</div>`;
    const groups = []; for (const d of sorted) { const g = groupLabel(d.added_at); if (!groups.length || groups.at(-1)[0] !== g) groups.push([g, []]); groups.at(-1)[1].push(d); }
    return groups.map(([g, ds]) => `<h3 class="date-group">${e$(g)} <span class="muted small">${ds.length} document${ds.length > 1 ? "s" : ""}</span></h3><div class="doc-grid">${ds.map(docTile).join("")}</div>`).join("");
  }

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
    ${docs.length ? `<div class="saved-head"><h2 class="h2s">Saved (${docs.length})</h2>
        <input class="input" id="docSearch" type="search" placeholder="Search by name or date, e.g. budget, 10 Nov">
        <div class="radio" id="docSort">${Object.entries(SORTS).map(([k, l]) => `<button class="chip ${k === sortBy ? "on" : ""}" data-s="${k}">${l}</button>`).join("")}</div></div>
      <div id="savedList">${savedList(docs)}</div>`
      : `<div class="empty"><h2>No documents yet</h2><p class="muted">Try a PIB backgrounder, an Economic Survey chapter, a committee report or your own notes.</p></div>`}`;
    const inp = document.querySelector("#docFile"), st = document.querySelector("#dzStatus");
    const ss = document.querySelector("#docSearch"), sl = document.querySelector("#savedList");
    const redraw = () => {
      const q = (ss.value || "").trim().toLowerCase();
      const hit = docs.filter((d) => !q || `${d.title} ${d.name} ${d.doc_type} ${fmtWhen(d.added_at)} ${dayKey(d.added_at)}`.toLowerCase().includes(q));
      sl.innerHTML = hit.length ? savedList(hit) : `<p class="muted">No document matches “${e$(q)}”.</p>`;
    };
    if (ss) {
      ss.oninput = redraw;
      document.querySelectorAll("#docSort .chip").forEach((b) => (b.onclick = () => {
        sortBy = b.dataset.s; try { localStorage.setItem("upsc:docs_sort", sortBy); } catch {}
        document.querySelectorAll("#docSort .chip").forEach((x) => x.classList.toggle("on", x === b)); redraw();
      }));
    }
    inp.onchange = () => {
      const f = inp.files[0]; if (!f) return;
      st.hidden = false;
      try { checkFile(f); } catch (err) { st.className = "dz-status err"; st.textContent = err.message; inp.value = ""; return; }
      // Step 2: show the chosen file with a clear Analyze button
      st.className = "dz-status ready";
      st.innerHTML = `<div class="ready-file"><span class="doc-ico">${KIND_ICON[kindOf(f)] || "📄"}</span><span><b>${e$(f.name)}</b><span class="muted small">${fmtSize(f.size)} · ready to analyse with ${e$(LABEL[ai.p])}</span></span></div>
        <p class="small muted" style="margin:8px 0 12px">You'll get a summary, UPSC relevance, why it matters for India, key points, Prelims facts, Mains angles${ai.p === "none" ? "" : " and practice questions"}.</p>
        <div class="row-btns"><button class="btn primary big" id="goAnalyse">✦ Analyze</button><button class="btn big" id="saveOnly">📖 Just save to read</button><button class="btn ghost" id="pickOther">Choose another file</button></div>
        <p class="muted small" style="margin:8px 0 0">"Just save to read" keeps the document with today's upload date, without any analysis. You can tap Analyze on it any time later.</p>`;
      document.querySelector("#saveOnly").onclick = async () => {
        try { const d = await saveOnly(f); location.hash = `#/docs/${d.id}/read`; }
        catch (err) { st.className = "dz-status err"; st.textContent = err.message; }
      };
      document.querySelector("#pickOther").onclick = () => { inp.value = ""; st.hidden = true; inp.click(); };
      document.querySelector("#goAnalyse").onclick = async () => {
        document.querySelector("#drop").classList.add("busy");
        st.className = "dz-status"; st.innerHTML = `<div class="prog"><span class="spin">⟳</span> <span id="dzMsg">Opening ${e$(f.name)}…</span></div>
          <div class="prog-bar"><i></i></div><div class="row-btns" style="margin-top:10px"><button class="btn" id="dzCancel">Stop</button></div>
          <p class="muted small" style="margin:8px 0 0">Your document is already saved in My documents, so nothing is lost if this stops. Keep this screen open until it finishes.</p>`;
        let saved = null, cancel = null;
        document.querySelector("#dzCancel").onclick = () => cancel?.();
        try {
          saved = await saveOnly(f);                 // keep the file even if the analysis is interrupted
          const d = await analyse(f, (m) => { const x = document.querySelector("#dzMsg"); if (x) x.textContent = m; }, saved, { onCancel: (fn) => (cancel = fn) });
          location.hash = `#/docs/${d.id}`;
        } catch (err) {
          st.className = "dz-status err";
          st.innerHTML = `${e$(err.message)}${saved ? `<div class="row-btns" style="margin-top:10px"><a class="btn primary" href="#/docs/${saved.id}">Open the saved document</a></div>` : ""}`;
          document.querySelector("#drop").classList.remove("busy"); inp.value = "";
        }
      };
    };
  }

  async function viewDoc(id) {
    const d = getDoc(id);
    const v = document.querySelector("#view");
    if (!d) { v.innerHTML = `<div class="empty"><h2>Document not found</h2><p><a href="#/docs">Back to My documents</a></p></div>`; return; }
    document.querySelector("#crumb").textContent = "My documents";
    const hasFile = await idb("get", id).then((x) => !!x).catch(() => false);
    if (d.analysed === false) {
      v.innerHTML = `<div class="doc-hero">
        <a href="#/docs" class="small">← My documents</a>
        <h1>${KIND_ICON[d.kind] || "📄"} ${e$(d.title || d.name)}</h1>
        <p class="muted small">${e$(d.name)} · ${fmtSize(d.size)} · uploaded ${fmtWhen(d.added_at)} · saved to read, not analysed</p>
        <div class="row-btns">${hasFile ? `<a class="btn primary big" href="#/docs/${id}/read">📖 Read</a><button class="btn big" id="reAnalyse">✦ Analyze</button>` : `<span class="muted small">The file is on the device it was uploaded from. Open it there to read or analyse it.</span>`}
          <button class="btn ghost" id="delDoc">Delete</button></div></div>
        <div class="empty"><h2>Not analysed yet</h2><p class="muted">Tap <b>Analyze</b> when you want a summary, UPSC relevance, key points and practice questions for this document.</p></div>`;
      wireButtons(v, d, id);
      return;
    }
    const high = d.key_points.filter((k) => k.importance === "High"), rest = d.key_points.filter((k) => k.importance !== "High");
    const kp = (k) => `<div class="kp ${k.importance === "High" ? "hi" : ""}"><div>${e$(k.point)}</div>${k.why ? `<span class="muted small">Why it matters: ${e$(k.why)}</span>` : ""}${k.paper ? `<span class="paper-tag">${e$(k.paper)}</span>` : ""}</div>`;
    v.innerHTML = `<div class="doc-hero">
      <a href="#/docs" class="small">← My documents</a>
      <h1>${KIND_ICON[d.kind] || "📄"} ${e$(d.title || d.name)}</h1>
      <p class="muted small">${e$(d.name)} · ${fmtSize(d.size)}${d.pages ? ` · ${d.pages} pages` : ""} · uploaded ${fmtWhen(d.added_at)}${d.analysed_at && d.analysed_at.slice(0, 16) !== (d.added_at || "").slice(0, 16) ? ` · analysed again ${fmtWhen(d.analysed_at)}` : ""} · read by ${e$(LABEL[d.reader] || d.reader)}</p>
      <div class="row-btns">${hasFile ? `<a class="btn primary" href="#/docs/${id}/read">📖 Read document</a><button class="btn" id="reAnalyse">✦ Analyze again</button>` : `<span class="muted small">The original file is on the device it was uploaded from.</span>`}
        <button class="btn ghost" id="delDoc">Delete</button></div></div>
    <div class="doc-stats">
      <div><b>${d.key_points.length}</b><span>key points</span></div>
      <div><b>${d.prelims_facts.length}</b><span>Prelims facts</span></div>
      <div><b>${d.mcqs.length}</b><span>MCQs</span></div>
      <div><b>${d.mains_questions.length}</b><span>Mains Qs</span></div></div>
    <div class="doc-jump">${["Summary", (d.relevance || d.angles?.length) && "Relevance", "Key points", d.prelims_facts.length && "Prelims", d.mains_angles.length && "Mains", d.mcqs.length + d.mains_questions.length && "Practice"].filter(Boolean)
      .map((x) => `<a href="#" data-jump="${x}">${x}</a>`).join("")}</div>
    <section class="card doc-sec" data-sec="Summary"><h2>📝 Summary</h2><p class="doc-summary">${e$(d.summary)}</p>
      ${d.basic ? `<p class="note">This is a quick summary picked from the document's own sentences. Add a free Gemini key in <a href="#/settings">AI &amp; settings</a> and upload again for full notes and questions.</p>` : ""}</section>
    ${d.relevance || d.angles?.length ? `<section class="doc-sec card rel-card" data-sec="Relevance"><h2>🎯 UPSC relevance ${d.relevance?.level ? `<span class="imp ${d.relevance.level}">${e$(d.relevance.level)}</span>` : ""}</h2>
      ${d.relevance?.papers?.length ? `<div class="meta">${d.relevance.papers.map((p) => `<span class="tag ${e$(p)}">${e$(p)}</span>`).join("")}</div>` : ""}
      ${d.relevance?.why ? `<p>${e$(d.relevance.why)}</p>` : ""}
      ${d.angles?.length ? `<div class="tile-box why"><div class="lbl">🇮🇳 Why it matters for India</div><div class="angles">${d.angles.map((a) => `<div class="angle"><span class="dim">${(window.DIM_ICON || {})[a.dim] || "•"} ${e$(a.dim)}</span><span>${e$(a.point)}</span></div>`).join("")}</div></div>` : ""}</section>` : ""}
    <section class="doc-sec" data-sec="Key points"><h2 class="h2s">🎯 Key points</h2><div class="kp-grid">${[...high, ...rest].map(kp).join("")}</div></section>
    ${d.prelims_facts.length || d.static_connect.length ? `<section class="doc-sec" data-sec="Prelims"><div class="tile-grid">
      ${d.prelims_facts.length ? `<div class="tile-box"><div class="lbl">Prelims facts</div><ul>${d.prelims_facts.map((x) => `<li>${e$(x)}</li>`).join("")}</ul></div>` : ""}
      ${d.static_connect.map((s) => `<div class="tile-box static"><div class="lbl">Static connect: ${e$(s.title)}</div><ul>${s.facts.map((x) => `<li>${e$(x)}</li>`).join("")}</ul></div>`).join("")}</div></section>` : ""}
    ${d.mains_angles.length ? `<section class="doc-sec" data-sec="Mains"><div class="tile-box"><div class="lbl">Use it in Mains</div><ul>${d.mains_angles.map((x) => `<li>${e$(x)}</li>`).join("")}</ul></div></section>` : ""}
    ${d.mcqs.length || d.mains_questions.length ? `<section class="doc-sec" data-sec="Practice"><h2 class="h2s">✎ Practice</h2>
      <div id="dqs">${d.mcqs.map((q, i) => `<div class="card question" data-i="${i}"><div class="qt">${i + 1}. ${e$(q.question)}</div>
        ${q.options.map((o, j) => `<button class="opt" data-j="${j}">(${"abcd"[j]}) ${e$(o)}</button>`).join("")}
        <div class="review" hidden></div></div>`).join("")}</div>
      ${d.mains_questions.map((q) => `<div class="card question"><div class="qt">${q.paper ? `<span class="paper-tag">${e$(q.paper)}</span> ` : ""}${e$(q.question)}</div>
        ${q.hint || q.ref ? `<details><summary class="small">Points to cover and reference</summary>${q.hint ? `<p class="small">${e$(q.hint)}</p>` : ""}${q.ref ? `<div class="rv-ref">${docRefHtml(d, q)}</div>` : ""}</details>` : ""}</div>`).join("")}</section>` : ""}`;
    v.querySelectorAll("[data-jump]").forEach((a) => (a.onclick = (ev) => { ev.preventDefault(); v.querySelector(`[data-sec="${a.dataset.jump}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" }); }));
    const qs = v.querySelector("#dqs");
    if (qs) qs.addEventListener("click", (ev) => {
      const b = ev.target.closest(".opt"); if (!b) return;
      const card = b.closest(".question"); if (card.dataset.done) return;
      const q = d.mcqs[+card.dataset.i]; card.dataset.done = 1;
      card.querySelectorAll(".opt").forEach((o, j) => { if (j === q.answer) o.classList.add("right"); else if (o === b) o.classList.add("wrong"); });
      const rv = card.querySelector(".review"); rv.innerHTML = window.reviewHtml(q, +b.dataset.j, docRefHtml(d, q)); rv.hidden = false;
      card.classList.add(+b.dataset.j === q.answer ? "got" : "missed");
    });
    wireButtons(v, d, id);
  }
  function wireButtons(v, d, id) {
    const re = v.querySelector("#reAnalyse");
    if (re) re.onclick = async () => {
      const label = re.textContent;
      const f = await idb("get", id); re.disabled = true;
      let box = v.querySelector("#anaStatus");
      if (!box) { box = document.createElement("div"); box.id = "anaStatus"; box.className = "dz-status"; re.closest(".doc-hero").appendChild(box); }
      let cancel = null;
      box.className = "dz-status"; box.innerHTML = `<div class="prog"><span class="spin">⟳</span> <span id="anaMsg">Starting…</span></div><div class="prog-bar"><i></i></div>
        <div class="row-btns" style="margin-top:10px"><button class="btn" id="anaStop">Stop</button></div>`;
      box.querySelector("#anaStop").onclick = () => cancel?.();
      try { await analyse(new File([f.blob], f.name, { type: f.type }), (m) => { const x = box.querySelector("#anaMsg"); if (x) x.textContent = m; }, d, { onCancel: (fn) => (cancel = fn) }); viewDoc(id); }
      catch (err) { box.className = "dz-status err"; box.textContent = err.message; re.disabled = false; re.textContent = label; }
    };
    v.querySelector("#delDoc").onclick = async () => { if (!confirm("Delete this document and its notes?")) return; await deleteDoc(id); location.hash = "#/docs"; };
  }

  // ---------- In-app reader (works offline; the file is stored on this device) ----------
  async function viewReader(id) {
    const d = getDoc(id), v = document.querySelector("#view");
    document.querySelector("#crumb").textContent = "Reading";
    const f = await idb("get", id).catch(() => null);
    if (!d || !f) { v.innerHTML = `<div class="empty"><h2>File not on this device</h2><p class="muted">Open it on the device it was uploaded from.</p><p><a href="#/docs/${e$(id)}">Back</a></p></div>`; return; }
    const kind = d.kind;
    v.innerHTML = `<div class="reader-bar"><a class="btn" href="#/docs/${id}">← ${d.analysed === false ? "Back" : "Notes"}</a>
        <div class="rb-title"><b>${e$(d.title || d.name)}</b><span class="muted small">Uploaded ${fmtWhen(d.added_at)}</span></div>
        ${kind === "pdf" ? `<span class="muted small" id="pgInfo"></span><button class="btn" id="zOut" aria-label="Smaller">−</button><button class="btn" id="zIn" aria-label="Bigger">+</button>` : ""}
        <button class="btn" id="dl">⬇ Save copy</button></div>
      <div class="reader" id="reader"><p class="muted">Opening…</p></div>`;
    v.querySelector("#dl").onclick = () => { const u = URL.createObjectURL(f.blob); const a = document.createElement("a"); a.href = u; a.download = f.name; a.click(); setTimeout(() => URL.revokeObjectURL(u), 60000); };
    const box = v.querySelector("#reader");
    try {
      if (kind === "pdf") await renderPdf(box, await f.blob.arrayBuffer());
      else if (kind === "image") { const u = URL.createObjectURL(f.blob); box.innerHTML = `<img class="reader-img" src="${u}" alt="${e$(d.name)}">`; }
      else if (kind === "docx") { await loadScript(CDN.mammoth); box.innerHTML = `<article class="reader-doc">${(await window.mammoth.convertToHtml({ arrayBuffer: await f.blob.arrayBuffer() })).value.replace(/<script[\s\S]*?<\/script>/gi, "")}</article>`; }
      else box.innerHTML = `<pre class="reader-text">${e$(await f.blob.text())}</pre>`;
    } catch (err) { box.innerHTML = `<div class="dz-status err">Could not open this file: ${e$(err.message)}</div>`; }
  }
  async function renderPdf(box, buf) {
    await loadScript(CDN.pdf);
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = CDN.pdfWorker;
    const pdf = await window.pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
    let zoom = 1;
    const info = document.querySelector("#pgInfo");
    if (info) info.textContent = `${pdf.numPages} page${pdf.numPages > 1 ? "s" : ""}`;
    const draw = () => {
      box.innerHTML = Array.from({ length: pdf.numPages }, (_, i) => `<div class="pdf-page" data-p="${i + 1}"><span class="pg-no">${i + 1}</span></div>`).join("");
      const width = Math.min(box.clientWidth, 1000) * zoom, dpr = Math.min(window.devicePixelRatio || 1, 2);
      const io = new IntersectionObserver((ents) => ents.forEach(async (en) => {
        if (!en.isIntersecting || en.target.dataset.done) return; en.target.dataset.done = 1; io.unobserve(en.target);
        const page = await pdf.getPage(+en.target.dataset.p); const vp0 = page.getViewport({ scale: 1 });
        const vp = page.getViewport({ scale: (width / vp0.width) * dpr });
        const c = document.createElement("canvas"); c.width = vp.width; c.height = vp.height; c.style.width = width + "px";
        en.target.style.minHeight = ""; en.target.appendChild(c);
        await page.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
      }), { rootMargin: "800px 0px" });
      box.querySelectorAll(".pdf-page").forEach((el) => { el.style.minHeight = Math.round(width * 1.3) + "px"; el.style.width = width + "px"; io.observe(el); });
    };
    draw();
    const zi = document.querySelector("#zIn"), zo = document.querySelector("#zOut");
    if (zi) zi.onclick = () => { zoom = Math.min(zoom + 0.25, 2.5); draw(); };
    if (zo) zo.onclick = () => { zoom = Math.max(zoom - 0.25, 0.5); draw(); };
  }

  window.DOCS = { view: (id, mode) => (id ? (mode === "read" ? viewReader(id) : viewDoc(id)) : viewList()), list: listDocs, monthQuestions: (m, n) => monthQuestions(m, n) };
  window.addEventListener("upsc-synced", () => { if (location.hash === "#/docs" && !document.querySelector(".dropzone.busy")) window.DOCS.view(); });
})();
