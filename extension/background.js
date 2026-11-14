importScripts("defaults.js", "translator.js");

async function getSettings() {
  const r = await chrome.storage.local.get("settings");
  return Object.assign({}, YTPL_DEFAULTS, r.settings || {});
}

// Ollama rejects requests whose Origin header is not on its allow-list
// (chrome-extension://... usually isn't). Requests without Origin are allowed,
// so strip the header for requests going to the configured Ollama address.
async function updateOriginRule() {
  const s = await getSettings();
  let origin;
  try { origin = new URL(s.ollamaUrl).origin; } catch { return; }
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [1],
      addRules: [{
        id: 1,
        priority: 1,
        action: { type: "modifyHeaders", requestHeaders: [{ header: "origin", operation: "remove" }] },
        condition: { urlFilter: "|" + origin + "/", resourceTypes: ["xmlhttprequest", "other"] }
      }]
    });
  } catch (e) {
    console.warn("[YTPL] DNR rule failed", e);
  }
}

// Keep the translation cache from growing forever.
async function pruneCache(max = 300) {
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter((k) => k.startsWith("c:"));
  if (keys.length <= max) return;
  keys.sort((a, b) => (all[a].ts || 0) - (all[b].ts || 0));
  await chrome.storage.local.remove(keys.slice(0, keys.length - max));
}

// Interface language for error messages produced here (translator.js).
getSettings().then(ytplLoadUi);

chrome.runtime.onInstalled.addListener(async (details) => {
  await updateOriginRule(); // before the wizard talks to Ollama
  pruneCache();
  if (details.reason === "install") chrome.tabs.create({ url: chrome.runtime.getURL("setup.html") });
});
chrome.runtime.onStartup.addListener(() => { updateOriginRule(); pruneCache(); });
chrome.storage.onChanged.addListener((ch, area) => {
  if (area === "local" && ch.settings) {
    updateOriginRule();
    ytplLoadUi(ch.settings.newValue);
  }
});

chrome.commands.onCommand.addListener(async (cmd) => {
  if (cmd !== "toggle-overlay") return;
  // Same as clicking the language button in the player of the active tab.
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && tab.id != null) chrome.tabs.sendMessage(tab.id, { type: "toggleVideo" }, { frameId: 0 }).catch(() => {});
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    const s = await getSettings();
    if (msg.type === "translate") {
      const lines = await YTPL_translator.translateLines(s, msg.lines, msg.context, msg.srcLang, msg.tgtLang || ytplTargetLang(s));
      return { ok: true, lines, model: s.model };
    }
    if (msg.type === "uiMessages") {
      if (!YTPL_UI_LANGS[msg.lang]) return { ok: false, error: "unknown language" };
      const r = await fetch(chrome.runtime.getURL(`_locales/${msg.lang}/messages.json`));
      return { ok: true, messages: await r.json() };
    }
    if (msg.type === "listModels") {
      return { ok: true, models: await YTPL_translator.listModels(s) };
    }
    if (msg.type === "clearCache") {
      const all = await chrome.storage.local.get(null);
      await chrome.storage.local.remove(Object.keys(all).filter((k) => k.startsWith("c:")));
      return { ok: true };
    }
    return { ok: false, error: "unknown message" };
  })().then(sendResponse, (e) => sendResponse({ ok: false, error: e.message || String(e) }));
  return true; // async response
});
