// Fills static texts in extension pages from the interface language:
//   data-i18n attribute       → element text
//   data-i18n-title attribute → title attribute
function ytplApplyI18n(settings) {
  document.documentElement.lang = ytplUiLang(settings);
  for (const el of document.querySelectorAll("[data-i18n]")) el.textContent = ytplT(el.dataset.i18n);
  for (const el of document.querySelectorAll("[data-i18n-title]")) el.title = ytplT(el.dataset.i18nTitle);
}
ytplApplyI18n();
