// Parses a YouTube timedtext response (json3, or XML srv1/srv3) into cues:
// [{ start: ms, end: ms, text }]
(function (root) {
  const MAX_CHARS = 90;      // max length of a regrouped auto-caption line
  const MAX_GAP = 1500;      // pause (ms) that forces a new line
  const LINGER = 2500;       // how long the last line of a block stays visible

  function decodeEntities(s) {
    return s
      .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
      .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
      .replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'")
      .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  }

  const clean = (s) => s.replace(/\s+/g, " ").trim();

  function readParams(url) {
    let p;
    try { p = new URL(url).searchParams; } catch { p = new URLSearchParams(""); }
    return {
      videoId: p.get("v"),
      lang: p.get("lang") || "en",
      tlang: p.get("tlang"),
      kind: p.get("kind") || ""
    };
  }

  // Auto-generated (ASR) captions come word by word in rolling windows.
  // Rebuild them into readable lines ending at sentence boundaries.
  function regroupWords(events) {
    const words = [];
    for (const ev of events) {
      if (!ev.segs) continue;
      for (const seg of ev.segs) {
        const t = seg.utf8;
        if (!t || t === "\n" || !t.trim()) continue;
        words.push({ t: (ev.tStartMs || 0) + (seg.tOffsetMs || 0), text: t.replace(/\n/g, " ") });
      }
    }
    words.sort((a, b) => a.t - b.t);

    const cues = [];
    let cur = null;
    const flush = () => { if (cur && clean(cur.text)) cues.push({ start: cur.start, last: cur.last, text: clean(cur.text) }); cur = null; };

    for (const w of words) {
      if (cur && (w.t - cur.last > MAX_GAP || (cur.text + w.text).length > MAX_CHARS)) flush();
      if (!cur) cur = { start: w.t, last: w.t, text: "" };
      cur.text += (cur.text && !/^\s/.test(w.text) ? " " : "") + w.text;
      cur.last = w.t;
      if (/[.?!…]["')\]]?\s*$/.test(w.text) && clean(cur.text).split(" ").length >= 3) flush();
    }
    flush();

    for (let i = 0; i < cues.length; i++) {
      const next = cues[i + 1];
      const cap = cues[i].last + LINGER;
      cues[i].end = next ? Math.min(next.start, Math.max(cap, cues[i].last + 600)) : cap;
      delete cues[i].last;
    }
    return cues;
  }

  function fromJson3(data, isAsr) {
    const events = (data && data.events) || [];
    if (isAsr) return regroupWords(events);
    const cues = [];
    for (const ev of events) {
      if (!ev.segs) continue;
      const text = clean(ev.segs.map((s) => s.utf8 || "").join(""));
      if (!text) continue;
      const start = ev.tStartMs || 0;
      cues.push({ start, end: start + (ev.dDurationMs || 2000), text });
    }
    return cues;
  }

  function fromXml(xml) {
    const cues = [];
    // srv3: <p t="1234" d="2000">text <s>..</s></p>
    const reP = /<p\b([^>]*)>([\s\S]*?)<\/p>/g;
    // srv1: <text start="1.23" dur="2.0">text</text>
    const reT = /<text\b([^>]*)>([\s\S]*?)<\/text>/g;
    const attr = (a, n) => { const m = a.match(new RegExp("\\b" + n + "=\"([^\"]*)\"")); return m ? m[1] : null; };
    let m;
    while ((m = reP.exec(xml))) {
      const t = +attr(m[1], "t"), d = +(attr(m[1], "d") || 2000);
      const text = clean(decodeEntities(m[2].replace(/<[^>]+>/g, "")));
      if (text) cues.push({ start: t, end: t + d, text });
    }
    if (!cues.length) {
      while ((m = reT.exec(xml))) {
        const s = parseFloat(attr(m[1], "start")) * 1000, d = parseFloat(attr(m[1], "dur") || "2") * 1000;
        const text = clean(decodeEntities(decodeEntities(m[2].replace(/<[^>]+>/g, ""))));
        if (text) cues.push({ start: s, end: s + d, text });
      }
    }
    return cues;
  }

  function parseCaptions(text, url) {
    const info = readParams(url);
    const isAsr = info.kind === "asr";
    const body = String(text || "").trim();
    let cues = [];
    if (body.startsWith("{")) cues = fromJson3(JSON.parse(body), isAsr);
    else if (body.startsWith("<")) cues = fromXml(body);
    cues.sort((a, b) => a.start - b.start);
    return Object.assign(info, { cues });
  }

  // Index of the cue shown at time t (ms), or -1.
  function cueAt(cues, t) {
    let lo = 0, hi = cues.length - 1, best = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (cues[mid].start <= t) { best = mid; lo = mid + 1; } else hi = mid - 1;
    }
    if (best >= 0 && t < cues[best].end) return best;
    return -1;
  }

  // Last cue that started at or before t (for picking which chunk to translate first).
  function cueBefore(cues, t) {
    let lo = 0, hi = cues.length - 1, best = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (cues[mid].start <= t) { best = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return best;
  }

  // Split cues into chunks of ~size lines, preferably ending on a sentence end.
  function makeChunks(cues, size) {
    const chunks = [];
    let a = 0;
    while (a < cues.length) {
      let b = Math.min(a + size, cues.length);
      if (b < cues.length) {
        for (let k = b; k > a + Math.floor(size / 2); k--) {
          if (/[.?!…]["')\]]?$/.test(cues[k - 1].text)) { b = k; break; }
        }
      }
      chunks.push({ a, b });
      a = b;
    }
    return chunks;
  }

  root.YTPL_parse = { parseCaptions, cueAt, cueBefore, makeChunks };
})(typeof globalThis !== "undefined" ? globalThis : this);
