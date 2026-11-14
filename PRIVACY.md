# Privacy Policy – PrivateSubs

_Last updated: 2026-11-14_

PrivateSubs is built so that your viewing activity stays on your computer.

## What the extension processes

| Data | Where it goes | Why |
|---|---|---|
| Subtitle text of the YouTube video you choose to translate | Only to the Ollama server address set in the extension (by default `http://127.0.0.1:11434`, i.e. your own computer) | To translate it |
| Video ID and the translated subtitles | Stored locally in your browser (`chrome.storage.local`) | Cache, so a video doesn't have to be translated twice |
| Your on/off choice per video | Stored locally in your browser | To remember it |
| Settings (target language, model, Ollama address, subtitle size…) | Stored locally in your browser | To apply them |

## What the extension does NOT do

- It has no server of its own and does not send data to the developers or any third party.
- It has no analytics, telemetry, ads or tracking.
- It doesn't collect personal information, browsing history, account data or passwords.
- It doesn't read or change anything on websites other than YouTube.

## Network connections

- **Ollama.** Subtitle lines are sent to the Ollama address configured in the extension. By default that's your own computer.
  If you change it to another machine, subtitle text is sent there.
- **Setup wizard (only when you click the buttons):**
  - the Ollama installer is downloaded from `github.com/ollama/ollama` releases,
  - the translation model is downloaded by Ollama from the Ollama model library.

## Deleting your data

- Popup → **Clear cache** removes all stored translations.
- Removing the extension deletes all of its stored data.

## Contact

Questions or concerns: open an issue in this repository.

---

# Polityka prywatności – PrivateSubs (PL)

PrivateSubs działa tak, żeby to, co oglądasz, zostawało na Twoim komputerze.

- Tekst napisów wybranego filmu trafia **wyłącznie** pod adres Ollamy ustawiony w wtyczce (domyślnie `http://127.0.0.1:11434`, czyli Twój komputer).
- Przetłumaczone napisy, identyfikator filmu, wybór włącz/wyłącz dla filmu i ustawienia są przechowywane **lokalnie w przeglądarce**.
- Wtyczka **nie ma serwera**, analityki, telemetrii, reklam ani śledzenia. Nie zbiera danych osobowych, historii przeglądania ani haseł.
- Kreator, tylko po Twoim kliknięciu, pobiera instalator Ollamy z GitHuba, a Ollama pobiera model ze swojej biblioteki.
- Dane usuniesz przyciskiem **Wyczyść cache** w okienku wtyczki albo odinstalowując wtyczkę.
