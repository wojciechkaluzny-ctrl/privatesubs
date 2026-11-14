// Isolated-world content script: receives the caption track captured by hook.js,
// translates it chunk by chunk (starting from where you are in the video),
// caches results, draws translated subtitles over the player and adds a
// language button ("PL", "EN", "DE"…) to the player controls that switches
// translation per video.
(() => {
  if (window.__ytplContent) return;
  window.__ytplContent = true;

  const P = YTPL_parse;
  let settings = Object.assign({}, YTPL_DEFAULTS);

  const S = {
    track: null,        // { key, videoId, lang, kind, cues, chunks }
    tr: [],             // translations, aligned with track.cues
    session: 0,         // bumps on every new track → stale results are ignored
    running: false,
    status: "idle",     // idle | translating | done | error
    error: null,
    lastVid: null,
    on: false,          // is translation switched on for the current video?
    ccClickedFor: null
  };

  // ---------- settings ----------
  chrome.storage.local.get("settings").then((r) => applySettings(r.settings));
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area === "local" && ch.settings) applySettings(ch.settings.newValue);
  });

  let uiLoadedFor = null;
  function applySettings(next) {
    const old = settings;
    settings = Object.assign({}, YTPL_DEFAULTS, next || {});
    if (settings.uiLang !== uiLoadedFor) {
      uiLoadedFor = settings.uiLang;
      ytplLoadUi(settings).then(() => { lastShown = null; updateButton(); });
    }
    applyStyle();
    updateButton();
    if (ytplTargetLang(old) !== ytplTargetLang(settings) || !!old.hideSoundTags !== !!settings.hideSoundTags) {
      // new target language / sound-tag filter: re-evaluate the last caption track from scratch
      stopTrack();
      lastShown = null;
      if (S.lastRaw) onCaptions(S.lastRaw.url, S.lastRaw.text);
      return;
    }
    if (!S.track) return;
    if (old.model !== settings.model || old.ollamaUrl !== settings.ollamaUrl || old.chunkSize !== settings.chunkSize) {
      startTrack(S.track); // re-translate with the new model
    } else if (settings.enabled && !old.enabled) {
      kick();
    }
  }

  // ---------- helpers ----------
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function currentVideoId() {
    const u = new URL(location.href);
    if (u.pathname === "/watch") return u.searchParams.get("v");
    const m = u.pathname.match(/^\/(?:embed|live)\/([\w-]{6,})/);
    return m ? m[1] : null;
  }

  const tgt = () => ytplTargetLang(settings);           // e.g. "pl"
  const label = () => tgt().toUpperCase();              // e.g. "PL" – shown on the button
  const isTarget = (code) => !!code && ytplBase(code) === tgt();

  // ---------- per-video on/off memory ----------
  const PREFS_KEY = "videoPrefs";
  async function loadVideoPref(vid) {
    try {
      const r = await chrome.storage.local.get(PREFS_KEY);
      const p = r[PREFS_KEY] || {};
      return vid in p ? !!p[vid] : null;
    } catch (_) { return null; }
  }
  async function saveVideoPref(vid, on) {
    try {
      const r = await chrome.storage.local.get(PREFS_KEY);
      const p = r[PREFS_KEY] || {};
      delete p[vid];
      p[vid] = on;
      const keys = Object.keys(p);
      for (const k of keys.slice(0, Math.max(0, keys.length - 500))) delete p[k];
      await chrome.storage.local.set({ [PREFS_KEY]: p });
    } catch (_) {}
  }

  // ---------- captions from hook.js ----------
  window.addEventListener("message", (e) => {
    if (e.source !== window || !e.data || e.data.__ytpl !== "captions") return;
    onCaptions(e.data.url, e.data.text);
  });
  window.postMessage({ __ytpl: "replay" }, "*");

  // The track is kept even when translation is off, so clicking PL later starts instantly.
  function onCaptions(url, text) {
    const vid = currentVideoId();
    if (!vid) return;
    let parsed;
    try { parsed = P.parseCaptions(text, url, { stripSoundTags: !!settings.hideSoundTags }); } catch (_) { return; }
    if (!parsed.cues.length) return;
    if (parsed.videoId && parsed.videoId !== vid) return; // e.g. hover preview of another video
    S.lastRaw = { url, text };

    // Already in the target language (original track or YouTube's own auto-translate) – let YouTube show it.
    if (isTarget(parsed.tlang) || (!parsed.tlang && isTarget(parsed.lang))) { stopTrack(); return; }

    const key = [vid, parsed.lang, parsed.kind, parsed.tlang || "", tgt(), settings.hideSoundTags ? "nt" : "t"].join("|");
    if (S.track && S.track.key === key) return;
    startTrack({
      key, videoId: vid,
      lang: parsed.tlang || parsed.lang || "en",
      tgt: tgt(),
      kind: parsed.kind,
      cues: parsed.cues
    });
  }

  function stopTrack() {
    S.session++;
    S.track = null;
    S.tr = [];
    S.status = "idle";
    S.error = null;
    S.running = false;
  }

  async function startTrack(t) {
    const session = ++S.session;
    t.chunks = P.makeChunks(t.cues, Math.max(5, +settings.chunkSize || 30));
    S.track = t;
    S.tr = new Array(t.cues.length).fill(null);
    S.status = "idle";
    S.error = null;
    S.running = false;

    const cached = await loadCache(t);
    if (session !== S.session) return;
    if (cached) S.tr = cached;
    kick();
  }

  // Start / resume the queue if translation is wanted right now.
  function kick() {
    if (S.track && S.on && settings.enabled && !S.running) runQueue(S.session);
  }

  // ---------- cache ----------
  const cacheKey = (t) => `c:${t.videoId}:${t.lang}:${t.kind || "std"}:${t.tgt}`;

  async function loadCache(t) {
    try {
      const k = cacheKey(t);
      const r = await chrome.storage.local.get(k);
      const c = r[k];
      if (c && c.model === settings.model && c.n === t.cues.length && Array.isArray(c.tr)) return c.tr;
    } catch (_) {}
    return null;
  }

  // Called once per translated chunk, so writing straight away is cheap.
  function saveCache() {
    const t = S.track;
    if (!t) return;
    chrome.storage.local
      .set({ [cacheKey(t)]: { model: settings.model, n: t.cues.length, tr: S.tr.slice(), ts: Date.now() } })
      .catch(() => {});
  }

  // ---------- translation queue ----------
  function pickChunk() {
    const t = S.track;
    const v = getVideo();
    const now = v ? v.currentTime * 1000 : 0;
    const idx = P.cueBefore(t.cues, now);
    const todo = (c) => S.tr.slice(c.a, c.b).some((x) => x == null);
    // first: the chunk you are watching now and the ones after it
    for (const c of t.chunks) if (c.b > idx && todo(c)) return c;
    // then: whatever is left earlier in the video
    for (const c of t.chunks) if (todo(c)) return c;
    return null;
  }

  async function runQueue(session) {
    if (S.running) return;
    S.running = true;
    let failures = 0;
    try {
      while (session === S.session && S.track) {
        if (!settings.enabled || !S.on) { if (S.status === "translating") S.status = "idle"; return; }
        const c = pickChunk();
        if (!c) { S.status = "done"; return; }
        S.status = "translating";
        const t = S.track;
        try {
          const res = await chrome.runtime.sendMessage({
            type: "translate",
            lines: t.cues.slice(c.a, c.b).map((x) => x.text),
            context: t.cues.slice(Math.max(0, c.a - 3), c.a).map((x) => x.text),
            srcLang: t.lang,
            tgtLang: t.tgt
          });
          if (session !== S.session) return;
          if (!res || !res.ok) throw new Error((res && res.error) || ytplT("errNoResponse"));
          for (let k = 0; k < res.lines.length && c.a + k < c.b; k++) S.tr[c.a + k] = res.lines[k] || t.cues[c.a + k].text;
          S.error = null;
          failures = 0;
          saveCache();
        } catch (e) {
          if (session !== S.session) return;
          S.error = /context invalidated/i.test(e.message) ? ytplT("errReloaded") : e.message;
          if (++failures >= 3) { S.status = "error"; return; }
          await sleep(3000 * failures);
        }
      }
    } finally {
      if (session === S.session) S.running = false;
    }
  }

  // ---------- player / overlay ----------
  let player = null, video = null, overlay = null, lineEl = null, origEl = null, badge = null, ro = null;

  function getPlayer() {
    if (player && player.isConnected) return player;
    player = document.querySelector("#movie_player") || document.querySelector(".html5-video-player");
    return player;
  }
  function getVideo() {
    if (video && video.isConnected) return video;
    const p = getPlayer();
    video = p && (p.querySelector("video.html5-main-video") || p.querySelector("video"));
    return video;
  }

  function ensureOverlay() {
    const p = getPlayer();
    if (!p) return null;
    if (overlay && overlay.parentNode === p) return overlay;
    overlay = document.createElement("div");
    overlay.className = "ytpl-overlay";
    lineEl = document.createElement("span");
    lineEl.className = "ytpl-line";
    origEl = document.createElement("span");
    origEl.className = "ytpl-orig";
    overlay.append(lineEl, origEl);
    badge = document.createElement("div");
    badge.className = "ytpl-badge";
    p.append(overlay, badge);
    if (ro) ro.disconnect();
    ro = new ResizeObserver(applyStyle);
    ro.observe(p);
    applyStyle();
    return overlay;
  }

  function applyStyle() {
    const p = getPlayer();
    if (!p || !overlay) return;
    const px = Math.max(13, p.clientHeight * 0.042 * (+settings.fontScale || 1));
    overlay.style.fontSize = px.toFixed(1) + "px";
  }

  function ccButton() {
    const p = getPlayer();
    return p && p.querySelector(".ytp-subtitles-button");
  }
  function ccIsOn() {
    const b = ccButton();
    return !b || b.getAttribute("aria-pressed") !== "false";
  }

  // Short message in the top-left corner of the player.
  let toastTimer = null, toastMsg = "";
  function toast(msg, ms = 3500) {
    toastMsg = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastMsg = ""; }, ms);
  }

  let lastShown = null;
  function setText(main, orig, pending) {
    const key = main + "\u0000" + orig + pending;
    if (key === lastShown) return;
    lastShown = key;
    lineEl.textContent = main;
    lineEl.classList.toggle("ytpl-pending", !!pending);
    origEl.textContent = orig;
    origEl.style.display = orig ? "" : "none";
  }

  function render() {
    const p = getPlayer();
    if (!p) return;
    const t = S.track;
    const active = !!(t && S.on && settings.enabled && t.videoId === currentVideoId());
    p.classList.toggle("ytpl-on", active && ccIsOn());
    if (!ensureOverlay()) return;

    const showAny = ccIsOn() && !p.classList.contains("ad-showing");
    const v = getVideo();
    const i = active && v && showAny ? P.cueAt(t.cues, v.currentTime * 1000) : -1;
    if (i < 0) {
      overlay.style.display = "none";
    } else {
      // the model may still produce sound tags (or they come from an older cache) – filter on display too
      const tidy = (s) => (settings.hideSoundTags ? P.stripSoundTags(s) : s);
      const tr = S.tr[i] == null ? null : tidy(S.tr[i]);
      const orig = tidy(t.cues[i].text);
      if (tr) setText(tr, settings.showOriginal ? orig : "", false);
      else if (tr == null && orig) setText(orig, "", true); // not translated yet → original, dimmed
      overlay.style.display = tr || (tr == null && orig) ? "block" : "none";
    }

    // status badge
    let msg = toastMsg;
    if (!msg && active && showAny && (S.status === "translating" || S.status === "error")) {
      msg = S.error ? ytplT("badgeError", label(), S.error) : ytplT("badgeTranslating", label(), progressPct());
    }
    badge.textContent = msg;
    badge.classList.toggle("ytpl-err", !!(S.error && !toastMsg) || /⚠/.test(toastMsg));
    badge.style.display = msg ? "block" : "none";
  }

  function progressPct() {
    if (!S.track) return 0;
    const done = S.tr.filter((x) => x != null).length;
    return Math.floor((100 * done) / Math.max(1, S.track.cues.length));
  }

  // ---------- turning translation on/off for the current video ----------
  // The caption track is only downloaded by YouTube when CC is on, so switching
  // PL on also switches YouTube captions on.
  async function ensureCC(vid) {
    for (let k = 0; k < 40; k++) {
      if (currentVideoId() !== vid || !S.on) return;
      const p = getPlayer();
      const b = ccButton();
      const ready = b && b.offsetParent !== null && !p.classList.contains("ad-showing");
      if (ready) {
        if (b.getAttribute("aria-disabled") === "true") { toast(ytplT("toastNoCaptions", label())); return; }
        if (b.getAttribute("aria-pressed") === "false") b.click();
        return;
      }
      await sleep(500);
    }
  }

  function setOn(on, fromUser) {
    const vid = currentVideoId();
    if (!vid) return;
    S.on = on;
    if (fromUser) saveVideoPref(vid, on);
    if (on) {
      if (!settings.enabled) { settings.enabled = true; chrome.storage.local.set({ settings }); }
      ensureCC(vid);
      if (S.track && S.status === "error") startTrack(S.track); // retry after an earlier failure
      else kick();
      if (fromUser && !S.track) toast(ytplT("toastWaiting", label()), 2500);
    }
    lastShown = null;
    updateButton();
  }

  async function onVideoChange(vid) {
    S.on = false;
    S.ccClickedFor = null;
    if (S.lastRaw && !S.lastRaw.url.includes("v=" + vid)) S.lastRaw = null;
    if (S.track && S.track.videoId !== vid) stopTrack();
    lastShown = null;
    if (!vid) return;
    const pref = await loadVideoPref(vid);
    if (currentVideoId() !== vid) return;
    const on = pref == null ? !!settings.autoTranslate : pref;
    if (on) setOn(true, false);
    updateButton();
  }

  // ---------- language button ("PL", "EN"…) in the player controls ----------
  const SVG_NS = "http://www.w3.org/2000/svg";
  let btn = null, btnSvg = null, btnText = null;

  function makeButton() {
    const b = document.createElement("button");
    b.className = "ytp-button ytpl-btn";
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("class", "ytpl-btn-icon");
    const rect = document.createElementNS(SVG_NS, "rect");
    rect.setAttribute("x", "2.5"); rect.setAttribute("y", "5"); rect.setAttribute("width", "19");
    rect.setAttribute("height", "14"); rect.setAttribute("rx", "3.5");
    rect.setAttribute("class", "ytpl-btn-box");
    const text = document.createElementNS(SVG_NS, "text");
    text.setAttribute("x", "12"); text.setAttribute("y", "15.3");
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("class", "ytpl-btn-text");
    btnText = text;
    svg.append(rect, text);
    const bar = document.createElement("span");
    bar.className = "ytpl-btn-bar";
    b.append(svg, bar);
    b.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      setOn(!S.on, true);
      toast(ytplT(S.on ? "toastOn" : "toastOff", label()), 1500);
    });
    btnSvg = svg;
    return b;
  }

  function ensureButton() {
    const p = getPlayer();
    const vid = currentVideoId();
    if (!p || !vid || !settings.enabled) { if (btn) btn.style.display = "none"; return; }
    const sub = p.querySelector(".ytp-subtitles-button");
    const controls = p.querySelector(".ytp-right-controls");
    if (!sub && !controls) return;
    if (!btn) btn = makeButton();
    if (!btn.isConnected || !p.contains(btn)) {
      if (sub && sub.parentNode) sub.parentNode.insertBefore(btn, sub);
      else controls.prepend(btn);
    }
    btn.style.display = "";
    // Match the size of YouTube's own icons (differs between the old and new player UI).
    const ref = sub && sub.querySelector("svg");
    if (ref) {
      const r = ref.getBoundingClientRect();
      if (r.width > 0) {
        const s = Math.round(r.width);
        const big = s >= 36; // old UI: 36-unit icons drawn with built-in padding
        btnSvg.setAttribute("viewBox", big ? "-6 -6 36 36" : "0 0 24 24");
        btnSvg.style.width = s + "px";
        btnSvg.style.height = Math.round(r.height || r.width) + "px";
      }
    }
    updateButton();
  }

  function updateButton() {
    if (!btn) return;
    if (btnText.textContent !== label()) btnText.textContent = label();
    const tip = ytplT(S.on ? "btnTipTurnOff" : "btnTipTurnOn", ytplNativeName(tgt()));
    if (btn.title !== tip) { btn.title = tip; btn.setAttribute("aria-label", tip); }
    btn.classList.toggle("ytpl-btn-on", S.on);
    btn.setAttribute("aria-pressed", S.on ? "true" : "false");
    const working = S.on && S.status === "translating";
    btn.classList.toggle("ytpl-btn-busy", working);
    btn.classList.toggle("ytpl-btn-err", S.on && S.status === "error");
    btn.style.setProperty("--ytpl-pct", progressPct() + "%");
  }

  // ---------- main loop ----------
  let lastBtnCheck = 0;
  function tick(now) {
    const vid = currentVideoId();
    if (vid !== S.lastVid) {
      S.lastVid = vid;
      onVideoChange(vid);
    }
    try { render(); } catch (_) {}
    if (now - lastBtnCheck > 400) {
      lastBtnCheck = now;
      try { ensureButton(); } catch (_) {}
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  // ---------- messages from popup / keyboard shortcut ----------
  chrome.runtime.onMessage.addListener((msg, _s, send) => {
    if (msg.type === "status") {
      const t = S.track;
      send({
        videoId: currentVideoId(),
        on: S.on,
        tgt: tgt(),
        hasTrack: !!t,
        lang: t && t.lang,
        kind: t && t.kind,
        total: t ? t.cues.length : 0,
        done: S.tr.filter((x) => x != null).length,
        status: S.status,
        error: S.error
      });
    } else if (msg.type === "toggleVideo") {
      setOn(!S.on, true);
      toast(ytplT(S.on ? "toastOn" : "toastOff", label()), 1500);
      send({ on: S.on });
    } else if (msg.type === "retry") {
      if (S.track) startTrack(S.track);
      send({ ok: true });
    }
  });
})();
