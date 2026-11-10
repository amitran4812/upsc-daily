// Google sign-in + sync (Firebase). Syncs saved items, quiz scores and AI settings between
// devices for the same Google account. Each user can read/write only users/{their uid}.
(() => {
  const cfg = window.FIREBASE_CONFIG;
  const SYNCED = ["bookmarks", "quiz_best", "settings"];
  const listeners = new Set();
  const state = { enabled: !!cfg, ready: false, user: null, error: null };
  const notify = () => listeners.forEach((f) => { try { f(state); } catch {} });
  let db = null, auth = null, unsub = null, pushTimer = null, applying = false;

  const lsGet = (k, d) => { try { const v = localStorage.getItem("upsc:" + k); return v ? JSON.parse(v) : d; } catch { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem("upsc:" + k, JSON.stringify(v)); } catch {} };

  function load(src) {
    return new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
  }
  function merge(remote) {
    applying = true;
    const marks = new Set([...(lsGet("bookmarks", [])), ...(remote.bookmarks || [])]);
    lsSet("bookmarks", [...marks]);
    const best = lsGet("quiz_best", {});
    for (const [m, v] of Object.entries(remote.quiz_best || {})) if (!best[m] || best[m].score < v.score) best[m] = v;
    lsSet("quiz_best", best);
    if (remote.settings && Object.keys(remote.settings).length) lsSet("settings", { ...lsGet("settings", {}), ...remote.settings });
    applying = false;
  }
  function payload() {
    const o = {}; SYNCED.forEach((k) => (o[k] = lsGet(k, k === "bookmarks" ? [] : {})));
    o.updated_at = new Date().toISOString(); return o;
  }
  function push() {
    if (!db || !state.user || applying) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => db.collection("users").doc(state.user.uid).set(payload(), { merge: true }).catch((e) => { state.error = e.message; notify(); }), 800);
  }

  async function init() {
    if (!cfg) return;
    try {
      const v = "10.12.2", base = `https://www.gstatic.com/firebasejs/${v}`;
      await load(`${base}/firebase-app-compat.js`);
      await Promise.all([load(`${base}/firebase-auth-compat.js`), load(`${base}/firebase-firestore-compat.js`)]);
      firebase.initializeApp(cfg);
      auth = firebase.auth(); db = firebase.firestore();
      auth.onAuthStateChanged(async (u) => {
        state.user = u ? { uid: u.uid, name: u.displayName, email: u.email, photo: u.photoURL } : null;
        if (unsub) { unsub(); unsub = null; }
        if (u) {
          const ref = db.collection("users").doc(u.uid);
          const snap = await ref.get().catch(() => null);
          if (snap?.exists) merge(snap.data());
          push();
          unsub = ref.onSnapshot((s) => { if (s.exists && !s.metadata.hasPendingWrites) { merge(s.data()); window.dispatchEvent(new Event("upsc-synced")); } });
        }
        state.ready = true; notify(); window.dispatchEvent(new Event("upsc-synced"));
      });
    } catch (e) { state.error = "Sync unavailable (offline?)"; state.ready = true; notify(); }
  }

  window.SYNC = {
    state, push, SYNCED,
    onChange(f) { listeners.add(f); f(state); },
    async signIn() {
      if (!auth) throw new Error("Sync is not set up yet");
      const p = new firebase.auth.GoogleAuthProvider();
      await auth.signInWithPopup(p);
    },
    async signOut() { if (auth) await auth.signOut(); },
  };
  init();
})();
