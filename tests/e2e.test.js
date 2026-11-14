// End-to-end: real Chromium + the extension, fake YouTube page (routed), mock Ollama.
const { chromium } = require("playwright");
const http = require("http");
const os = require("os");
const path = require("path");
const fs = require("fs");
const EXT = require("path").resolve(process.argv[2] || require("path").join(__dirname, "..", "extension"));

const seen = { chat: 0, originHeaders: [] };
const ollama = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    seen.originHeaders.push(req.headers.origin || null);
    if (req.url === "/api/tags") {
      res.end(JSON.stringify({ models: [{ name: "translategemma:4b" }] }));
    } else if (req.url === "/api/chat") {
      seen.chat++;
      const j = JSON.parse(body);
      const prompt = j.messages[0].content;
      const code = prompt.match(/ to \w+ \((\w+)\) translator/)[1].toUpperCase();
      const src = prompt.split("\n\n\n")[1].split("\n");
      res.end(JSON.stringify({ message: { content: src.map((l) => code + ": " + l).join("\n") } }));
    } else { res.statusCode = 404; res.end(); }
  });
});

const PAGE = `<!doctype html><html><body>
<div id="movie_player" class="html5-video-player" style="position:relative;width:640px;height:360px;background:#000">
  <video class="html5-main-video" style="width:100%;height:100%"></video>
  <div class="ytp-caption-window-container" id="native" style="position:absolute;bottom:80px;width:100%;text-align:center;color:#ff0">native captions</div>
  <div class="ytp-chrome-bottom" style="position:absolute;bottom:8px;right:8px;background:rgba(40,40,40,.85);border-radius:24px;padding:0 8px">
   <div class="ytp-right-controls" style="display:flex;align-items:center">
    <button class="ytp-button" style="width:48px;height:48px;background:none;border:0"><svg width="24" height="24" viewBox="0 0 24 24"><path d="M12 2 4 5v6c0 5 3.4 9.7 8 11 4.6-1.3 8-6 8-11V5z" fill="none" stroke="#fff" stroke-width="2"/></svg></button>
    <button class="ytp-button ytp-subtitles-button" aria-pressed="false" style="width:48px;height:48px;background:none;border:0"><svg width="24" height="24" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="3" fill="none" stroke="#fff" stroke-width="2"/><path d="M7 15h4M13 15h4M7 11h10" stroke="#fff" stroke-width="2"/></svg></button>
    <button class="ytp-button" style="width:48px;height:48px;background:none;border:0"><svg width="24" height="24" viewBox="0 0 24 24"><circle cx="12" cy="12" r="7" fill="none" stroke="#fff" stroke-width="2"/></svg></button>
   </div></div>
</div>
<script>
  const b = document.querySelector('.ytp-subtitles-button');
  b.addEventListener('click', () => {
    b.setAttribute('aria-pressed', 'true');
    const x = new XMLHttpRequest();
    x.open('GET', '/api/timedtext?v=abc123def45&lang=en&fmt=json3&pot=TOKEN&c=WEB');
    x.send();
  });
</script></body></html>`;

const TRACK = JSON.stringify({ events: [
  { tStartMs: 0, dDurationMs: 2000, segs: [{ utf8: "Hello there." }] },
  { tStartMs: 2000, dDurationMs: 1500, segs: [{ utf8: "How are you?" }] }
] });

(async () => {
  await new Promise((r) => ollama.listen(11434, "127.0.0.1", r));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pw-"));
  const ctx = await chromium.launchPersistentContext(dir, {
    channel: "chromium",
    headless: true,
    locale: "pl-PL",
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, "--lang=pl"]
  });
  await ctx.route("https://www.youtube.com/**", (route) => {
    const u = new URL(route.request().url());
    if (u.pathname === "/watch") return route.fulfill({ contentType: "text/html", body: PAGE });
    if (u.pathname === "/api/timedtext") {
      // like real YouTube: no pot → empty 200
      return route.fulfill({ contentType: "application/json", body: u.searchParams.get("pot") ? TRACK : "" });
    }
    return route.fulfill({ status: 404, body: "" });
  });

  const page = await ctx.newPage();
  page.on("console", (m) => { if (/YTPL|error/i.test(m.text())) console.log("[page]", m.text()); });
  await page.goto("https://www.youtube.com/watch?v=abc123def45");

  // PL button must appear right before the CC button; translation is off by default
  await page.waitForSelector(".ytpl-btn", { timeout: 10000 });
  const order = await page.evaluate(() => document.querySelector(".ytpl-btn").nextElementSibling.classList.contains("ytp-subtitles-button"));
  if (!order) throw new Error("PL button not before CC button");
  await page.waitForTimeout(1500);
  if (seen.chat) throw new Error("translated without clicking PL");
  if (await page.evaluate(() => document.querySelector(".ytp-subtitles-button").getAttribute("aria-pressed")) !== "false") throw new Error("CC turned on without PL");
  await page.screenshot({ path: require("path").join(require("os").tmpdir(), "privatesubs-bar_off.png"), clip: { x: 380, y: 300, width: 270, height: 70 } });

  // click PL → CC turns on, track loads, translation shows
  await page.click(".ytpl-btn");
  await page.evaluate(() => { document.querySelector("video").currentTime = 2.5; });
  await page.waitForFunction(() => document.querySelector(".ytpl-line")?.textContent === "PL: How are you?", null, { timeout: 20000 });
  const state = await page.evaluate(() => ({
    cc: document.querySelector(".ytp-subtitles-button").getAttribute("aria-pressed"),
    btnOn: document.querySelector(".ytpl-btn").classList.contains("ytpl-btn-on"),
    overlayVisible: getComputedStyle(document.querySelector(".ytpl-overlay")).display !== "none",
    nativeHidden: getComputedStyle(document.getElementById("native")).visibility === "hidden"
  }));
  console.log("on:", state, "origin headers", [...new Set(seen.originHeaders)]);
  if (state.cc !== "true" || !state.btnOn || !state.overlayVisible || !state.nativeHidden) throw new Error("bad ON state");
  await page.screenshot({ path: require("path").join(require("os").tmpdir(), "privatesubs-bar_on.png"), clip: { x: 0, y: 0, width: 660, height: 380 } });

  // click PL again → off: overlay gone, YouTube captions back
  await page.click(".ytpl-btn");
  await page.waitForTimeout(300);
  const off = await page.evaluate(() => ({
    overlay: getComputedStyle(document.querySelector(".ytpl-overlay")).display,
    nativeHidden: getComputedStyle(document.getElementById("native")).visibility === "hidden",
    btnOn: document.querySelector(".ytpl-btn").classList.contains("ytpl-btn-on")
  }));
  console.log("off:", off);
  if (off.overlay !== "none" || off.nativeHidden || off.btnOn) throw new Error("bad OFF state");

  // turn on again, reload → choice for this video remembered, translation from cache
  await page.click(".ytpl-btn");
  const before = seen.chat;
  await page.reload();
  await page.waitForFunction(() => document.querySelector(".ytpl-btn")?.classList.contains("ytpl-btn-on"), null, { timeout: 10000 });
  await page.waitForFunction(() => document.querySelector(".ytp-subtitles-button").getAttribute("aria-pressed") === "true", null, { timeout: 15000 });
  await page.evaluate(() => { document.querySelector("video").currentTime = 0.5; });
  await page.waitForFunction(() => document.querySelector(".ytpl-line")?.textContent === "PL: Hello there.", null, { timeout: 10000 });
  if (seen.chat !== before) throw new Error("cache not used");

  // browser language → button says PL
  const lbl = await page.evaluate(() => document.querySelector(".ytpl-btn text").textContent);
  console.log("button label (browser pl):", lbl);
  if (lbl !== "PL") throw new Error("browser language not detected");

  // switch target to German in settings → button says DE, track re-translated into German
  const sw = ctx.serviceWorkers()[0];
  await sw.evaluate(async () => { const r = await chrome.storage.local.get("settings"); await chrome.storage.local.set({ settings: Object.assign({}, r.settings, { targetLang: "de" }) }); });
  await page.waitForFunction(() => document.querySelector(".ytpl-btn text").textContent === "DE", null, { timeout: 5000 });
  await page.waitForFunction(() => document.querySelector(".ytpl-line")?.textContent === "DE: Hello there.", null, { timeout: 10000 });
  console.log("switched to DE ok, title:", await page.getAttribute(".ytpl-btn", "title"));

  // target = English and captions are English → nothing to translate, YouTube captions stay
  await sw.evaluate(async () => { const r = await chrome.storage.local.get("settings"); await chrome.storage.local.set({ settings: Object.assign({}, r.settings, { targetLang: "en" }) }); });
  await page.waitForFunction(() => document.querySelector(".ytpl-btn text").textContent === "EN", null, { timeout: 5000 });
  await page.waitForFunction(() => getComputedStyle(document.querySelector(".ytpl-overlay")).display === "none", null, { timeout: 5000 }).catch(() => {});
  const same = await page.evaluate(() => ({
    overlay: getComputedStyle(document.querySelector(".ytpl-overlay")).display,
    nativeHidden: getComputedStyle(document.getElementById("native")).visibility === "hidden"
  }));
  console.log("same language:", same);
  if (same.overlay !== "none" || same.nativeHidden) throw new Error("should leave same-language captions alone");

  // interface language switched to English in a Polish browser → player tooltip follows without reload
  await sw.evaluate(async () => { const r = await chrome.storage.local.get("settings"); await chrome.storage.local.set({ settings: Object.assign({}, r.settings, { uiLang: "en" }) }); });
  await page.waitForFunction(() => /^Subtitles: /.test(document.querySelector(".ytpl-btn").title), null, { timeout: 5000 });
  console.log("ui language en, title:", await page.getAttribute(".ytpl-btn", "title"));
  const id = sw.url().split("/")[2];
  const popup = await ctx.newPage();
  await popup.goto(`chrome-extension://${id}/popup.html`);
  await popup.waitForFunction(() => document.querySelector('label[for="uiLang"]').textContent === "Interface language" && document.documentElement.lang === "en", null, { timeout: 5000 });
  console.log("popup in English:", await popup.textContent('label[for="targetLang"]'));
  // back to automatic → Polish again
  await popup.selectOption("#uiLang", "");
  await popup.waitForFunction(() => document.querySelector('label[for="targetLang"]').textContent === "Tłumacz napisy na", null, { timeout: 5000 });
  await page.waitForFunction(() => /^Napisy: /.test(document.querySelector(".ytpl-btn").title), null, { timeout: 5000 });
  console.log("back to automatic (pl) ok");

  console.log("E2E PASSED");
  await ctx.close();
  ollama.close();
})().catch(async (e) => { console.error("E2E FAILED", e.message); process.exit(1); });
