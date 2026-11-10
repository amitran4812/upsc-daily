// Username sync (Firebase Firestore, no Google sign-in, no password).
// Saved items, quiz scores and My documents notes are stored under users/{username} and shared by every device that
// uses the same username. AI keys stay on each device. Anyone who knows a username can see that
// user's saved items and scores; that is acceptable for this internal study app.
(() => {
  const cfg = window.FIREBASE_CONFIG;
  const SYNCED = ["bookmarks", "quiz_best", "docs", "docs_deleted"];
  const listeners = new Set();
  const lsGet = (k, d) => { try { const v = localStorage.getItem("upsc:" + k); return v ? JSON.parse(v) : d; } catch { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem("upsc:" + k, JSON.stringify(v)); } catch {} };
  const state = { enabled: !!cfg, ready: !cfg, user: null, error: null };
  const notify = () => listeners.forEach((f) => { try { f(state); } catch {} });
  let db = null, unsub = null, pushTimer = null, applying = false, sdk = null;

  const clean = (u) => String(u || "").trim().toLowerCase().replace(/[^a-z0-9._-]/g, "").slice(0, 40);
  const load = (src) => new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); });

  function merge(remote) {
    applying = true;
    lsSet("bookmarks", [...new Set([...(lsGet("bookmarks", [])), ...(remote.bookmarks || [])])]);
    const best = lsGet("quiz_best", {});
    for (const [m, v] of Object.entries(remote.quiz_best || {})) if (!best[m] || best[m].score < v.score) best[m] = v;
    lsSet("quiz_best", best);
    // My documents: notes, summaries and questions (the original files stay on each device)
    const gone = new Set([...(lsGet("docs_deleted", [])), ...(remote.docs_deleted || [])]);
    const docs = new Map();
    for (const d of [...(lsGet("docs", [])), ...(remote.docs || [])]) if (d && d.id && !gone.has(d.id)) docs.set(d.id, d);
    lsSet("docs", [...docs.values()]);
    lsSet("docs_deleted", [...gone].slice(-300));
    applying = false;
  }
  function push() {
    if (!db || !state.user || applying) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => {
      // A Firestore document holds up to 1 MB, so only the newest saved documents are synced if there are very many.
      let docs = lsGet("docs", []).sort((a, b) => (b.added_at || "").localeCompare(a.added_at || ""));
      while (docs.length && JSON.stringify(docs).length > 800000) docs = docs.slice(0, -1);
      const o = { bookmarks: lsGet("bookmarks", []), quiz_best: lsGet("quiz_best", {}), docs, docs_deleted: lsGet("docs_deleted", []).slice(-300), updated_at: new Date().toISOString() };
      db.collection("users").doc(state.user).set(o, { merge: true }).catch((e) => { state.error = "Could not sync: " + e.message; notify(); });
    }, 800);
  }
  async function ensureSdk() {
    if (sdk) return sdk;
    const v = "10.12.2", base = `https://www.gstatic.com/firebasejs/${v}`;
    sdk = (async () => {
      await load(`${base}/firebase-app-compat.js`);
      await load(`${base}/firebase-firestore-compat.js`);
      firebase.initializeApp(cfg);
      db = firebase.firestore();
    })();
    return sdk;
  }
  async function connect(name) {
    if (unsub) { unsub(); unsub = null; }
    state.user = name; state.error = null;
    try {
      await ensureSdk();
      const ref = db.collection("users").doc(name);
      const snap = await ref.get();
      if (snap.exists) merge(snap.data());
      push();
      unsub = ref.onSnapshot((s) => { if (s.exists && !s.metadata.hasPendingWrites) { merge(s.data()); window.dispatchEvent(new Event("upsc-synced")); } });
    } catch (e) { state.error = "Sync is offline right now; your data is kept on this device."; }
    state.ready = true; notify(); window.dispatchEvent(new Event("upsc-synced"));
  }

  window.SYNC = {
    state, push, SYNCED,
    onChange(f) { listeners.add(f); f(state); },
    async signIn(username) {
      const name = clean(username);
      if (name.length < 3) throw new Error("Use at least 3 letters or numbers");
      lsSet("username", name);
      await connect(name);
    },
    async signOut() { if (unsub) { unsub(); unsub = null; } lsSet("username", null); state.user = null; notify(); },
  };
  if (cfg) {
    const saved = lsGet("username", null);
    if (saved) connect(saved); else { state.ready = true; notify(); }
  }
})();
