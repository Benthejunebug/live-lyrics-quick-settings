# Live Lyrics Quick Settings

A Cider Music Player plugin that adds a "Quick Settings" button to the top-right of the application's chrome. This button opens a bubble menu with a slider to adjust the lyrics offset in real-time, allowing you to fine-tune lyric synchronization.

## Features

- **Real-time Lyrics Offset**: Adjust the lyrics offset from -10s to +10s directly from the top bar.
- **Scroll to Adjust**: Hold `Alt` (default) and scroll on the lyrics view to adjust the offset.
- **Auto Sync**: Click **Auto Sync** to automatically detect the delay between Cider's internal audio and your speakers via the microphone, then apply the offset.

## Auto Sync

The Auto Sync feature captures a short sample from both Cider's audio output and your microphone, then cross-correlates the two to determine the playback delay.

- **Mic permission required** — your browser/app will prompt for microphone access the first time.
- **Works best with speakers** — the mic needs to hear the same audio that Cider is playing. Headphones won't produce a delay to detect.
- **Undo** — after auto-sync applies an offset, an Undo link appears for ~10 seconds to revert.

## Installation

1. Build the plugin:
   ```bash
   npm run build
   ```
2. Copy the generated file from `dist/` to your Cider plugins directory.
   - Windows: `%APPDATA%\C2Windows\plugins`
   - macOS: `~/Library/Application Support/sh.cider.electron/plugins`
   - Linux: `~/.config/sh.cider.electron/plugins`

## Configuration

You can configure the "Scroll to Adjust" feature in the plugin settings:
- **Enabled**: Toggle the feature on/off.
- **Modifier Key**: Choose between Alt, Control, Meta, or Shift.
- **Sensitivity**: Adjust how fast the offset changes when scrolling.

