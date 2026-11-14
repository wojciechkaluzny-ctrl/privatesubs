// Unit tests: caption parsing, translation alignment (Ollama mocked), locale files.
// Run: node tests/unit.test.js [path-to-extension]
const assert = require("assert");
const path = require("path");
const fs = require("fs");
const vm = require("vm");
const EXT = path.resolve(process.argv[2] || path.join(__dirname, "..", "extension"));
// defaults.js declares globals with `var` – evaluate it in the global scope like a browser would
vm.runInThisContext(fs.readFileSync(path.join(EXT, "defaults.js"), "utf8"));
require(path.join(EXT, "parse.js"));
require(path.join(EXT, "translator.js"));
const P = globalThis.YTPL_parse, T = globalThis.YTPL_translator;

// chrome.i18n stub backed by the real English locale file
const LOCALES = {};
for (const l of ["en", "pl"]) LOCALES[l] = JSON.parse(fs.readFileSync(path.join(EXT, "_locales", l, "messages.json"), "utf8"));
globalThis.chrome = { i18n: {
  getUILanguage: () => "en",
  getMessage(key, subs) {
    const m = LOCALES.en[key];
    if (!m) return "";
    return m.message.replace(/\$(\w+)\$/g, (_, name) => {
      const ph = m.placeholders && m.placeholders[name.toLowerCase()];
      const n = ph ? +ph.content.slice(1) : 0;
      return n ? String((subs || [])[n - 1]) : "";
    });
  }
} };

(async () => {
  // --- manual captions json3
  const manual = { events: [
    { tStartMs: 0, dDurationMs: 2000, segs: [{ utf8: "Hello there." }] },
    { tStartMs: 2000, dDurationMs: 1500, segs: [{ utf8: "How are\nyou?" }] },
    { tStartMs: 4000, dDurationMs: 100, wWinId: 1 }
  ] };
  let r = P.parseCaptions(JSON.stringify(manual), "https://www.youtube.com/api/timedtext?v=abc123def45&lang=en&fmt=json3&pot=xyz&c=WEB");
  assert.equal(r.videoId, "abc123def45");
  assert.equal(r.cues.length, 2);
  assert.equal(r.cues[1].text, "How are you?");
  assert.equal(P.cueAt(r.cues, 2500), 1);
  assert.equal(P.cueAt(r.cues, 3600), -1);

  // --- ASR json3 (rolling word windows)
  const asr = { events: [
    { tStartMs: 0, dDurationMs: 5000, wWinId: 1, segs: [{ utf8: "so" }, { utf8: " today", tOffsetMs: 300 }, { utf8: " we", tOffsetMs: 600 }, { utf8: " cook.", tOffsetMs: 900 }] },
    { tStartMs: 1200, dDurationMs: 10, aAppend: 1, segs: [{ utf8: "\n" }] },
    { tStartMs: 1300, dDurationMs: 4000, wWinId: 1, segs: [{ utf8: "first" }, { utf8: " the", tOffsetMs: 200 }, { utf8: " onions", tOffsetMs: 400 }] },
    { tStartMs: 5000, dDurationMs: 2000, wWinId: 1, segs: [{ utf8: "then" }, { utf8: " garlic", tOffsetMs: 300 }] }
  ] };
  r = P.parseCaptions(JSON.stringify(asr), "https://www.youtube.com/api/timedtext?v=x&lang=en&kind=asr&fmt=json3");
  assert.deepEqual(r.cues.map((c) => c.text), ["so today we cook.", "first the onions", "then garlic"]);
  assert.ok(r.cues[0].end <= r.cues[1].start, "no overlap");
  assert.ok(r.cues[1].end > 1700);

  // --- XML srv3 + srv1
  r = P.parseCaptions('<?xml version="1.0"?><timedtext><body><p t="100" d="900">Tom &amp; Jerry</p><p t="1000" d="500"><s>Hi</s><s> you</s></p></body></timedtext>', "https://x/api/timedtext?v=a");
  assert.deepEqual(r.cues.map((c) => c.text), ["Tom & Jerry", "Hi you"]);
  r = P.parseCaptions('<transcript><text start="1.5" dur="2">It&amp;#39;s fine</text></transcript>', "https://x/api/timedtext?v=a");
  assert.equal(r.cues[0].text, "It's fine");
  assert.equal(r.cues[0].start, 1500);

  // --- chunks prefer sentence ends
  const cues = Array.from({ length: 25 }, (_, i) => ({ start: i * 1000, end: i * 1000 + 900, text: i === 7 ? "end." : "word" }));
  const ch = P.makeChunks(cues, 10);
  assert.deepEqual(ch[0], { a: 0, b: 8 });
  assert.equal(ch[ch.length - 1].b, 25);

  // --- translator: JSON mode with mismatching model output → split & realign
  let calls = 0;
  globalThis.fetch = async (url, opts) => {
    calls++;
    const body = JSON.parse(opts.body);
    assert.ok(url.endsWith("/api/chat"));
    const input = JSON.parse(body.messages[1].content).lines;
    assert.equal(body.format.properties.lines.minItems, input.length);
    // simulate a model that merges lines when given more than 2
    const out = input.length > 2 ? [input.join(" ").toUpperCase()] : input.map((l) => "PL:" + l);
    return { ok: true, status: 200, json: async () => ({ message: { content: JSON.stringify({ lines: out }) } }) };
  };
  const s = Object.assign({}, YTPL_DEFAULTS, { model: "gemma3:4b" });
  const lines = ["a", "b", "c", "d", "e"];
  const out = await T.translateLines(s, lines, [], "en");
  assert.deepEqual(out, ["PL:a", "PL:b", "PL:c", "PL:d", "PL:e"]);
  console.log("json realign calls:", calls);

  // --- translator: TranslateGemma newline mode
  globalThis.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    assert.equal(body.format, undefined);
    const content = body.messages[0].content;
    assert.ok(content.includes("English (en) to Polish (pl)"));
    const src = content.split("\n\n\n")[1].split("\n");
    return { ok: true, status: 200, json: async () => ({ message: { content: src.map((l) => "pl " + l).join("\n") + "\n" } }) };
  };
  const out2 = await T.translateLines(Object.assign({}, s, { model: "translategemma:4b", targetLang: "pl" }), ["x", "y"], [], "en-US");
  assert.deepEqual(out2, ["pl x", "pl y"]);

  // --- other target languages
  globalThis.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    const content = body.messages[0].content;
    assert.ok(content.includes("Spanish (es) to German (de) translator"), content.slice(0, 80));
    assert.ok(content.includes("into German:"));
    return { ok: true, status: 200, json: async () => ({ message: { content: "de 1\nde 2" } }) };
  };
  assert.deepEqual(await T.translateLines(Object.assign({}, s, { model: "translategemma:12b" }), ["a", "b"], [], "es", "de"), ["de 1", "de 2"]);
  globalThis.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    assert.ok(body.messages[0].content.includes("colloquial Japanese"));
    return { ok: true, status: 200, json: async () => ({ message: { content: JSON.stringify({ lines: ["ja"] }) } }) };
  };
  assert.deepEqual(await T.translateLines(Object.assign({}, s, { targetLang: "ja" }), ["a"], [], "en"), ["ja"]);
  assert.equal(ytplTargetLang({ targetLang: "xx" }), ytplBrowserLang());
  assert.equal(ytplNativeName("pt-BR"), "Português");

  // --- error messages
  globalThis.fetch = async () => { throw new TypeError("Failed to fetch"); };
  await assert.rejects(T.translateLines(s, ["x"], [], "en"), /Cannot connect to Ollama at http:\/\/127\.0\.0\.1:11434/);
  globalThis.fetch = async () => ({ ok: false, status: 404, text: async () => '{"error":"model \\"gemma3:4b\\" not found, try pulling it first"}' });
  await assert.rejects(T.translateLines(s, ["x"], [], "en"), /ollama pull gemma3:4b/);
  globalThis.fetch = async () => ({ ok: false, status: 403, text: async () => "" });
  await assert.rejects(T.translateLines(s, ["x"], [], "en"), /OLLAMA_ORIGINS/);

  // --- locales: same keys and placeholders in every language; every key used in code exists
  const en = LOCALES.en;
  for (const [lang, msgs] of Object.entries(LOCALES)) {
    assert.deepEqual(Object.keys(msgs).sort(), Object.keys(en).sort(), `${lang}: key set differs from en`);
    for (const k of Object.keys(en)) {
      assert.deepEqual(Object.keys(msgs[k].placeholders || {}).sort(), Object.keys(en[k].placeholders || {}).sort(), `${lang}.${k}: placeholders differ`);
    }
  }
  const used = new Set();
  for (const f of fs.readdirSync(EXT)) {
    if (!/\.(js|html|json)$/.test(f)) continue;
    const src = fs.readFileSync(path.join(EXT, f), "utf8");
    for (const m of src.matchAll(/ytplT\(\s*"(\w+)"/g)) used.add(m[1]);
    for (const m of src.matchAll(/ytplT\([^)]*?\?\s*"(\w+)"\s*:\s*"(\w+)"/g)) { used.add(m[1]); used.add(m[2]); }
    for (const m of src.matchAll(/data-i18n(?:-title)?="(\w+)"/g)) used.add(m[1]);
    for (const m of src.matchAll(/__MSG_(\w+)__/g)) used.add(m[1]);
  }
  for (const k of used) assert.ok(en[k], `missing locale key: ${k}`);
  const unused = Object.keys(en).filter((k) => !used.has(k));
  console.log(`locales ok: ${Object.keys(en).length} keys, ${used.size} referenced` + (unused.length ? `, unused: ${unused.join(", ")}` : ""));

  // --- interface language override: list matches _locales, formatting of a loaded dictionary
  assert.deepEqual(Object.keys(YTPL_UI_LANGS).sort(), fs.readdirSync(path.join(EXT, "_locales")).sort());
  YTPL_UI_DICT = LOCALES.pl;
  assert.equal(ytplT("stDone", 12, "en", "pl"), "Gotowe ✓ 12 linii (en → pl)");
  assert.equal(ytplUiLang({ uiLang: "pl" }), "pl");
  YTPL_UI_DICT = null;
  assert.equal(ytplT("stDone", 12, "en", "pl"), "Done ✓ 12 lines (en → pl)");

  console.log("ALL TESTS PASSED");
})().catch((e) => { console.error(e); process.exit(1); });
