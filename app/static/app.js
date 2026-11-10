// UPSC Daily — single-page PWA (vanilla JS)
const $ = (s, el = document) => el.querySelector(s);
const view = $("#view");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const STATIC = !!window.STATIC_API;          // GitHub Pages build: no server, data from JSON files
const pdfUrl = (day) => (STATIC ? `pdfs/UPSC-CA-${day}.pdf` : `/api/pdf/${day}`);
const api = async (path, opts = {}) => {
  if (STATIC) return window.STATIC_API(path, opts);
  const r = await fetch(path, { credentials: "same-origin", headers: { "content-type": "application/json" }, ...opts });
  if (r.status === 401 && !path.startsWith("/api/auth")) { showAuth(); throw new Error("Please sign in"); }
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || r.statusText);
  return r.json();
};
const post = (path, body = {}) => api(path, { method: "POST", body: JSON.stringify(body) });
const fmtDay = (d, opts = { weekday: "long", day: "numeric", month: "long", year: "numeric" }) =>
  new Date(d + "T00:00:00").toLocaleDateString("en-IN", opts);
const monthLabel = (m) => new Date(m + "-01T00:00:00").toLocaleDateString("en-IN", { month: "long", year: "numeric" });
function toast(msg, ms = 3400) {
  const t = $("#toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), ms);
}
let overview = null;
const RANK = { High: 0, Medium: 1, Low: 2 };
const PAPER_ORDER = ["GS1", "GS2", "GS3", "GS4", "Prelims"];

// ---------- Auth ----------
function showAuth() {
  document.body.classList.add("signed-out");
  $("#auth").hidden = false;
}
function setupAuth() {
  let mode = "login";
  const f = $("#authForm");
  const sw = () => {
    $("#authTitle").textContent = mode === "login" ? "Sign in" : "Create your account";
    $("#authGo").textContent = mode === "login" ? "Sign in" : "Create account";
    $("#authSwitch").innerHTML = mode === "login" ? "New here? <b>Create an account</b>" : "Already have an account? <b>Sign in</b>";
    $("#authMsg").textContent = "";
  };
  $("#authSwitch").onclick = (e) => { e.preventDefault(); mode = mode === "login" ? "register" : "login"; sw(); };
  f.onsubmit = async (e) => {
    e.preventDefault();
    $("#authGo").disabled = true;
    try {
      await post(`/api/auth/${mode}`, { username: f.username.value, password: f.password.value });
      $("#auth").hidden = true; document.body.classList.remove("signed-out");
      start();
    } catch (err) { $("#authMsg").textContent = err.message; }
    $("#authGo").disabled = false;
  };
  sw();
}

// ---------- Router ----------
const routes = { today: viewToday, day: viewToday, archive: viewArchive, explore: viewExplore, saved: () => viewExplore(null, true), quiz: viewQuiz, settings: viewSettings };
async function route() {
  const [, name = "today", arg] = location.hash.split("/");
  const nav = name === "day" ? "today" : name;
  document.querySelectorAll("[data-nav]").forEach((a) => a.classList.toggle("active", a.dataset.nav === nav));
  view.innerHTML = `<p class="muted">Loading…</p>`;
  try { await (routes[name] || viewToday)(arg); } catch (e) { view.innerHTML = `<div class="empty"><h2>Something went wrong</h2><p class="muted">${esc(e.message)}</p></div>`; }
  window.scrollTo(0, 0);
}
window.addEventListener("hashchange", route);

async function loadOverview() {
  overview = await api("/api/overview");
  const nf = overview.next_fetch ? new Date(overview.next_fetch).toLocaleString("en-IN", { weekday: "short", hour: "2-digit", minute: "2-digit" }) : "—";
  $("#nextFetch").textContent = overview.running ? "Fetching today's news…" : `Next auto-update: ${nf}`;
  if (STATIC) { $("#nextFetch").textContent = `Updated every morning · last: ${overview.runs[0]?.fetched_at?.slice(0, 16).replace("T", " ") || "—"}`; return overview; }
  $("#fetchBtn").disabled = overview.running;
  $("#fetchBtn").innerHTML = overview.running ? `<span class="spin">↻</span><span class="lbl-sm"> Updating…</span>` : `↻<span class="lbl-sm"> Update now</span>`;
  $("#who").textContent = overview.user ? overview.user.username : "";
  return overview;
}

// ---------- Item card ----------
function list(v) { v = Array.isArray(v) ? v : v ? [v] : []; return v.length ? `<ul>${v.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""; }
function sourceLabel(it) {
  const when = it.published ? new Date(it.published).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "";
  return `${it.source} · ${it.section}${when ? " · " + when : ""}`;
}
function sourceLine(it) {
  const what = it.source === "PIB" ? "Open the PIB press release" : "Read the full article on The Hindu";
  return `<div class="source"><span class="muted">Source: ${esc(sourceLabel(it))}</span><a href="${esc(it.link)}" target="_blank" rel="noopener">${what} ↗</a></div>`;
}
function itemCard(it, showDay = false) {
  const n = it.notes || {};
  const imp = it.importance || "Low";
  const pyqs = (n.related_pyqs || []).map((q) => `<li><b>${esc(q.year)} ${esc(q.paper)}:</b> ${esc(q.question)}</li>`).join("");
  const boxes = [
    n.prelims?.length ? `<div class="box"><div class="lbl">Prelims pointers</div>${list(n.prelims)}</div>` : "",
    n.mains ? `<div class="box"><div class="lbl">Mains angle</div>${esc(n.mains)}</div>` : "",
    pyqs ? `<div class="box"><div class="lbl">Asked before (PYQ)</div><ul>${pyqs}</ul></div>` : "",
    n.question ? `<div class="box"><div class="lbl">Practice question</div><div class="q">${esc(n.question)}</div></div>` : "",
  ].join("");
  return `<article class="card imp-${imp}" data-id="${it.id}">
    <div class="meta">
      <span class="imp ${imp}">${imp} importance</span>
      ${it.papers.map((p) => `<span class="tag ${esc(p)}">${esc(p)}</span>`).join("")}
      <span class="tag stage">${esc(it.stage === "Both" ? "Prelims + Mains" : it.stage)}</span>
      ${n.ai ? `<span class="tag ai">✦ AI notes</span>` : ""}
      ${showDay ? `<span>${fmtDay(it.day, { day: "numeric", month: "short", year: "numeric" })}</span>` : ""}
      <button class="mark ${it.bookmarked ? "on" : ""}" data-mark="${it.id}" aria-label="Save for revision">${it.bookmarked ? "★" : "☆"}</button>
    </div>
    <h3><a class="title-link" href="${esc(it.link)}" target="_blank" rel="noopener">${esc(it.title)}</a></h3>
    ${n.summary?.length ? list(n.summary) : `<p>${esc(it.excerpt)}</p>`}
    ${boxes ? `<div class="sect">${boxes}</div>` : ""}
    ${sourceLine(it)}
  </article>`;
}
function briefRow(it) {
  return `<li class="brief"><a href="${esc(it.link)}" target="_blank" rel="noopener">${esc(it.title)}</a>
    <span class="muted small">${esc(sourceLabel(it))}</span>
    <button class="mark ${it.bookmarked ? "on" : ""}" data-mark="${it.id}" aria-label="Save for revision">${it.bookmarked ? "★" : "☆"}</button></li>`;
}
document.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-mark]"); if (!b) return;
  const r = await post(`/api/bookmark/${b.dataset.mark}`);
  b.classList.toggle("on", r.bookmarked); b.textContent = r.bookmarked ? "★" : "☆";
  toast(r.bookmarked ? "Saved for revision" : "Removed from saved");
});

// Sections: subject -> items sorted by importance
function sections(items) {
  const groups = {};
  items.forEach((i) => { const s = i.topics[0] || "Other"; (groups[s] ||= { paper: i.papers[0] || "Prelims", items: [] }).items.push(i); });
  return Object.entries(groups).map(([subject, g]) => {
    g.items.sort((a, b) => RANK[a.importance || "Low"] - RANK[b.importance || "Low"] || b.score - a.score);
    return { subject, paper: g.paper, items: g.items, high: g.items.filter((i) => i.importance === "High").length };
  }).sort((a, b) => PAPER_ORDER.indexOf(a.paper) - PAPER_ORDER.indexOf(b.paper) || b.high - a.high || b.items.length - a.items.length);
}

// ---------- Today / Day ----------
async function viewToday(day) {
  await loadOverview();
  day = day || overview.today;
  $("#crumb").textContent = day === overview.today ? "Today" : "Daily notes";
  const data = await api(`/api/day/${day}`);
  const items = data.items;
  if (!items.length) {
    view.innerHTML = `<div class="hero"><div><h1>${fmtDay(day)}</h1><p>Notes from PIB and The Hindu, sorted for UPSC CSE.</p></div></div>
      <div class="empty"><h2>${overview.running ? "Fetching today's news…" : "No notes for this day yet"}</h2>
      <p class="muted">${overview.running ? "This takes a minute or two. The page refreshes by itself." : "News is collected automatically every morning. Tap <b>Update now</b> to fetch it right away."}</p></div>`;
    return;
  }
  const count = (f) => items.filter(f).length;
  const state = { paper: "", stage: "", imp: "", q: "" };
  const secs = sections(items);
  view.innerHTML = `<div class="hero">
      <div><h1>${fmtDay(day)}</h1><p>${items.length} UPSC-relevant items from PIB and The Hindu, grouped by subject and importance.</p></div>
      <div class="hero-actions">
        <a class="btn primary" href="${pdfUrl(day)}" download>⬇ Download PDF</a>
        <button class="btn" id="aiBtn">✦ AI notes with my key</button>
      </div></div>
    <div class="stats">
      <div class="stat hi"><b>${count((i) => i.importance === "High")}</b><span>High importance</span></div>
      <div class="stat"><b>${count((i) => i.stage !== "Mains")}</b><span>Prelims</span></div>
      <div class="stat"><b>${count((i) => i.stage !== "Prelims")}</b><span>Mains</span></div>
      ${["GS1", "GS2", "GS3", "GS4"].map((p) => `<div class="stat"><b>${count((i) => i.papers.includes(p))}</b><span>${p}</span></div>`).join("")}
    </div>
    <div class="toc">${secs.map((s, i) => `<a href="#sec-${i}" data-jump="sec-${i}" class="toc-i"><span class="dot ${s.paper}"></span>${esc(s.subject)} <b>${s.items.length}</b></a>`).join("")}</div>
    <div class="filters" id="filters">
      ${["", "High", "Medium"].map((s) => `<button class="chip ${s === "" ? "on" : ""}" data-imp="${s}">${s ? s + "+" : "Any importance"}</button>`).join("")}
      <span class="sep"></span>
      ${["", "Prelims", "Mains"].map((s) => `<button class="chip ${s === "" ? "on" : ""}" data-stage="${s}">${s || "Both stages"}</button>`).join("")}
      <input class="input" id="q" placeholder="Filter by keyword…" type="search">
    </div>
    <div id="secs"></div>`;
  const draw = () => {
    const keep = (i) => (!state.stage || i.stage === state.stage || i.stage === "Both") &&
      (!state.imp || RANK[i.importance || "Low"] <= RANK[state.imp]) &&
      (!state.q || (i.title + i.excerpt + i.topics.join(" ")).toLowerCase().includes(state.q));
    const html = secs.map((s, idx) => {
      const f = s.items.filter(keep); if (!f.length) return "";
      return `<section class="subject" id="sec-${idx}"><div class="subject-h"><span class="dot ${s.paper}"></span><h2>${esc(s.subject)}</h2>
        <span class="tag ${s.paper}">${s.paper}</span><span class="muted small">${f.length} item${f.length > 1 ? "s" : ""}</span></div>
        <div class="cards">${f.filter((i) => i.importance !== "Low").map((i) => itemCard(i)).join("")}</div>
        ${f.some((i) => i.importance === "Low") ? `<div class="also"><div class="lbl">Also in the news</div><ul>${f.filter((i) => i.importance === "Low").map(briefRow).join("")}</ul></div>` : ""}</section>`;
    }).join("");
    $("#secs").innerHTML = html || `<div class="empty"><p class="muted">Nothing matches these filters.</p></div>`;
  };
  $("#filters").addEventListener("click", (e) => {
    const b = e.target.closest(".chip"); if (!b) return;
    const key = "imp" in b.dataset ? "imp" : "stage";
    state[key] = b.dataset[key];
    document.querySelectorAll(`[data-${key}]`).forEach((x) => x.classList.toggle("on", x === b));
    draw();
  });
  $(".toc").addEventListener("click", (e) => { const a = e.target.closest("[data-jump]"); if (!a) return; e.preventDefault(); document.getElementById(a.dataset.jump)?.scrollIntoView({ behavior: "smooth", block: "start" }); });
  $("#q").addEventListener("input", (e) => { state.q = e.target.value.toLowerCase(); draw(); });
  $("#aiBtn").onclick = () => runAiNotes(day);
  draw();
}

async function runAiNotes(day) {
  const s = await api("/api/settings");
  if (s.provider === "none") { toast("Add your Claude, Gemini or ChatGPT key in AI settings first"); location.hash = "#/settings"; return; }
  const r = await post("/api/ai/notes", { day });
  if (!r.started) return toast(r.message);
  toast(`Writing notes with ${s.providers[s.provider].label}… this takes about a minute`, 6000);
  const btn = $("#aiBtn"); if (btn) { btn.disabled = true; btn.innerHTML = `<span class="spin">✦</span> Writing notes…`; }
  const tick = async () => {
    const st = (await api("/api/ai/status")).status;
    if (st === "running") return setTimeout(tick, 4000);
    if (st.startsWith("error")) toast("AI notes failed: " + st.slice(7), 8000);
    else { toast("AI notes ready. Your PDF button now includes them."); }
    if (location.hash === "" || location.hash.startsWith("#/today") || location.hash.startsWith("#/day")) {
      await route();
      const dl = document.querySelector(".hero-actions .btn.primary");
      if (dl && !st.startsWith("error") && !STATIC) { dl.href = `/api/pdf/${day}?mine=1`; dl.textContent = "⬇ Download my AI PDF"; }
    }
  };
  setTimeout(tick, 4000);
}

// ---------- Archive ----------
async function viewArchive() {
  $("#crumb").textContent = "PDF Archive";
  await loadOverview();
  const runs = overview.runs.filter((r) => r.item_count > 0);
  if (!runs.length) { view.innerHTML = `<div class="empty"><h2>No PDFs yet</h2><p class="muted">The first daily PDF appears here after the first update.</p></div>`; return; }
  const byMonth = {};
  runs.forEach((r) => (byMonth[r.day.slice(0, 7)] ||= []).push(r));
  view.innerHTML = `<div class="hero"><div><h1>PDF Archive</h1><p>${runs.length} daily PDFs, ${overview.total_items} notes in total.</p></div></div>
    <div class="months">${Object.entries(byMonth).map(([m, rs]) => `<div class="month"><h2>${monthLabel(m)}</h2><div class="days">
      ${rs.map((r) => `<div class="day"><b>${fmtDay(r.day, { day: "numeric", month: "short" })}</b>
        <span class="muted small">${fmtDay(r.day, { weekday: "long" })} · ${r.item_count} items</span>
        <div class="row"><a class="btn" href="#/day/${r.day}">Read</a>${r.has_pdf ? `<a class="btn primary" href="${pdfUrl(r.day)}" download>⬇ PDF</a>` : ""}</div></div>`).join("")}
    </div></div>`).join("")}</div>`;
}

// ---------- Explore / Saved ----------
async function viewExplore(_, saved = false) {
  $("#crumb").textContent = saved ? "Saved for revision" : "Explore notes";
  view.innerHTML = `<div class="hero"><div><h1>${saved ? "Saved for revision" : "Explore all notes"}</h1><p>${saved ? "Items you starred. They sync to every device you sign in on." : "Search every item collected so far, for revision by topic, paper or importance."}</p></div></div>
    <div class="filters"><input class="input" id="sq" type="search" placeholder="Search e.g. RBI, tiger, Governor, semiconductor…">
      <select class="input" id="sp"><option value="">All papers</option>${PAPER_ORDER.map((p) => `<option>${p}</option>`).join("")}</select>
      <select class="input" id="si"><option value="">Any importance</option><option>High</option><option>Medium</option><option>Low</option></select>
      <select class="input" id="ss"><option value="">Both stages</option><option>Prelims</option><option>Mains</option></select></div>
    <div class="cards" id="res"></div>`;
  let t;
  const run = async () => {
    const qs = new URLSearchParams({ q: $("#sq").value, paper: $("#sp").value, stage: $("#ss").value, importance: $("#si").value, saved: saved ? 1 : 0 });
    const r = await api(`/api/search?${qs}`);
    $("#res").innerHTML = r.map((i) => itemCard(i, true)).join("") || `<div class="empty"><p class="muted">${saved ? "Tap ☆ on any note to save it here." : "No notes found."}</p></div>`;
  };
  ["#sq", "#sp", "#ss", "#si"].forEach((s) => $(s).addEventListener("input", () => { clearTimeout(t); t = setTimeout(run, 250); }));
  run();
}

// ---------- Quiz ----------
async function viewQuiz(month) {
  $("#crumb").textContent = "Monthly quiz";
  if (month) return takeQuiz(month);
  const qs = await api("/api/quizzes");
  const thisMonth = (overview?.today || new Date().toISOString()).slice(0, 7);
  view.innerHTML = `<div class="hero"><div><h1>Monthly quiz</h1><p>A Prelims-style quiz on last month's current affairs is published on the 1st of every month. You'll get a notification when it's ready.</p></div>
    ${STATIC ? "" : `<button class="btn" id="genNow">Make a quiz for ${monthLabel(thisMonth)} so far</button>`}</div>
    ${qs.length ? `<div class="quiz-list">${qs.map((q) => `<div class="card qcard"><h3>${monthLabel(q.month)}</h3>
      <span class="muted small">${q.count} questions · ${q.ai ? "written by AI" : "auto-generated"}</span>
      <span class="small">${q.best ? `Your best: <b>${q.best.score}/${q.best.total}</b>` : "Not attempted yet"}</span>
      <a class="btn primary" href="#/quiz/${q.month}">${q.best ? "Retake" : "Start quiz"}</a></div>`).join("")}</div>`
      : `<div class="empty"><h2>No quizzes yet</h2><p class="muted">Quizzes are built from the saved notes. Once there are a few days of notes, try the button above.</p></div>`}`;
  if ($("#genNow")) $("#genNow").onclick = async (e) => {
    e.target.disabled = true; e.target.textContent = "Building quiz…";
    try {
      const r = await post("/api/quiz/generate", { month: thisMonth });
      if (r.error) { toast(r.error); e.target.disabled = false; e.target.textContent = "Try again"; return; }
      toast(`Quiz ready: ${r.questions} questions`); refreshNotifs(); location.hash = `#/quiz/${thisMonth}`;
    } catch (err) { toast(err.message); e.target.disabled = false; }
  };
}
async function takeQuiz(month) {
  const quiz = await api(`/api/quiz/${month}`);
  const answers = Array(quiz.questions.length).fill(null);
  view.innerHTML = `<div class="hero"><div><h1>${monthLabel(month)} quiz</h1><p>${quiz.questions.length} questions. Pick one option per question, then submit.</p></div><a class="btn" href="#/quiz">← All quizzes</a></div>
    <div id="qs">${quiz.questions.map((q, i) => `<div class="card question" data-i="${i}"><div class="qt">${i + 1}. ${esc(q.question)}</div>
      ${q.options.map((o, j) => `<button class="opt" data-j="${j}">(${"abcd"[j]}) ${esc(o)}</button>`).join("")}
      <div class="explain" hidden>${esc(q.explanation || "")} ${q.link ? `<a href="${esc(q.link)}" target="_blank" rel="noopener">Source ↗</a>` : ""}</div></div>`).join("")}</div>
    <div class="submit-bar"><button class="btn primary" id="submit">Submit answers</button><span id="result"></span></div>`;
  $("#qs").addEventListener("click", (e) => {
    const b = e.target.closest(".opt"); if (!b || $("#qs").dataset.done) return;
    const card = b.closest(".question"); answers[+card.dataset.i] = +b.dataset.j;
    card.querySelectorAll(".opt").forEach((o) => o.classList.toggle("sel", o === b));
  });
  $("#submit").onclick = async () => {
    const left = answers.filter((a) => a === null).length;
    if (left && !confirm(`${left} question(s) unanswered. Submit anyway?`)) return;
    const r = await post(`/api/quiz/${month}/attempt`, { answers });
    $("#qs").dataset.done = 1;
    document.querySelectorAll(".question").forEach((card, i) => {
      const q = quiz.questions[i];
      card.querySelectorAll(".opt").forEach((o, j) => { if (j === q.answer) o.classList.add("right"); else if (j === answers[i]) o.classList.add("wrong"); });
      card.querySelector(".explain").hidden = false;
    });
    $("#submit").hidden = true;
    $("#result").innerHTML = `<span class="score">${r.score}/${r.total}</span> <span class="muted">Explanations are shown under each question.</span>`;
  };
}

// ---------- Settings ----------
async function viewSettings() {
  $("#crumb").textContent = "AI & settings";
  const s = await api("/api/settings");
  const P = s.providers;
  view.innerHTML = `<div class="hero"><div><h1>AI summaries</h1><p>Optional. Paste your own Claude, Gemini or ChatGPT API key and tap <b>AI notes with my key</b> on any day for richer notes and practice questions. Without a key the portal still works with built-in notes.</p></div></div>
  <div class="form card">
    <label>Summarise with<div class="radio" id="prov">
      ${[["none", "No AI (built-in)"], ...Object.entries(P).map(([k, v]) => [k, v.label])].map(([v, l]) => `<button class="chip ${s.provider === v ? "on" : ""}" data-v="${v}">${esc(l)}</button>`).join("")}</div></label>
    ${Object.entries(P).map(([k, v]) => `<div class="pv" data-pv="${k}" ${s.provider === k ? "" : "hidden"}>
      <label>${esc(v.label)} API key <span>Get one at ${esc(v.key_hint)}.</span><input class="input" id="${k}_key" type="password" autocomplete="off" placeholder="Paste key" value="${esc(s[k + "_key"])}"></label>
      <label>Model <span>Leave as is unless you know you want another.</span><input class="input" id="${k}_model" value="${esc(s[k + "_model"])}"></label></div>`).join("")}
    <div class="note">${STATIC ? "Your key is stored only on this device and sent only to the AI company you choose." : "Your key is saved to your account, so it works on every device you sign in on."} News excerpts are sent to the AI you choose to write the notes.</div>
    <div class="row-btns"><button class="btn primary" id="save">Save</button><button class="btn" id="test">Test connection</button></div>
    <div id="msg" class="small"></div>
  </div>
  ${STATIC && window.SYNC?.state.enabled ? `<h2 class="h2s">Username &amp; sync</h2>
  <div class="card form" id="syncCard"></div>` : ""}
  <h2 class="h2s">App version</h2>
  <div class="card form"><p style="margin:0">Version <b id="verLbl">…</b>. The app checks for updates by itself; you can also tap <b>⟳ Check for updates</b> at the top right any time.</p></div>
  <h2 class="h2s">Notifications</h2>
  <div class="card form"><p style="margin:0">Get a notification on this device when the daily PDF or the monthly quiz is ready.</p>
    <div><button class="btn" id="perm">${"Notification" in window && Notification.permission === "granted" ? "Notifications are on ✓" : "Turn on notifications"}</button></div>
    <p class="muted small" style="margin:0">On the Galaxy tablet, install the app first (Chrome or Samsung Internet menu → <b>Add to Home screen</b> / <b>Install app</b>) so notifications work reliably.</p></div>
  ${STATIC ? "" : `<h2 class="h2s">Open on your tablet</h2>
  <div class="card form"><p style="margin:0">When this portal runs on your PC, open this link on the tablet while it is on the same Wi-Fi, then use the browser menu → <b>Add to Home screen</b>.</p>
    <div id="lan" class="lanlinks muted">…</div></div>
`}
  ${STATIC ? "" : `<h2 class="h2s">Account</h2>
  <div class="card form"><p style="margin:0">Signed in as <b>${esc(overview?.user?.username || "")}</b>. Sign in with the same username and password on any device to see your saved notes, quiz scores and AI settings.</p>
    <div><button class="btn" id="logout">Sign out</button></div></div>`}`;
  if (!STATIC) api("/api/lan").then((r) => { $("#lan").innerHTML = r.links.length ? r.links.map((l) => `<a href="${esc(l)}" class="lan">${esc(l)}</a>`).join("") : "Not available"; }).catch(() => {});
  fetchVersion().then((v) => { $("#verLbl").textContent = `${v.app.slice(0, 7)} (${v.built_at.slice(0, 10)})`; }).catch(() => { $("#verLbl").textContent = bootVersion?.slice(0, 7) || "—"; });
  if ($("#syncCard")) window.SYNC.onChange(drawSyncCard);
  let provider = s.provider;
  $("#prov").onclick = (e) => {
    const b = e.target.closest(".chip"); if (!b) return; provider = b.dataset.v;
    $("#prov").querySelectorAll(".chip").forEach((x) => x.classList.toggle("on", x === b));
    document.querySelectorAll("[data-pv]").forEach((x) => (x.hidden = x.dataset.pv !== provider));
  };
  const save = () => {
    const body = { provider };
    Object.keys(P).forEach((k) => { body[k + "_key"] = $(`#${k}_key`).value; body[k + "_model"] = $(`#${k}_model`).value; });
    return post("/api/settings", body);
  };
  $("#save").onclick = async () => { await save(); toast("Saved to your account"); };
  $("#test").onclick = async () => { await save(); $("#msg").textContent = "Testing…"; const r = await post("/api/settings/test"); $("#msg").textContent = r.message; $("#msg").style.color = r.ok ? "var(--ok)" : "var(--bad)"; };
  $("#perm").onclick = async () => {
    if (!("Notification" in window)) return toast("Install the app to home screen first, then try again");
    const p = await Notification.requestPermission();
    $("#perm").textContent = p === "granted" ? "Notifications are on ✓" : "Notifications are blocked in browser settings";
  };
  if (!STATIC) $("#logout").onclick = async () => { await post("/api/auth/logout"); location.hash = ""; location.reload(); };
}

// ---------- Notifications ----------
let lastSeenId = 0;
try { lastSeenId = +(localStorage.getItem("lastNotif") || 0); } catch {}
async function showSystemNotification(n) {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) return reg.showNotification(n.title, { body: n.body, icon: "/static/icon-192.png", badge: "/static/icon-192.png", data: { link: n.link }, tag: "n" + n.id });
    new Notification(n.title, { body: n.body });
  } catch {}
}
async function refreshNotifs() {
  try {
    const ns = await api("/api/notifications");
    const unread = ns.filter((n) => !n.read).length;
    $("#badge").hidden = !unread; $("#badge").textContent = unread;
    $("#notifPanel").innerHTML = ns.length ? ns.map((n) => `<a class="n ${n.read ? "" : "unread"}" href="${esc(n.link || "#")}"><b>${esc(n.title)}</b><span>${esc(n.body)}</span></a>`).join("") : `<p class="muted small" style="padding:10px">No notifications yet.</p>`;
    const fresh = ns.filter((n) => n.id > lastSeenId && !n.read);
    if (fresh.length && "Notification" in window && Notification.permission === "granted") fresh.slice(0, 2).forEach(showSystemNotification);
    if (ns.length) { lastSeenId = Math.max(lastSeenId, ns[0].id); try { localStorage.setItem("lastNotif", lastSeenId); } catch {} }
  } catch {}
}
$("#bell").onclick = async () => {
  const p = $("#notifPanel"); p.hidden = !p.hidden;
  if (!p.hidden) { await post("/api/notifications/read"); $("#badge").hidden = true; }
};
document.addEventListener("click", (e) => { if (!e.target.closest(".bell-wrap")) $("#notifPanel").hidden = true; });
$("#fetchBtn").onclick = async () => {
  const r = await post("/api/fetch"); toast(r.started ? "Fetching PIB and The Hindu…" : r.message);
  await loadOverview(); poll();
};
function poll() {
  const wasRunning = overview?.running;
  setTimeout(async () => {
    await loadOverview();
    if (wasRunning && !overview.running) { refreshNotifs(); if (!location.hash || location.hash.startsWith("#/today") || location.hash.startsWith("#/day")) route(); }
    if (overview.running) poll();
  }, 4000);
}
document.addEventListener("visibilitychange", () => { if (!document.hidden && overview?.user) { refreshNotifs(); loadOverview(); } });

// ---------- PWA install ----------
let deferredInstall = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault(); deferredInstall = e; $("#installBtn").hidden = false;
  if (!$("#installBanner")) {
    const b = document.createElement("div"); b.id = "installBanner"; b.className = "install-banner";
    b.innerHTML = `<img src="${STATIC ? "static" : "/static"}/icon-192.png" alt=""><div><b>Install UPSC Daily as an app</b><span>Opens full screen from your home screen and app drawer, like any Android app.</span></div><button class="btn primary">Install</button><button class="x" aria-label="Close">✕</button>`;
    b.querySelector(".btn").onclick = () => $("#installBtn").click();
    b.querySelector(".x").onclick = () => b.remove();
    document.body.appendChild(b);
  }
});
window.addEventListener("appinstalled", () => { $("#installBanner")?.remove(); $("#installBtn").hidden = true; toast("Installed. Open UPSC Daily from your home screen."); });
$("#installBtn").onclick = async () => { if (!deferredInstall) return; deferredInstall.prompt(); await deferredInstall.userChoice; deferredInstall = null; $("#installBtn").hidden = true; $("#installBanner")?.remove(); };
if ("serviceWorker" in navigator) navigator.serviceWorker.register(STATIC ? "sw.js" : "/sw.js").catch(() => {});

// ---------- Sync (static build) ----------
function drawSyncCard(st) {
  const el = $("#syncCard"); if (!el || !document.body.contains(el)) return;
  el.innerHTML = st.user
    ? `<p style="margin:0">Your username is <b>${esc(st.user)}</b>. Open the app on any phone or tablet with this username and your saved items and quiz scores appear there too. AI keys stay on each device.</p>
       <div><button class="btn" id="syncOut">Use a different username</button></div>`
    : `<p style="margin:0">Pick a username to keep saved items and quiz scores the same on your phone and tablet.</p>
       <div><button class="btn primary" id="syncIn">Choose username</button></div>`;
  if (st.error) el.innerHTML += `<p class="small" style="color:var(--bad);margin:0">${esc(st.error)}</p>`;
  $("#syncIn")?.addEventListener("click", showUsernameScreen);
  $("#syncOut")?.addEventListener("click", async () => { await window.SYNC.signOut(); showUsernameScreen(); });
}
function showUsernameScreen() {
  const f = $("#authForm");
  $("#authTitle").textContent = "Your username";
  f.querySelector("p").textContent = "Type a username. Use the same one on your phone and tablet and your saved items and quiz scores stay in sync. No password needed.";
  f.password.closest("label").hidden = true; f.password.required = false;
  f.username.placeholder = "e.g. amit_upsc";
  $("#authGo").textContent = "Continue";
  $("#authSwitch").hidden = true;
  $("#auth").hidden = false; document.body.classList.add("signed-out");
  f.onsubmit = async (e) => {
    e.preventDefault(); $("#authGo").disabled = true;
    try {
      await window.SYNC.signIn(f.username.value);
      $("#auth").hidden = true; document.body.classList.remove("signed-out");
      toast(`Signed in as ${window.SYNC.state.user}`); route();
    } catch (err) { $("#authMsg").textContent = err.message; }
    $("#authGo").disabled = false;
  };
  setTimeout(() => f.username.focus(), 50);
}
if (STATIC && window.SYNC?.state.enabled) {
  window.SYNC.onChange((st) => { const w = $("#who"); if (w) w.textContent = st.user || ""; });
  window.addEventListener("upsc-synced", () => { const h = location.hash; if (h.startsWith("#/saved") || h.startsWith("#/quiz") || h === "" || h.startsWith("#/today")) route(); });
}

// ---------- Updates ----------
const VERSION_URL = STATIC ? "version.json" : "/version.json";
let bootVersion = null, latestVersion = null;
async function fetchVersion() {
  const r = await fetch(`${VERSION_URL}?t=${Date.now()}`, { cache: "no-store" });
  if (!r.ok) throw new Error("offline");
  return r.json();
}
function markUpdate(available) {
  $("#updateBtn .upd-dot").hidden = !available;
  $("#updateBtn").classList.toggle("has-update", available);
  $("#updateBtn .lbl-sm").textContent = available ? " Update available" : " Check for updates";
}
async function applyUpdate() {
  toast("Updating the app…");
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) await reg.update();
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith("upsc-shell")).map((k) => caches.delete(k)));
  } catch {}
  setTimeout(() => location.reload(), 400);
}
async function checkForUpdates(manual) {
  try {
    const v = await fetchVersion();
    bootVersion ??= v.app;
    latestVersion = v.app;
    const available = latestVersion !== bootVersion;
    markUpdate(available);
    if (manual) {
      if (available) applyUpdate();
      else { await loadOverview(); route(); refreshNotifs(); toast(`You have the latest version (${v.app.slice(0, 7)}). News refreshed.`); }
    } else if (available) toast("A new version of UPSC Daily is available. Tap ⟳ to update.", 6000);
  } catch { if (manual) toast("Can't check right now. Are you online?"); }
}
$("#updateBtn").onclick = () => checkForUpdates(true);
document.addEventListener("visibilitychange", () => { if (!document.hidden) checkForUpdates(false); });

// ---------- Boot ----------
let started = false;
async function start() {
  const me = STATIC ? { username: "" } : await fetch("/api/me", { credentials: "same-origin" }).then((r) => r.json()).catch(() => null);
  if (STATIC) $("#fetchBtn").hidden = true;
  if (STATIC && window.SYNC?.state.enabled && !window.SYNC.state.user && (() => { try { return !localStorage.getItem("upsc:username"); } catch { return true; } })()) showUsernameScreen();
  if (!me) return showAuth();
  await loadOverview(); route(); refreshNotifs();
  if (overview.running) poll();
  checkForUpdates(false);
  if (!started) { started = true; setInterval(() => checkForUpdates(false), 30 * 60000); setInterval(refreshNotifs, 60000); setInterval(loadOverview, 120000); }
}
setupAuth();
start();
