// Captures UI screenshots for the docs (popup + setup wizard) in a given UI language,
// against a mock Ollama server. Also fails if any text was left untranslated (raw i18n key).
// Usage: node scripts/screenshots.js [en|pl]
const { chromium } = require("playwright");
const http = require("http");
const os = require("os");
const fs = require("fs");
const path = require("path");

const LANG = process.argv[2] || "en";
const EXT = path.join(__dirname, "..", "extension");
const OUT = path.join(__dirname, "..", "docs", "screenshots");
const keys = Object.keys(JSON.parse(fs.readFileSync(path.join(EXT, "_locales/en/messages.json"), "utf8")));

const server = http.createServer((req, res) => {
  let b = "";
  req.on("data", (c) => (b += c));
  req.on("end", () => {
    if (req.url === "/api/version") return res.end('{"version":"0.33.0"}');
    if (req.url === "/api/tags") return res.end(JSON.stringify({ models: [{ name: "translategemma:4b" }, { name: "translategemma:12b" }] }));
    if (req.url === "/api/chat") {
      const p = JSON.parse(b).messages[0].content;
      const out = /into Polish/.test(p) ? "Wszystko gotowe.\nMiłego oglądania!" : "Everything is ready.\nEnjoy your videos!";
      return setTimeout(() => res.end(JSON.stringify({ message: { content: out } })), 300);
    }
    res.statusCode = 404; res.end();
  });
});

function checkNoRawKeys(text, where) {
  const raw = keys.filter((k) => new RegExp("\\b" + k + "\\b").test(text));
  if (raw.length) throw new Error(`${where}: untranslated keys ${raw.join(", ")}`);
}

(async () => {
  await new Promise((r) => server.listen(11434, "127.0.0.1", r));
  fs.mkdirSync(OUT, { recursive: true });
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), "ps-")), {
    channel: "chromium", headless: true, locale: LANG, deviceScaleFactor: 2,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, `--lang=${LANG}`]
  });
  let sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent("serviceworker");
  const id = sw.url().split("/")[2];

  // setup wizard (opens itself on install)
  const setup = ctx.pages().find((p) => p.url().includes("setup.html")) ||
    await ctx.waitForEvent("page", { predicate: (p) => p.url().includes("setup.html") });
  await setup.setViewportSize({ width: 760, height: 900 });
  await setup.waitForFunction(() => document.getElementById("s3").classList.contains("done"), null, { timeout: 15000 });
  checkNoRawKeys(await setup.evaluate(() => document.body.innerText), "setup");
  await setup.locator(".wrap").screenshot({ path: path.join(OUT, `setup-${LANG}.png`) });

  // popup
  const popup = await ctx.newPage();
  await popup.setViewportSize({ width: 320, height: 600 });
  await popup.goto(`chrome-extension://${id}/popup.html`);
  await popup.waitForFunction(() => document.querySelectorAll("#modelSelect option").length > 1);
  checkNoRawKeys(await popup.evaluate(() => document.body.innerText), "popup");
  await popup.locator("body").screenshot({ path: path.join(OUT, `popup-${LANG}.png`) });

  console.log(`screenshots (${LANG}) saved to ${OUT}`);
  await ctx.close();
  server.close();
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
