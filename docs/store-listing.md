# Store listing texts

Ready-to-paste texts for the Chrome Web Store, Microsoft Edge Add-ons and Opera add-ons.

## Basics

| Field | Value |
|---|---|
| Name | PrivateSubs |
| Category | Accessibility (alternative: Productivity / Tools) |
| Language | English (+ Polish listing) |
| Icon | `extension/icons/128.png` |
| Homepage / support | `https://github.com/wojciechkaluzny-ctrl/privatesubs` |
| Privacy policy URL | `https://github.com/wojciechkaluzny-ctrl/privatesubs/blob/main/PRIVACY.md` |

## Short description (max 132 characters)

**EN:** Translate YouTube subtitles into your language with a local AI model (Ollama). Private: nothing leaves your computer.

**PL:** Tłumacz napisy z YouTube na swój język lokalnym modelem AI (Ollama). Prywatnie: nic nie opuszcza Twojego komputera.

## Detailed description – EN

```
Only English subtitles on a YouTube video? PrivateSubs translates them into your language with an AI model running on your own computer. It doesn't use cloud services or API keys, and nobody sees what you watch.

HOW IT WORKS
• A language button (e.g. "DE") appears in the YouTube player next to the CC button.
• One click translates the video's whole subtitle track, starting from where you are watching.
• Translated subtitles are shown in the player, including full screen.

FEATURES
• Translates from any language into about 40 languages. By default it uses your browser's language.
• Turns word-by-word auto-generated captions into readable sentences.
• Remembers your choice for each video and stores translations locally, so a video doesn't have to be translated twice.
• Optional dual subtitles (original + translation), useful for language learning.
• Adjustable subtitle size. Shortcut Alt+Shift+P.
• Setup wizard that installs Ollama and downloads the translation model for you.

REQUIREMENTS
• Ollama, a free app for running AI models locally. The setup wizard installs it.
• The TranslateGemma model (about 3.3 GB) or any other model available in Ollama.

PRIVACY
No servers, accounts, analytics or tracking. Subtitle text is sent only to Ollama on your own computer.

PrivateSubs is open source (MIT): https://github.com/wojciechkaluzny-ctrl/privatesubs
Not affiliated with YouTube or Google.
```

## Detailed description – PL

```
Film na YouTube ma tylko angielskie napisy? PrivateSubs przetłumaczy je na Twój język modelem AI działającym na Twoim komputerze. Bez chmury, bez kluczy API, nikt nie widzi, co oglądasz.

JAK TO DZIAŁA
• W odtwarzaczu YouTube, obok przycisku napisów, pojawia się przycisk z kodem języka (np. „PL”).
• Jedno kliknięcie tłumaczy całe napisy filmu, zaczynając od miejsca, które oglądasz.
• Przetłumaczone napisy wyświetlają się w odtwarzaczu, także na pełnym ekranie.

FUNKCJE
• Tłumaczenie z dowolnego języka na ok. 40 języków. Domyślnie na język przeglądarki.
• Automatyczne napisy (słowo po słowie) są składane w czytelne zdania.
• Pamięta wybór dla każdego filmu i zapisuje tłumaczenia lokalnie, więc filmu nie trzeba tłumaczyć drugi raz.
• Opcjonalne podwójne napisy (oryginał + tłumaczenie), przydatne do nauki języków.
• Regulowany rozmiar napisów. Skrót Alt+Shift+P.
• Kreator, który sam instaluje Ollamę i pobiera model tłumaczący.

WYMAGANIA
• Ollama, darmowa aplikacja do lokalnego uruchamiania modeli AI. Instaluje ją kreator.
• Model TranslateGemma (ok. 3,3 GB) lub inny model dostępny w Ollamie.

PRYWATNOŚĆ
Bez serwerów, kont, analityki i śledzenia. Tekst napisów trafia tylko do Ollamy na Twoim komputerze.

PrivateSubs to otwarte oprogramowanie (MIT): https://github.com/wojciechkaluzny-ctrl/privatesubs
Projekt niepowiązany z YouTube ani Google.
```

## Chrome Web Store – privacy practices tab

**Single purpose:**
Translate the subtitles of YouTube videos into the user's chosen language using an AI model running locally through Ollama, and display them in the YouTube player.

**Permission justifications:**

| Permission | Justification |
|---|---|
| Host: `https://www.youtube.com/*`, `https://www.youtube-nocookie.com/*` | Content scripts capture the subtitle track the YouTube player downloads, add the language button to the player and draw the translated subtitles over the video. |
| Host: `http://localhost/*`, `http://127.0.0.1/*` | Sending subtitle text to the user's local Ollama server for translation, and checking its status and installed models. |
| `storage` | Saving the user's settings and the per-video on/off choice. |
| `unlimitedStorage` | Caching translated subtitles locally, so videos don't need to be translated again. A long video's translations can exceed the default quota. |
| `declarativeNetRequest` | One rule removes the `Origin` header from requests to the user's Ollama address. Without it Ollama rejects requests from extensions unless the user changes system environment variables. |
| `downloads` | The setup wizard downloads the official Ollama installer when the user clicks "Download Ollama". |
| `downloads.open` | The setup wizard opens the downloaded installer when the user clicks "Run the installer". |
| Optional host permissions (`http://*/*`, `https://*/*`) | Requested at runtime only if the user enters the address of an Ollama server on another computer. Only that one origin is requested. |

**Remote code:** No, the extension doesn't use remote code. All JavaScript is included in the package.

**Data usage:** The extension does not collect or transmit user data to the developer or any third party.
Subtitle text is processed only by the Ollama server the user configures (by default on the user's own computer).
Check: *"I do not sell or transfer user data to third parties…"*, *"…not used for purposes unrelated to the item's single purpose"*,
*"…not used to determine creditworthiness…"*.

## Screenshots to prepare (1280×800 or 640×400)

1. YouTube player with translated subtitles and the language button highlighted (`docs/screenshots/player.jpg` – crop/pad to 1280×800).
2. The same video with dual subtitles (original + translation).
3. Popup with settings (`docs/screenshots/popup-en.png`).
4. Setup wizard (`docs/screenshots/setup-en.png`).
