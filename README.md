# Live Lyrics Quick Settings

A Cider Music Player plugin that adds a "Quick Settings" button to the top-right of the application's chrome. This button opens a bubble menu with a slider to adjust the lyrics offset in real-time, allowing you to fine-tune lyric synchronization.

## Features

- **Real-time Lyrics Offset**: Adjust the lyrics offset from -5s to +15s directly from the top bar.
- **Scroll to Adjust**: Hold `Alt` (default) and scroll on the lyrics view to adjust the offset.
- **Auto Sync (Beta)**: Automatically estimate the offset using your microphone while music is playing.

## Auto Sync

Auto Sync listens to your mic for a short moment and compares it with the internal audio stream to estimate the lyrics delay. It works best with speakers (not headphones) so the mic can hear playback. You’ll be prompted for mic permission the first time, and the feature may fail if playback is too quiet or no track is playing.

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
