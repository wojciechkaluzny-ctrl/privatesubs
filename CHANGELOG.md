# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.0.0] – 2026-11-14

First public release.

### Added
- Language button in the YouTube player (next to CC) that toggles translation for the current video and shows the target language code.
- Translation of the whole subtitle track through a local Ollama server, starting from the current playback position.
- Rebuilding word-by-word auto-generated captions into sentences before translation.
- TranslateGemma prompt mode, plus a JSON mode with an exact line count for general chat models. A batch whose line count comes back wrong is split and retried automatically.
- About 40 target languages. The default follows the browser language, and subtitles already in the target language are left untouched.
- Local cache of translations per video, source language and target language. The on/off choice is remembered per video.
- Setup wizard: downloads and launches the Ollama installer, detects Ollama, downloads the model with progress, runs a test translation.
- Popup with status, target language, Ollama address, model, subtitle size, dual subtitles and auto-translate.
- Keyboard shortcut `Alt+Shift+P`.
- English and Polish user interface. It follows the browser language by default and can be changed in the popup.
- Unit and end-to-end tests (Playwright, mocked YouTube page and Ollama).

[Unreleased]: https://github.com/wojciechkaluzny-ctrl/privatesubs/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/wojciechkaluzny-ctrl/privatesubs/releases/tag/v1.0.0
