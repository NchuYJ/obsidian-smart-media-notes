# Smart Media Notes

An [Obsidian](https://obsidian.md) plugin for media-powered note-taking. Open videos and audio, insert timestamps, import subtitles, record voice notes, browse RSS podcasts, and manage vault media — all from inside your notes.

## Features

- 🎬 **Media Player** — Open video/audio from URLs, vault files, or local system paths in a split pane
- ⏱ **Timestamp Notes** — Insert ```` ```timestamp ```` code blocks that seek the player on click
- 📝 **Subtitle Import** — Import `.srt` / `.vtt` files and display synced subtitles alongside playback
- 🎤 **Voice Recording** — Record audio directly into notes with optional live transcription
- 📻 **RSS Podcast Browser** — Subscribe to podcast feeds and browse episodes in the sidebar
- 📁 **Vault Media Browser** — Browse and play media files from vault folders or local directories
- 🎯 **Subtitle Notes** — Insert the current subtitle line into your note for language learning

## Installation

### From GitHub

1. Download `main.js` and `manifest.json` from the [latest release](../../releases)
2. Copy them into `{vault}/.obsidian/plugins/smart-media-notes/`
3. Reload Obsidian and enable the plugin in Settings → Community Plugins

### Manual Build

```bash
git clone https://github.com/NchuYJ/obsidian-smart-media-notes.git
cd obsidian-smart-media-notes
npm install
npm run build
```

Then copy `main.js` and `manifest.json` to your vault's `.obsidian/plugins/smart-media-notes/` folder.

## Usage

### Open Media

1. Select a media URL or vault file path in your note
2. Use the command **"Open media player"** or the library ribbon icon
3. The player opens in a split pane

### Insert Timestamps

While media is playing, use **"Insert timestamp"** to drop a clickable timestamp into your note:

````markdown
```timestamp
01:23
```
````

### Import Subtitles

1. Open a video/audio in the player
2. Use **"Import subtitle file"** to load a `.srt` or `.vtt` file
3. Subtitles appear below the player and stay in sync

### Voice Recording

- **"Start voice recording"** — begins recording from your microphone
- **"Stop voice recording"** — saves the recording as ```` ```voice-bar ```` block with optional transcription

### RSS Feeds

Add RSS podcast URLs in plugin settings (one per line, with optional title):

```
Office Ladies | https://feeds.megaphone.fm/office-ladies
```

Browse episodes in the **Smart Media Library** sidebar panel.

### Custom Code Blocks

The plugin renders three custom code blocks in reading mode:

| Block | Purpose |
|---|---|
| ```` ```timestamp ```` | Clickable time seek button |
| ```` ```timestamp-url ```` | Clickable media URL button |
| ```` ```voice-bar ```` | Inline audio player with waveform |

## Settings

| Setting | Description |
|---|---|
| Title | Template inserted when opening media (`<br>` for newlines) |
| URL / Timestamp Colors | Button and text colors for code blocks |
| Seek Interval | Forward/backward jump duration |
| Voice Recordings Folder | Vault path for saved recordings |
| Subtitle Template | Format for inserted subtitle notes (`{time}`, `{text}`) |
| Live Transcription | Enable real-time speech recognition |
| Subtitle Overlay / Browser | Show subtitles on video or as scrollable list |
| RSS Subscriptions | Podcast feed URLs |
| Media Folders | Vault or system paths to browse for media files |
| Auto Insert Library Note | Insert timestamp-url + source when clicking library items |

## Development

```bash
# Install dependencies
npm install

# Development build (with sourcemaps)
npm run dev

# Production build (minified)
npm run build
```

### Project Structure

```
src/
├── main.ts                  # Plugin entry point, commands, modals
├── settings.ts              # Settings tab UI + defaults
├── utils.ts                 # Subtitle parsing, time formatting, URL helpers
└── view/
    ├── VideoContainer.tsx   # React media player with subtitle overlay
    └── VideoView.tsx        # Obsidian ItemView for player + library sidebar
```

### Tech Stack

- **Obsidian API** — Plugin lifecycle, views, commands, settings
- **React 18** — UI components (`react`, `react-dom/client`)
- **react-player** — Multi-source media playback
- **esbuild** — Fast bundler with tree-shaking and minification
- **TypeScript** — Type-safe development

### Build Optimizations

The production build applies:
- React production mode (`NODE_ENV=production`)
- Tree-shaking (unused react-player providers are eliminated)
- Minification
- `obsidian` marked as external (provided by the app)

**Bundle size: ~259 KB** (down from 1.35 MB in the unbundled dev build).

## License

MIT
