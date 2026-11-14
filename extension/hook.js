// Runs in the PAGE (MAIN world). YouTube's timedtext endpoint now needs a
// player-generated proof-of-origin token (pot), so instead of fetching captions
// ourselves we capture the response the YouTube player itself downloads.
// The player fetches the WHOLE caption track in one request, so we get the
// full subtitles of the video up front.
(() => {
  if (window.__ytplHooked) return;
  window.__ytplHooked = true;

  const captured = new Set();
  const recent = [];
  const isTT = (u) => typeof u === "string" && u.includes("/api/timedtext");
  const abs = (u) => { try { return new URL(u, location.href).href; } catch { return String(u); } };

  function post(url, text) {
    if (!text || text.length < 20) return; // empty body = request without valid pot
    const full = abs(url);
    captured.add(full);
    recent.push({ url: full, text });
    if (recent.length > 4) recent.shift();
    window.postMessage({ __ytpl: "captions", url: full, text }, "*");
  }

  // fetch()
  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    const p = origFetch.apply(this, arguments);
    try {
      const url = typeof input === "string" ? input : (input && input.url) || String(input);
      if (isTT(url)) p.then((r) => r.clone().text()).then((t) => post(url, t)).catch(() => {});
    } catch (_) {}
    return p;
  };

  // XMLHttpRequest
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    try { this.__ytplUrl = String(url); } catch (_) {}
    return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function () {
    if (isTT(this.__ytplUrl)) {
      this.addEventListener("load", () => {
        try {
          let t = null;
          if (this.responseType === "" || this.responseType === "text") t = this.responseText;
          else if (this.responseType === "arraybuffer") t = new TextDecoder().decode(this.response);
          else if (this.responseType === "json") t = JSON.stringify(this.response);
          post(this.__ytplUrl, t);
        } catch (_) {}
      });
    }
    return origSend.apply(this, arguments);
  };

  // Fallback: if the player used a path we did not hook, re-fetch the exact URL
  // (it already contains the pot token) from the page context.
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (!isTT(e.name)) continue;
        setTimeout(() => {
          if (captured.has(abs(e.name))) return;
          origFetch(e.name, { credentials: "include" })
            .then((r) => r.text()).then((t) => post(e.name, t)).catch(() => {});
        }, 1500);
      }
    }).observe({ type: "resource", buffered: true });
  } catch (_) {}

  // The content script may start after captions were already loaded.
  window.addEventListener("message", (e) => {
    if (e.source === window && e.data && e.data.__ytpl === "replay") {
      for (const r of recent) window.postMessage({ __ytpl: "captions", url: r.url, text: r.text }, "*");
    }
  });
})();
