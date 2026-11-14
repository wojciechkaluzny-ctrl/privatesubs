const $ = (id) => document.getElementById(id);
let settings = Object.assign({}, YTPL_DEFAULTS);

async function load() {
  const r = await chrome.storage.local.get("settings");
  settings = Object.assign({}, YTPL_DEFAULTS, r.settings || {});
  await ytplLoadUi(settings);
  ytplApplyI18n(settings);
  $("enabled").checked = settings.enabled;
  fillLangs();
  fillUiLangs();
  $("ollamaUrl").value = settings.ollamaUrl;
  $("model").value = settings.model;
  $("fontScale").value = settings.fontScale;
  $("fontScaleVal").textContent = Math.round(settings.fontScale * 100) + "%";
  $("showOriginal").checked = settings.showOriginal;
  $("autoTranslate").checked = settings.autoTranslate;
  $("chunkSize").value = settings.chunkSize;
  refreshModels();
  refreshStatus();
  setInterval(refreshStatus, 1000);
}

function fillLangs() {
  const sel = $("targetLang");
  sel.replaceChildren();
  sel.append(new Option(ytplT("optBrowserLang", ytplNativeName(ytplBrowserLang())), ""));
  const codes = Object.keys(YTPL_LANGS).sort((a, b) => ytplNativeName(a).localeCompare(ytplNativeName(b)));
  for (const c of codes) sel.append(new Option(`${ytplNativeName(c)} (${c.toUpperCase()})`, c));
  sel.value = YTPL_LANGS[settings.targetLang] ? settings.targetLang : "";
}

function fillUiLangs() {
  const sel = $("uiLang");
  sel.replaceChildren(new Option(ytplT("optUiAuto"), ""));
  for (const [code, name] of Object.entries(YTPL_UI_LANGS)) sel.append(new Option(name, code));
  sel.value = YTPL_UI_LANGS[settings.uiLang] ? settings.uiLang : "";
}

function isLocal(url) {
  try { return ["localhost", "127.0.0.1"].includes(new URL(url).hostname); } catch { return false; }
}

async function save(partial) {
  Object.assign(settings, partial);
  await chrome.storage.local.set({ settings });
}

async function saveForm() {
  const url = $("ollamaUrl").value.trim().replace(/\/+$/, "") || YTPL_DEFAULTS.ollamaUrl;
  if (!isLocal(url)) {
    // A remote Ollama (e.g. another PC on LAN / Tailscale) needs an extra host permission.
    const origin = new URL(url).origin + "/*";
    const ok = await chrome.permissions.request({ origins: [origin] }).catch(() => false);
    if (!ok) { $("testOut").textContent = ytplT("msgNoPermission", origin); return; }
  }
  await save({
    ollamaUrl: url,
    model: $("model").value.trim() || YTPL_DEFAULTS.model,
    fontScale: +$("fontScale").value,
    showOriginal: $("showOriginal").checked,
    autoTranslate: $("autoTranslate").checked,
    targetLang: $("targetLang").value,
    uiLang: $("uiLang").value,
    chunkSize: Math.min(80, Math.max(5, parseInt($("chunkSize").value, 10) || YTPL_DEFAULTS.chunkSize))
  });
  $("testOut").textContent = ytplT("msgSaved");
  refreshModels();
}

async function refreshModels() {
  const sel = $("modelSelect");
  sel.replaceChildren();
  const res = await chrome.runtime.sendMessage({ type: "listModels" }).catch((e) => ({ ok: false, error: e.message }));
  const missing = !res || !res.ok || !res.models.includes(settings.model);
  document.getElementById("wizardBig").classList.toggle("hidden", !missing);
  if (!res || !res.ok) {
    sel.append(new Option(ytplT("optOllamaDown"), ""));
    $("testOut").textContent = (res && res.error) || "";
    return;
  }
  if (!res.models.length) sel.append(new Option(ytplT("optNoModels"), ""));
  for (const m of res.models) sel.append(new Option(m, m, false, m === settings.model));
  if (res.models.length && !res.models.includes(settings.model)) {
    sel.prepend(new Option(ytplT("optPickModel"), "", true, true));
  }
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function refreshStatus() {
  const el = $("status");
  const tab = await activeTab();
  let st = null;
  if (tab && tab.id != null) st = await chrome.tabs.sendMessage(tab.id, { type: "status" }, { frameId: 0 }).catch(() => null);
  el.classList.remove("err");
  if (!st) { el.textContent = ytplT("stOpenYouTube"); return; }
  if (!st.videoId) { el.textContent = ytplT("stOpenVideo"); return; }
  if (!settings.enabled) { el.textContent = ytplT("stDisabled"); return; }
  if (!st.on) { el.textContent = ytplT("stOffForVideo", (st.tgt || "").toUpperCase()); return; }
  if (!st.hasTrack) { el.textContent = ytplT("stWaiting"); return; }
  const pct = Math.floor((100 * st.done) / Math.max(1, st.total));
  const src = (st.lang || "?") + (st.kind === "asr" ? " (auto)" : "");
  let text;
  if (st.status === "done") text = ytplT("stDone", st.total, src, st.tgt);
  else if (st.status === "error") { text = ytplT("stError", st.error); el.classList.add("err"); }
  else text = ytplT("stTranslating", src, st.tgt, st.done, st.total, pct) + (st.error ? `\n⚠ ${st.error}` : "");
  el.replaceChildren(text);
  const bar = document.createElement("div");
  bar.className = "bar";
  const fill = document.createElement("i");
  fill.style.width = pct + "%";
  bar.append(fill);
  el.append(bar);
}

$("enabled").addEventListener("change", (e) => save({ enabled: e.target.checked }));
$("targetLang").addEventListener("change", (e) => save({ targetLang: e.target.value }));
$("uiLang").addEventListener("change", async (e) => {
  await save({ uiLang: e.target.value });
  location.reload(); // redraw the popup in the new language
});
$("autoTranslate").addEventListener("change", (e) => save({ autoTranslate: e.target.checked }));
$("modelSelect").addEventListener("change", (e) => { if (e.target.value) $("model").value = e.target.value; });
$("fontScale").addEventListener("input", (e) => {
  $("fontScaleVal").textContent = Math.round(e.target.value * 100) + "%";
  save({ fontScale: +e.target.value });
});
$("save").addEventListener("click", saveForm);
$("refresh").addEventListener("click", refreshModels);
$("retry").addEventListener("click", async () => {
  const tab = await activeTab();
  if (tab) chrome.tabs.sendMessage(tab.id, { type: "retry" }, { frameId: 0 }).catch(() => {});
});
$("clear").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "clearCache" });
  $("testOut").textContent = ytplT("msgCacheCleared");
});
$("test").addEventListener("click", async () => {
  await saveForm();
  $("testOut").textContent = ytplT("msgTesting");
  const t0 = performance.now();
  // English sample, or a Polish one when translating into English
  const toEn = ytplTargetLang(settings) === "en";
  const res = await chrome.runtime.sendMessage({
    type: "translate",
    lines: toEn
      ? ["Najpierw sprawdź, czy silnik jest rozgrzany.", "Całkiem fajne, prawda?"]
      : ["So the first thing you want to do", "is to check whether the engine is warm.", "Pretty cool, right?"],
    context: [],
    srcLang: toEn ? "pl" : "en"
  }).catch((e) => ({ ok: false, error: e.message }));
  const s = ((performance.now() - t0) / 1000).toFixed(1);
  $("testOut").textContent = res && res.ok ? res.lines.join("\n") + `\n(${s} s)` : ytplT("stError", res && res.error);
});

const openWizard = () => chrome.tabs.create({ url: chrome.runtime.getURL("setup.html") });
$("wizard").addEventListener("click", openWizard);
$("wizardBig").addEventListener("click", openWizard);

load();
