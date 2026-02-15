# Live Lyrics Quick Settings

A Cider Music Player plugin that adds a "Quick Settings" button to the top-right of the application's chrome. This button opens a bubble menu with a slider to adjust the lyrics offset in real-time, allowing you to fine-tune lyric synchronization.

## Features

- **Real-time Lyrics Offset**: Adjust the lyrics offset from -10s to +10s directly from the top bar.
- **Scroll to Adjust**: Hold `Alt` (default) and scroll on the lyrics view to adjust the offset.
- **Auto Sync (Mic Capture)**: Use the Auto Sync button to listen briefly and estimate the best offset automatically.

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

## Auto Sync Notes

- Works best with speakers (not headphones) so the microphone can hear playback.
- Requires microphone permission the first time you use it.
