# Cider Mic Companion

This is a tiny macOS menubar companion app that captures microphone audio and
streams PCM16 mono frames over a local WebSocket for the plugin to consume.

## Build and Run

1. Open a terminal in `companion/CiderMicCompanion`.
2. Build and run:

```sh
swift run
```

The app appears as a menubar item named `Mic`. It will request microphone
access on first run. When launched via `swift run`, macOS may associate the
permission with Terminal. For a proper app bundle, open
`companion/CiderMicCompanion/Package.swift` in Xcode and run it as a macOS app.

## Notes

- WebSocket server listens on `ws://127.0.0.1:17890`.
- It sends a JSON hello frame:

```json
{"type":"hello","sampleRate":44100,"channels":1,"format":"pcm16","frameSize":1024}
```

- Audio frames are PCM16-LE mono.
