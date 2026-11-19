# KiteChat

A fully local, multi-provider AI chat box for Android. Refactored from [deepseek-ai/chat-demo](https://github.com/deepseek-ai/chat-demo) (MIT), built with Capacitor 7 + React 18 + TypeScript.

[中文](README.zh-CN.md) · [Download site](https://j4uxi2o.github.io/KiteChat/) · [Releases](https://github.com/J4uXi2o/KiteChat/releases)

## Features

- **Multi-provider**: chat / vision / image-gen / titles / web search / speech (ASR+TTS) bound per feature slot; presets for DeepSeek, OpenAI, SiliconFlow, TokenRhythm, Ollama and more, plus any custom OpenAI/Anthropic-compatible endpoint.
- **Fully local**: chats, attachments and API keys stay on device (localStorage + IndexedDB); network goes only to the APIs you configure. No accounts, no telemetry, no cloud sync.
- **One-click onboarding**: paste a single DeepSeek key on first launch to provision chat, vision, titles, web search and voice input/read-aloud.
- **WeChat-style voice**: hold to talk, slide up to cancel, release to auto-transcribe and send; voice catalogs follow each vendor's official docs, with custom voice IDs.
- **Attachments & links**: image / PDF / Word parsing; pasted URLs are fetched as context (user-message links only, private-network addresses blocked).
- **Image generation**: size/count inferred by the chat model from your wording (prompt untouched); reference-image img2img across vendors.
- **UX**: light/dark themes with custom palette, native text selection & copy, long-press menu, completion notifications, Android share intake, stop = real request cancellation.
- **Security**: keys never logged or exported; cross-host redirects strip Authorization; path-traversal-safe file saves; sanitized rendering (mermaid strict, KaTeX untrusted HTML disabled).

## Download

- Website: <https://j4uxi2o.github.io/KiteChat/>
- GitHub Releases: direct APK downloads; overwrite installs keep your data (same signing certificate).

## Build

Requires Node 20+, JDK 17, Android SDK 35.

```bash
npm install
npm run build          # web assets → dist/
npx cap sync android
cd android && ./gradlew assembleRelease
```

Signing material is **never committed**: locally provide `android/signing.properties` (see `signing.properties.example`) plus your keystore; CI restores it from repository Secrets (`KEYSTORE_BASE64` / `KEYSTORE_PASSWORD` / `KEY_ALIAS` / `KEY_PASSWORD`). Without signing material an unsigned APK is produced.

## Release

Tag to release: `git tag v1.14 && git push origin v1.14`. CI builds the signed APK and creates a GitHub Release; the in-app "Settings → About → Check for updates" reads the latest Release.

## Feedback

- Email: 58468680@qq.com
- QQ group: 195425971
- Issues: this repository

## License

[AGPL-3.0](LICENSE) — the strongest copyleft: any distributed or network-service derivative must release its complete source under the same license. The upstream chat-demo MIT notice is retained in file headers and the LICENSE addendum.