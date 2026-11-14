// Setup wizard: install Ollama (download + launch installer), pull the model, warm it up.
const $ = (id) => document.getElementById(id);
const show = (id, on = true) => $(id).classList.toggle("hidden", !on);
function showErr(id, msg) {
  const span = document.createElement("span");
  span.className = "err";
  span.textContent = msg;
  $(id).replaceChildren(span);
}
let numFmt = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const gb = (b) => numFmt.format(b / 1e9) + " GB";

const INSTALLERS = {
  win: { url: "https://github.com/ollama/ollama/releases/latest/download/OllamaSetup.exe", name: "OllamaSetup.exe" },
  mac: { url: "https://github.com/ollama/ollama/releases/latest/download/Ollama.dmg", name: "Ollama.dmg" }
};

let settings = Object.assign({}, YTPL_DEFAULTS);
let platform = "win";
let downloadId = null;
let pollTimer = null;

const base = () => String(settings.ollamaUrl).replace(/\/+$/, "");

function setStep(n) {
  for (let i = 1; i <= 3; i++) {
    const el = $("s" + i);
    el.classList.toggle("done", i < n);
    el.classList.toggle("active", i === n);
  }
}

async function ollamaVersion() {
  try {
    const r = await fetch(base() + "/api/version", { cache: "no-store" });
    if (!r.ok) return null;
    return (await r.json()).version || "?";
  } catch { return null; }
}

async function installedModels() {
  const r = await fetch(base() + "/api/tags", { cache: "no-store" });
  const j = await r.json();
  return (j.models || []).map((m) => m.name);
}

// ---------- step 1: Ollama ----------
async function checkOllama() {
  const v = await ollamaVersion();
  if (!v) return false;
  clearInterval(pollTimer);
  show("s1-checking", false); show("s1-install", false); show("s1-ok");
  $("s1-ver").textContent = ytplT("s1Version", v);
  await stepModel();
  return true;
}

function showInstall() {
  show("s1-checking", false);
  show("s1-install");
  if (platform === "linux") {
    show("dl", false); show("s1-linux");
    $("s1-text").textContent = ytplT("s1NotInstalled");
  } else {
    const size = platform === "win" ? ytplT("s1SizeWin") : "";
    $("s1-text").textContent = ytplT("s1NotInstalledDl", size);
  }
  pollTimer = setInterval(checkOllama, 2500);
}

async function startDownload() {
  const inst = INSTALLERS[platform];
  $("dl").disabled = true;
  show("dl-progress");
  try {
    downloadId = await chrome.downloads.download({ url: inst.url, filename: inst.name, conflictAction: "overwrite" });
  } catch (e) {
    showErr("dl-text", ytplT("dlStartFailed", e.message));
    $("dl").disabled = false;
    return;
  }
  const tick = async () => {
    const [it] = await chrome.downloads.search({ id: downloadId });
    if (!it) return;
    if (it.state === "complete") { downloadDone(); return; }
    if (it.state === "interrupted") {
      showErr("dl-text", ytplT("dlInterrupted", it.error));
      $("dl").disabled = false;
      return;
    }
    const pct = it.totalBytes > 0 ? (100 * it.bytesReceived) / it.totalBytes : 0;
    $("dl-bar").style.width = pct.toFixed(1) + "%";
    $("dl-text").textContent = it.totalBytes > 0 ? ytplT("dlProgress", gb(it.bytesReceived), gb(it.totalBytes)) : gb(it.bytesReceived);
    setTimeout(tick, 500);
  };
  tick();
}

function downloadDone() {
  $("dl-bar").style.width = "100%";
  $("dl-text").textContent = ytplT("dlDone");
  show("dl", false);
  show("run");
  show("s1-after");
  $("s1-after").textContent = ytplT(platform === "win" ? "afterWin" : "afterMac");
}

async function runInstaller() {
  try {
    await chrome.downloads.open(downloadId); // must be called from a click
  } catch (e) {
    try { chrome.downloads.show(downloadId); } catch (_) {}
    $("s1-after").textContent = ytplT("runFallback", INSTALLERS[platform].name);
  }
}

// ---------- step 2: model ----------
async function stepModel() {
  setStep(2);
  let models = [];
  try { models = await installedModels(); } catch (_) {}
  const have = models.find((m) => /translategemma/i.test(m)) || (models.includes(settings.model) ? settings.model : null);
  if (have) {
    show("s2-have");
    $("s2-have").textContent = ytplT("s2Have", have);
    await useModel(have);
    return;
  }
  show("s2-body");
}

async function pullModel() {
  const model = document.querySelector('input[name="m"]:checked').value;
  $("pull").disabled = true;
  document.querySelectorAll('input[name="m"]').forEach((r) => (r.disabled = true));
  show("pull-progress");
  $("pull-text").textContent = ytplT("pullConnecting");
  const layers = new Map(); // digest -> {total, completed}
  try {
    const r = await fetch(base() + "/api/pull", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, name: model, stream: true })
    });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = "", ok = false;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        const ev = JSON.parse(line);
        if (ev.error) throw new Error(ev.error);
        if (ev.digest && ev.total) layers.set(ev.digest, { total: ev.total, completed: ev.completed || 0 });
        let tot = 0, comp = 0;
        for (const l of layers.values()) { tot += l.total; comp += l.completed; }
        if (tot) {
          $("pull-bar").style.width = ((100 * comp) / tot).toFixed(1) + "%";
          $("pull-text").textContent = ytplT("dlProgress", gb(comp), gb(tot));
        }
        if (/verifying|writing/.test(ev.status)) $("pull-text").textContent = ytplT("pullVerifying");
        if (ev.status === "success") ok = true;
      }
    }
    if (!ok) throw new Error(ytplT("pullInterrupted"));
    $("pull-bar").style.width = "100%";
    $("pull-text").textContent = ytplT("pullDone");
    await useModel(model);
  } catch (e) {
    showErr("pull-text", ytplT("pullError", e.message));
    $("pull").disabled = false;
    document.querySelectorAll('input[name="m"]').forEach((r) => (r.disabled = false));
  }
}

// ---------- step 3: done ----------
async function useModel(model) {
  settings.model = model;
  await chrome.storage.local.set({ settings });
  setStep(3);
  show("s3-body");
  const t0 = performance.now();
  const toEn = ytplTargetLang(settings) === "en";
  const res = await chrome.runtime.sendMessage({
    type: "translate",
    lines: toEn ? ["Wszystko gotowe.", "Miłego oglądania!"] : ["Everything is ready.", "Enjoy your videos!"],
    context: [],
    srcLang: toEn ? "pl" : "en"
  }).catch((e) => ({ ok: false, error: e.message }));
  const s = numFmt.format((performance.now() - t0) / 1000);
  $("s3-test").textContent = res && res.ok
    ? ytplT("s3TestOk", s, res.lines.join(" "))
    : ytplT("s3TestFail", res && res.error);
  $("s3-test").classList.toggle("err", !(res && res.ok));
  $("s3").classList.add("done");
}

// ---------- init ----------
$("dl").addEventListener("click", startDownload);
$("run").addEventListener("click", runInstaller);
$("pull").addEventListener("click", pullModel);
$("recheck").addEventListener("click", (e) => { e.preventDefault(); checkOllama(); });
$("yt").addEventListener("click", () => chrome.tabs.create({ url: "https://www.youtube.com/" }));

(async () => {
  const r = await chrome.storage.local.get("settings");
  settings = Object.assign({}, YTPL_DEFAULTS, r.settings || {});
  await ytplLoadUi(settings);
  ytplApplyI18n(settings);
  numFmt = new Intl.NumberFormat(ytplUiLang(settings), { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  try { platform = (await chrome.runtime.getPlatformInfo()).os; } catch (_) {}
  if (platform === "cros" || platform === "openbsd" || platform === "android") platform = "linux";
  setStep(1);
  if (!(await checkOllama())) showInstall();
})();
