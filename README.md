# Live Lyrics Quick Settings

A Cider Music Player plugin that adds a "Quick Settings" button to the top-right of the application's chrome. This button opens a bubble menu with a slider to adjust the lyrics offset in real-time, allowing you to fine-tune lyric synchronization.

## Features

- **Real-time Lyrics Offset**: Adjust the lyrics offset from -5s to +15s directly from the top bar.
- **Scroll to Adjust**: Hold `Alt` (default) and scroll on the lyrics view to adjust the offset.
- **Auto Sync (Beta)**: Automatically estimate the offset using your microphone while music is playing.

## Compatibility

Built against **Cider 4** ("Genten") and [`@ciderapp/pluginkit#cider-4`](https://github.com/ciderapp/pluginkit/tree/cider-4).
Cider 3 is still supported on a best-effort basis: the DOM selectors and theme
variables both carry Cider 3 fallbacks.

## Auto Sync

Auto Sync listens to your mic for a short moment and compares it with Cider's internal
audio stream to estimate the lyrics delay. It works best with speakers (not headphones)
so the mic can hear playback. You'll be prompted for mic permission the first time, and
the feature may fail if playback is too quiet or no track is playing.

### Cider 4 requirements

Cider 4 plays through the MKLite engine and only builds a WebAudio graph for some output
modes. Auto Sync taps that graph, so it needs:

- **Settings > Audio > Cider Audio** enabled, and
- **Atmos** set to binaural or off — in **Atmos passthrough** mode playback bypasses the
  WebAudio graph entirely and there is nothing to tap.

If either is unavailable, Auto Sync now fails immediately with a message naming the
cause instead of waiting out a timeout.

### Mic Companion (macOS)

If the host app can't request microphone access, use the companion app in `companion/`
to provide mic audio over localhost. See `companion/README.md` for build and run
instructions.

## Installation

1. Install dependencies with the pinned package manager:
   ```bash
   corepack pnpm install
   ```
2. Build the plugin:
   ```bash
   corepack pnpm build
   ```
3. Copy the contents of `dist/` (`plugin.js` and `plugin.yml`) into a folder named after
   the plugin identifier inside Cider's plugins directory:
   `<app data>/plugins/com.antigravity.live-lyrics-quick-settings/`

   Cider 4 stores its app data under `sh.cider.genten`:
   - Windows: `%APPDATA%\sh.cider.genten\plugins`
   - macOS: `~/Library/Application Support/sh.cider.genten/plugins`
   - Linux: `~/.config/sh.cider.genten/plugins`

   To open that folder without guessing the path, use Cider's `cider://openappdata`
   protocol link. (Cider 3 used `sh.cider.electron` instead.)
4. Restart Cider.

Alternatively, build the release zip (below) and install it through
**Settings > Plugins**, or serve it and use `cider://install-plugin?url=<zip-url>`.

## Release Packaging

Build the marketplace zip with:

```bash
corepack pnpm prepare-marketplace
```

The zip is written to `publish/`.

## Configuration

You can configure the "Scroll to Adjust" feature in the plugin settings:
- **Enabled**: Toggle the feature on/off.
- **Modifier Key**: Choose between Alt, Control, Meta, or Shift.
- **Sensitivity**: Adjust how fast the offset changes when scrolling.
