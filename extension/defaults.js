// Shared defaults (content script, popup, setup page, service worker via importScripts).
var YTPL_DEFAULTS = {
  enabled: true,
  ollamaUrl: "http://127.0.0.1:11434",
  model: "translategemma:4b",
  targetLang: "",         // "" = follow the browser's language
  uiLang: "",             // extension interface language; "" = follow the browser
  chunkSize: 30,          // how many subtitle lines go to the model in one request
  fontScale: 1,           // subtitle size multiplier
  showOriginal: false,    // show the original line under the translated one
  hideSoundTags: true,    // remove [Music], [Applause], ♪ … from subtitles
  autoTranslate: false    // false = translate only after clicking the language button in the player
};

// code: [English name (used in prompts), native name (shown in the UI)]
var YTPL_LANGS = {
  pl: ["Polish", "Polski"],
  en: ["English", "English"],
  de: ["German", "Deutsch"],
  fr: ["French", "Français"],
  es: ["Spanish", "Español"],
  it: ["Italian", "Italiano"],
  pt: ["Portuguese", "Português"],
  nl: ["Dutch", "Nederlands"],
  sv: ["Swedish", "Svenska"],
  no: ["Norwegian", "Norsk"],
  da: ["Danish", "Dansk"],
  fi: ["Finnish", "Suomi"],
  cs: ["Czech", "Čeština"],
  sk: ["Slovak", "Slovenčina"],
  uk: ["Ukrainian", "Українська"],
  ru: ["Russian", "Русский"],
  be: ["Belarusian", "Беларуская"],
  lt: ["Lithuanian", "Lietuvių"],
  lv: ["Latvian", "Latviešu"],
  et: ["Estonian", "Eesti"],
  hu: ["Hungarian", "Magyar"],
  ro: ["Romanian", "Română"],
  bg: ["Bulgarian", "Български"],
  hr: ["Croatian", "Hrvatski"],
  sr: ["Serbian", "Српски"],
  sl: ["Slovenian", "Slovenščina"],
  el: ["Greek", "Ελληνικά"],
  tr: ["Turkish", "Türkçe"],
  ar: ["Arabic", "العربية"],
  he: ["Hebrew", "עברית"],
  fa: ["Persian", "فارسی"],
  hi: ["Hindi", "हिन्दी"],
  bn: ["Bengali", "বাংলা"],
  ja: ["Japanese", "日本語"],
  ko: ["Korean", "한국어"],
  zh: ["Chinese", "中文"],
  vi: ["Vietnamese", "Tiếng Việt"],
  th: ["Thai", "ไทย"],
  id: ["Indonesian", "Bahasa Indonesia"],
  ms: ["Malay", "Bahasa Melayu"]
};

function ytplBase(code) {
  return String(code || "").toLowerCase().split(/[-_]/)[0];
}

// English name of a language (for model prompts).
function ytplLangName(code) {
  const l = YTPL_LANGS[ytplBase(code)];
  return l ? l[0] : (code || "English");
}

// Name of a language as shown in the UI.
function ytplNativeName(code) {
  const l = YTPL_LANGS[ytplBase(code)];
  return l ? l[1] : String(code || "");
}

// Browser language → supported language code ("en" if not on the list).
function ytplBrowserLang() {
  let ui = "";
  try { ui = chrome.i18n.getUILanguage(); } catch (_) {}
  if (!ui && typeof navigator !== "undefined") ui = navigator.language || "";
  const b = ytplBase(ui);
  return YTPL_LANGS[b] ? b : "en";
}

// The language subtitles are translated INTO.
function ytplTargetLang(settings) {
  const t = ytplBase(settings && settings.targetLang);
  return YTPL_LANGS[t] ? t : ytplBrowserLang();
}

// ---------- interface language ----------
// Interface languages shipped in _locales/ (native names, shown in the popup).
var YTPL_UI_LANGS = { en: "English", pl: "Polski" };

// Messages of a language chosen in the popup (overrides the browser language); null = use chrome.i18n.
var YTPL_UI_DICT = null;

function ytplFormat(entry, subs) {
  return entry.message.replace(/\$(\w+)\$/g, (_, name) => {
    const ph = entry.placeholders && entry.placeholders[name.toLowerCase()];
    const n = ph ? parseInt(ph.content.slice(1), 10) : 0;
    return n && subs[n - 1] != null ? String(subs[n - 1]) : "";
  });
}

// UI text: popup-selected language if set, otherwise the browser's language (English fallback).
function ytplT(key, ...subs) {
  if (YTPL_UI_DICT && YTPL_UI_DICT[key]) return ytplFormat(YTPL_UI_DICT[key], subs);
  try {
    const m = chrome.i18n.getMessage(key, subs.map(String));
    if (m) return m;
  } catch (_) {}
  return key + (subs.length ? " " + subs.join(" ") : "");
}

// Language actually used for the interface (for <html lang> and number formatting).
function ytplUiLang(settings) {
  const u = ytplBase(settings && settings.uiLang);
  if (YTPL_UI_LANGS[u]) return u;
  let b = "";
  try { b = ytplBase(chrome.i18n.getUILanguage()); } catch (_) {}
  return YTPL_UI_LANGS[b] ? b : "en";
}

// Loads the messages of the interface language chosen in settings ("" = browser language).
async function ytplLoadUi(settings) {
  const lang = ytplBase(settings && settings.uiLang);
  if (!YTPL_UI_LANGS[lang]) { YTPL_UI_DICT = null; return; }
  try {
    if (typeof location !== "undefined" && location.protocol === "chrome-extension:") {
      const r = await fetch(chrome.runtime.getURL(`_locales/${lang}/messages.json`));
      YTPL_UI_DICT = await r.json();
    } else {
      // content scripts ask the service worker for the file
      const res = await chrome.runtime.sendMessage({ type: "uiMessages", lang });
      YTPL_UI_DICT = res && res.ok ? res.messages : null;
    }
  } catch (_) {
    YTPL_UI_DICT = null;
  }
}
