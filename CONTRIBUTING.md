# Contributing to PrivateSubs

Thanks for helping! Bug reports, translations and pull requests are all welcome.

## Reporting bugs

Use the **Bug report** issue template. The most useful details are:
- browser and version, operating system,
- Ollama version and model (`ollama list`),
- a link to a video where it happens,
- the message shown in the popup or in the top-left corner of the player.

## Development setup

```bash
git clone https://github.com/wojciechkaluzny-ctrl/privatesubs.git
cd privatesubs
npm install
npx playwright install chromium
```

Load `extension/` with **Load unpacked** (`chrome://extensions` → Developer mode). After you change code, click the reload icon
on the extension card and refresh the YouTube tab.

## Tests

```bash
npm test           # unit tests – fast, no browser needed
npm run test:e2e   # end-to-end in headless Chromium with a fake YouTube page and a mock Ollama
```

Please run both before opening a pull request. The end-to-end tests listen on port `11434`, so stop a running Ollama first,
or run them on a machine without Ollama.

## Code guidelines

- Plain JavaScript, no build step, no runtime dependencies. The `extension/` folder must load as-is.
- Keep the YouTube-specific parts isolated: page hooks in `hook.js`, player DOM in `content.js`.
- Every user-visible text goes into `extension/_locales/*/messages.json` and is read with `ytplT("key", …)`
  (or `data-i18n="key"` in HTML). Don't hard-code UI text.
- Don't use `innerHTML` with dynamic values.

## Adding an interface language

1. Copy `extension/_locales/en/messages.json` to `extension/_locales/<code>/messages.json`
   (use a [Chrome locale code](https://developer.chrome.com/docs/extensions/reference/api/i18n#locales), e.g. `de`, `pt_BR`).
2. Translate the `message` values. Leave the keys and `$P1$`, `$P2$`… placeholders unchanged.
3. Run `npm test`. It checks that every language has the same keys and placeholders as English.
4. Optionally add screenshots: `node scripts/screenshots.js <code>`.

## Releasing (maintainers)

1. Update the version in `extension/manifest.json` **and** `package.json`, and add a section to `CHANGELOG.md`.
2. Commit and push to `main`.
3. Publish: either push a tag (`git tag v1.2.3 && git push --tags`) or open **Actions → Release → Run workflow**.
   The workflow runs the tests, builds `privatesubs-<version>.zip` (plus `privatesubs.zip` for the "latest version" link) and publishes a GitHub release with notes from `CHANGELOG.md`.
