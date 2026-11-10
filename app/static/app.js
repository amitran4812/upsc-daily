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
const routes = { today: viewToday, day: viewToday, subject: viewSubject, archive: viewArchive, explore: viewExplore, saved: () => viewExplore(null, true), quiz: viewQuiz, settings: viewSettings, week: viewWeek, docs: (id) => window.DOCS.view(id) };
async function route() {
  const [, name = "today", ...args] = location.hash.split("/");
  const nav = name === "day" || name === "subject" ? "today" : name === "week" ? "archive" : name;
  document.querySelectorAll("[data-nav]").forEach((a) => a.classList.toggle("active", a.dataset.nav === nav));
  view.innerHTML = `<p class="muted">Loading…</p>`;
  try { await (routes[name] || viewToday)(...args); } catch (e) { view.innerHTML = `<div class="empty"><h2>Something went wrong</h2><p class="muted">${esc(e.message)}</p></div>`; }
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
const SUBJECT_META = {
  "History & Art and Culture": ["🏛️", "GS1"], "Geography": ["🌏", "GS1"], "Indian Society": ["👥", "GS1"],
  "Polity & Constitution": ["⚖️", "GS2"], "Governance & Social Justice": ["📋", "GS2"], "International Relations": ["🌐", "GS2"],
  "Economy": ["📈", "GS3"], "Agriculture": ["🌾", "GS3"], "Science & Technology": ["🚀", "GS3"], "Environment & Ecology": ["🌿", "GS3"],
  "Disaster Management": ["🌪️", "GS3"], "Internal Security": ["🛡️", "GS3"], "Ethics & Integrity": ["🧭", "GS4"],
  "Reports & Indices": ["📊", "Prelims"], "Awards, Days & Persons": ["🏅", "Prelims"], "Other": ["🗞️", "Prelims"],
};
const subjIcon = (s) => (SUBJECT_META[s] || SUBJECT_META.Other)[0];
const PAPER_NAME = { GS1: "History, Culture, Geography, Society", GS2: "Polity, Governance, IR", GS3: "Economy, Environment, S&T, Security", GS4: "Ethics", Prelims: "Prelims facts" };

const DIM_ICON = { "International relations": "🌐", "Internal security": "🛡️", "Economy": "💹", "Governance & polity": "🏛️", "Environment": "🌿",
  "Society": "👥", "Science & tech": "🔬", "Ethics": "⚖️", "Geography & disasters": "🌀" };
window.DIM_ICON = DIM_ICON;
function itemCard(it, showDay = false) {
  const n = it.notes || {};
  const imp = it.importance || "Low";
  const pyqs = (n.related_pyqs || []).map((q) => `<li><b>${esc(q.year)} ${esc(q.paper)}:</b> ${esc(q.question)}</li>`).join("");
  const sum = Array.isArray(n.summary) ? n.summary : n.summary ? [n.summary] : [];
  const key = sum[0] || it.excerpt;
  const statics = (n.static || []).map((s) => `<div class="tile-box static"><div class="lbl">🧱 Static connect · ${esc(s.title)}</div>${list(s.facts)}${s.upsc ? `<div class="upsc">🎯 ${esc(s.upsc)}</div>` : ""}</div>`).join("");
  const an = n.analysis && n.analysis.angles?.length ? n.analysis : null;
  const analysis = an ? `<div class="tile-box why"><div class="lbl">🇮🇳 Why it matters for India &amp; UPSC</div>
    ${an.why ? `<p class="why-lead">${esc(an.why)}</p>` : ""}
    <div class="angles">${an.angles.map((a) => `<div class="angle"><span class="dim" data-dim="${esc(a.dim)}">${DIM_ICON[a.dim] || "•"} ${esc(a.dim)}</span><span>${esc(a.point)}</span></div>`).join("")}</div></div>` : "";
  const boxes = [
    analysis,
    statics,
    n.prelims?.length ? `<div class="tile-box pre"><div class="lbl">📝 Prelims pointers</div>${list(n.prelims)}</div>` : "",
    n.mains ? `<div class="tile-box mains"><div class="lbl">✍️ Mains angle</div><p>${esc(n.mains)}</p></div>` : "",
    pyqs ? `<div class="tile-box pyq"><div class="lbl">📚 Asked before (PYQ)</div><ul>${pyqs}</ul></div>` : "",
    n.question ? `<div class="tile-box q"><div class="lbl">❓ Practice question</div><p class="q">${esc(n.question)}</p></div>` : "",
  ].join("");
  return `<article class="card ncard imp-${imp}" data-id="${it.id}">
    <div class="meta">
      <span class="imp ${imp}">${imp === "High" ? "🔥 " : ""}${imp}</span>
      ${it.papers.map((p) => `<span class="tag ${esc(p)}">${esc(p)}</span>`).join("")}
      <span class="tag stage">${esc(it.stage === "Both" ? "Prelims + Mains" : it.stage)}</span>
      ${n.ai ? `<span class="tag ai">✦ AI</span>` : ""}
      ${showDay ? `<span>${fmtDay(it.day, { day: "numeric", month: "short", year: "numeric" })}</span>` : ""}
      <button class="mark ${it.bookmarked ? "on" : ""}" data-mark="${it.id}" aria-label="Save for revision">${it.bookmarked ? "★" : "☆"}</button>
    </div>
    <h3><a class="title-link" href="${esc(it.link)}" target="_blank" rel="noopener">${esc(it.title)}</a></h3>
    <div class="keypoint"><span>Key point</span>${esc(key)}</div>
    ${sum.length > 1 ? list(sum.slice(1)) : ""}
    ${boxes ? `<div class="tile-grid">${boxes}</div>` : ""}
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
  e.preventDefault(); e.stopPropagation();
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
    return { subject, paper: (SUBJECT_META[subject] || [0, g.paper])[1], items: g.items, high: g.items.filter((i) => i.importance === "High").length };
  }).sort((a, b) => PAPER_ORDER.indexOf(a.paper) - PAPER_ORDER.indexOf(b.paper) || b.high - a.high || b.items.length - a.items.length);
}

// ---------- Figures (inline SVG) ----------
const PAPER_VAR = { GS1: "--gs1", GS2: "--gs2", GS3: "--gs3", GS4: "--gs4", Prelims: "--pre" };
function donut(parts, total, label) {
  const R = 52, C = 2 * Math.PI * R; let off = 0;
  const segs = parts.filter((p) => p.n).map((p) => {
    const len = (p.n / total) * C; const s = `<circle r="${R}" cx="70" cy="70" fill="none" stroke="var(${p.color})" stroke-width="22" stroke-dasharray="${len - 2} ${C - len + 2}" stroke-dashoffset="${-off}" transform="rotate(-90 70 70)"><title>${esc(p.label)}: ${p.n}</title></circle>`;
    off += len; return s;
  }).join("");
  return `<svg viewBox="0 0 140 140" class="donut" role="img" aria-label="${esc(label)}">${segs}
    <text x="70" y="68" text-anchor="middle" class="d-big">${total}</text><text x="70" y="86" text-anchor="middle" class="d-small">items</text></svg>`;
}
function impBar(items) {
  const c = { High: 0, Medium: 0, Low: 0 }; items.forEach((i) => c[i.importance || "Low"]++);
  const t = items.length || 1;
  return `<div class="impbar">${["High", "Medium", "Low"].map((k) => c[k] ? `<span class="seg ${k}" style="flex:${c[k]}" title="${k}: ${c[k]}"></span>` : "").join("")}</div>
    <div class="implegend">${["High", "Medium", "Low"].map((k) => `<span><i class="sw ${k}"></i>${k} <b>${c[k]}</b> <em>${Math.round((c[k] / t) * 100)}%</em></span>`).join("")}</div>`;
}

// ---------- Weekly report ----------
const weekPdf = (start) => `pdfs/weekly/UPSC-Weekly-${start}.pdf`;
function weekBanner() {
  const ws = overview?.weeks || []; if (!STATIC || !ws.length) return "";
  const cur = ws[0], last = ws.find((w) => w.complete);
  const card = (w, title) => `<a class="week-banner" href="#/week/${w.start}"><span class="wb-ico">📅</span><span><b>${title}</b><span class="muted small">${esc(w.label)} · ${w.high} top stories · ${w.medium} also important</span></span><span class="wb-go">Open →</span></a>`;
  return `<div class="week-row">${card(cur, cur.complete ? "Weekly report" : "This week so far")}${last && last !== cur ? card(last, "Last week's report") : ""}</div>`;
}
async function viewWeek(start) {
  $("#crumb").textContent = "Weekly report";
  if (!STATIC) { view.innerHTML = `<div class="empty"><h2>Weekly reports are in the app version</h2></div>`; return; }
  const ws = (await api("/api/weekly")) || [];
  if (!start) {
    view.innerHTML = `<div class="hero"><div><h1>Weekly reports</h1><p>Every Monday you get a short report of the previous week's important current affairs, with why each matters for India and UPSC, Prelims revision and static topics.</p></div></div>
      ${ws.length ? `<div class="doc-grid">${ws.map(weekTile).join("")}</div>` : `<div class="empty"><h2>No weekly report yet</h2></div>`}`;
    return;
  }
  const w = await api(`/api/week/${start}`);
  if (!w) { view.innerHTML = `<div class="empty"><h2>Report not found</h2><p><a href="#/week">All weekly reports</a></p></div>`; return; }
  const high = w.items.filter((i) => (i.notes?.importance || i.importance) === "High");
  const med = w.items.filter((i) => (i.notes?.importance || i.importance) !== "High");
  const prelims = [], statics = [], seenP = new Set(), seenS = new Set();
  w.items.forEach((i) => {
    (i.notes?.prelims || []).forEach((p) => { if (!p.startsWith("Key terms") && !seenP.has(p)) { seenP.add(p); prelims.push(p); } });
    (i.notes?.static || []).forEach((s) => { if (s.title && !seenS.has(s.title)) { seenS.add(s.title); statics.push(s); } });
  });
  const bySubj = {}; med.forEach((i) => (bySubj[i.topics[0] || "Other"] ||= []).push(i));
  const paperCount = PAPER_ORDER.map((p) => ({ label: p, color: PAPER_VAR[p], n: w.items.filter((i) => (i.papers[0] || "Prelims") === p).length }));
  const dims = {}; w.items.forEach((i) => (i.notes?.analysis?.angles || []).forEach((a) => (dims[a.dim] = (dims[a.dim] || 0) + 1)));
  const dimMax = Math.max(1, ...Object.values(dims));
  view.innerHTML = `<div class="hero glance">
      <div class="glance-text"><div class="eyebrow">Weekly report${w.complete ? "" : " · week in progress"}</div><h1>${esc(w.label)}</h1>
        <p>${high.length} top stories and ${med.length} more that matter, with why each is important for India and UPSC.</p>
        <div class="hero-actions">${w.has_pdf ? `<a class="btn primary" href="${weekPdf(w.start)}" download>⬇ Weekly PDF</a>` : ""}<a class="btn" href="#/week">All weeks</a></div></div>
      <div class="glance-figs card">
        <div class="fig">${donut(paperCount, w.items.length, "Stories by GS paper")}
          <div class="fig-legend">${paperCount.filter((p) => p.n).map((p) => `<span><i class="sw" style="background:var(${p.color})"></i>${p.label} <b>${p.n}</b></span>`).join("")}</div></div>
        <div class="fig-imp"><div class="lbl">What the week was about</div>
          <div class="dimbars">${Object.entries(dims).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([d, n]) => `<div class="dimbar"><span>${DIM_ICON[d] || "•"} ${esc(d)}</span><i style="width:${Math.round((n / dimMax) * 100)}%"></i><b>${n}</b></div>`).join("")}</div></div>
      </div></div>
    ${w.overview ? `<div class="card week-brief"><h2>🗞️ The week in brief</h2>${w.overview.intro ? `<p>${esc(w.overview.intro)}</p>` : ""}
      <div class="tile-grid">${w.overview.themes.map((t) => `<div class="tile-box"><div class="lbl">${esc(t.title)}</div>${list(t.points)}</div>`).join("")}</div></div>` : ""}
    <div class="doc-jump">${["Top stories", med.length && "Also important", prelims.length && "Prelims revision", statics.length && "Static topics"].filter(Boolean).map((x) => `<a href="#" data-jump="${x}">${x}</a>`).join("")}</div>
    ${high.length ? `<section class="doc-sec" data-sec="Top stories"><h2 class="row-h">🔥 Top stories of the week</h2><div class="cards">${high.map((i) => itemCard(i, true)).join("")}</div></section>` : ""}
    ${med.length ? `<section class="doc-sec" data-sec="Also important"><h2 class="row-h">📌 Also important</h2>
      ${Object.entries(bySubj).map(([s, its]) => `<div class="card wk-subj"><h3>${subjIcon(s)} ${esc(s)}</h3>${its.map((i) => {
        const an = i.notes?.analysis; const sum = Array.isArray(i.notes?.summary) ? i.notes.summary[0] : i.notes?.summary;
        return `<div class="wk-item"><a class="title-link" href="${esc(i.link)}" target="_blank" rel="noopener"><b>${esc(i.title)}</b></a>
          <span class="muted small">${fmtDay(i.day, { day: "numeric", month: "short" })} · ${esc(i.source)}</span>
          ${sum ? `<p>${esc(sum)}</p>` : ""}
          ${an?.angles?.length ? `<div class="wk-why">${an.angles.slice(0, 2).map((a) => `<span><b>${DIM_ICON[a.dim] || "•"} ${esc(a.dim)}:</b> ${esc(a.point)}</span>`).join("")}</div>` : ""}</div>`; }).join("")}</div>`).join("")}</section>` : ""}
    ${prelims.length ? `<section class="doc-sec card" data-sec="Prelims revision"><h2>📝 Prelims quick revision</h2>${list(prelims.slice(0, 40))}</section>` : ""}
    ${statics.length ? `<section class="doc-sec" data-sec="Static topics"><h2 class="row-h">🧱 Static topics this week</h2><div class="tile-grid">${statics.slice(0, 20).map((s) => `<div class="tile-box static"><div class="lbl">${esc(s.title)}</div>${list(s.facts)}</div>`).join("")}</div></section>` : ""}`;
  view.querySelectorAll("[data-jump]").forEach((a) => (a.onclick = (ev) => { ev.preventDefault(); view.querySelector(`[data-sec="${a.dataset.jump}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" }); }));
}
function weekTile(w) {
  return `<a class="doc-tile" href="#/week/${w.start}"><span class="doc-ico">📅</span><b>${esc(w.label)}</b>
    <span class="muted small">${w.complete ? "Full week" : "Week in progress"}</span>
    <span class="doc-meta"><span>${w.high} top</span><span>${w.medium} also important</span>${w.has_pdf ? "<span>PDF</span>" : ""}</span></a>`;
}

// ---------- Today / Day (tiles) ----------
async function viewToday(day) {
  await loadOverview();
  day = day || overview.today;
  $("#crumb").textContent = day === overview.today ? "Today" : "Daily notes";
  const data = await api(`/api/day/${day}`);
  const items = data.items;
  if (!items.length) {
    view.innerHTML = `<div class="hero"><div><h1>${fmtDay(day)}</h1><p>Notes from PIB and The Hindu, sorted for UPSC CSE.</p></div></div>
      <div class="empty"><h2>${overview.running ? "Fetching today's news…" : "No notes for this day yet"}</h2>
      <p class="muted">${overview.running ? "This takes a minute or two. The page refreshes by itself." : "News is collected automatically every morning."}</p></div>`;
    return;
  }
  const secs = sections(items);
  const paperCount = PAPER_ORDER.map((p) => ({ label: p, color: PAPER_VAR[p], n: items.filter((i) => (i.papers[0] || "Prelims") === p).length }));
  const must = items.filter((i) => i.importance === "High").slice(0, 8);
  const statics = items.filter((i) => (i.notes?.static || []).length).length;
  view.innerHTML = `
    <div class="hero glance">
      <div class="glance-text">
        <div class="eyebrow">${day === overview.today ? "Today's edition" : "Edition"}</div>
        <h1>${fmtDay(day)}</h1>
        <p>${items.length} UPSC-relevant stories from PIB and The Hindu, sorted into ${secs.length} subjects.</p>
        <div class="hero-actions">
          <a class="btn primary" href="${pdfUrl(day)}" download>⬇ Today's PDF</a>
          <button class="btn" id="aiBtn">✦ AI notes with my key</button>
        </div>
      </div>
      <div class="glance-figs card">
        <div class="fig">${donut(paperCount, items.length, "Stories by GS paper")}
          <div class="fig-legend">${paperCount.filter((p) => p.n).map((p) => `<span><i class="sw" style="background:var(${p.color})"></i>${p.label} <b>${p.n}</b></span>`).join("")}</div></div>
        <div class="fig-imp"><div class="lbl">Importance</div>${impBar(items)}
          <div class="mini-stats"><span>📝 <b>${items.filter((i) => i.stage !== "Mains").length}</b> Prelims</span><span>✍️ <b>${items.filter((i) => i.stage !== "Prelims").length}</b> Mains</span><span>🧱 <b>${statics}</b> static links</span></div></div>
      </div>
    </div>
    ${weekBanner()}
    ${must.length ? `<h2 class="row-h">🔥 Must read today</h2>
    <div class="must">${must.map((i) => { const s = i.topics[0] || "Other"; const p = (SUBJECT_META[s] || [0, i.papers[0] || "Prelims"])[1];
      return `<a class="must-tile p-${p}" href="#/subject/${day}/${encodeURIComponent(s)}/${i.id}"><span class="mt-icon">${subjIcon(s)}</span><span class="mt-sub">${esc(s)}</span><b>${esc(i.title)}</b><span class="mt-src">${esc(i.source)}</span></a>`; }).join("")}</div>` : ""}
    <h2 class="row-h">📚 Learn by subject</h2>
    <div class="tiles">${secs.map((s) => `
      <a class="tile p-${s.paper}" href="#/subject/${day}/${encodeURIComponent(s.subject)}">
        <span class="t-icon">${subjIcon(s.subject)}</span>
        <span class="t-paper">${s.paper}</span>
        <span class="t-name">${esc(s.subject)}</span>
        <span class="t-count"><b>${s.items.length}</b> ${s.items.length > 1 ? "stories" : "story"}</span>
        ${s.high ? `<span class="t-hot">🔥 ${s.high} high</span>` : ""}
        <span class="t-peek">${esc(s.items[0].title)}</span>
      </a>`).join("")}</div>`;
  $("#aiBtn").onclick = () => runAiNotes(day);
}

async function viewSubject(day, subject, focusId) {
  await loadOverview();
  subject = decodeURIComponent(subject || "");
  const data = await api(`/api/day/${day}`);
  const sec = sections(data.items).find((s) => s.subject === subject);
  $("#crumb").textContent = subject;
  if (!sec) { view.innerHTML = `<div class="empty"><p class="muted">Nothing here.</p></div>`; return; }
  const all = sections(data.items);
  const idx = all.findIndex((s) => s.subject === subject);
  const prev = all[idx - 1], next = all[idx + 1];
  const full = sec.items.filter((i) => i.importance !== "Low"), low = sec.items.filter((i) => i.importance === "Low");
  view.innerHTML = `
    <div class="subj-hero p-${sec.paper}">
      <a class="back" href="#/day/${day}">← ${fmtDay(day, { day: "numeric", month: "short" })}</a>
      <div class="sh-row"><span class="sh-icon">${subjIcon(subject)}</span>
        <div><div class="eyebrow">${sec.paper} · ${esc(PAPER_NAME[sec.paper] || "")}</div><h1>${esc(subject)}</h1>
        <p>${sec.items.length} ${sec.items.length > 1 ? "stories" : "story"}${sec.high ? ` · ${sec.high} high importance` : ""}</p></div></div>
    </div>
    <div class="cards">${full.map((i) => itemCard(i)).join("")}</div>
    ${low.length ? `<div class="also"><div class="lbl">Also in the news</div><ul>${low.map(briefRow).join("")}</ul></div>` : ""}
    <div class="pager">${prev ? `<a class="btn" href="#/subject/${day}/${encodeURIComponent(prev.subject)}">← ${subjIcon(prev.subject)} ${esc(prev.subject)}</a>` : "<span></span>"}
      ${next ? `<a class="btn primary" href="#/subject/${day}/${encodeURIComponent(next.subject)}">${subjIcon(next.subject)} ${esc(next.subject)} →</a>` : ""}</div>`;
  if (focusId) setTimeout(() => document.querySelector(`.card[data-id="${focusId}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
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
  const ws = overview.weeks || [];
  view.innerHTML = `<div class="hero"><div><h1>PDF Archive</h1><p>${runs.length} daily PDFs, ${ws.length ? `${ws.length} weekly reports, ` : ""}${overview.total_items} notes in total.</p></div></div>
    ${ws.length ? `<h2 class="row-h">📅 Weekly reports</h2><div class="doc-grid" style="margin-bottom:22px">${ws.map(weekTile).join("")}</div><h2 class="row-h">🗓️ Daily PDFs</h2>` : ""}
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
