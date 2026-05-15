# Changelog

All notable changes to Smart Media Notes are documented here.

The project started on 2026-05-14 and was developed over two days of intensive iteration.

---

## [2026-05-15] — Configurable Media Formats + Voice Bar Overhaul

### Added
- **Configurable media formats**: New `videoFormats` / `audioFormats` settings (comma-separated), together with dynamic `setMediaFormats()` / `getVideoFormats()` utilities that rebuild `MEDIA_EXTENSIONS` and file-extension regex at runtime on settings load
  - File picker accept attribute dynamically generated from configured formats
  - `src/settings.ts`: New input fields in the settings tab
  - `src/utils.ts`: Exported `DEFAULT_VIDEO_FORMATS`, `DEFAULT_AUDIO_FORMATS`, plus dynamic format functions
- **`m4v` format support**: Added to `DEFAULT_VIDEO_FORMATS` and system MIME mapping
- **Voice bar countdown**: Shows total duration when idle, countdown (`-mm:ss`) during playback
- **Timestamp collection (Saved Media)**: Auto-tracks every `\`\`\`timestamp-url` creation with note path, title, and source label
- **Saved Media section** in the Smart Media Library sidebar:
  - Scrollable list of recently saved media, newest first
  - Click entry to jump to the note and reopen media
  - Add/remove tags with inline editor (click "+tag" to add, click existing tag to remove)
  - Remove entries from collection via ✕ button
  - Deduplication by `url + notePath`, capped at max 100 entries
- **Compact voice-bar UI**: Smaller, cleaner layout for the inline audio player with duration display

### Changed
- Voice bar transforms from duration display to countdown during playback
- Waveform bar inactive opacity reduced from 0.5 → 0.35 for cleaner idle state

### Fixed
- **Media Folder scanning crash**: `getMediaFilesInFolder()` `readdirSync` catch block changed from `return` to `entries = []`, preventing permission- or cloud-path errors on subdirectories from breaking the entire tree scan
- **esbuild config**: Correctly configured to bundle React dependencies (prevents runtime errors in production build)

---

## [2026-05-14] — Phase 3: Dictation Mode + UI Polish

### Added
- **Dictation mode for language learning**: New setting to enable dictation — shows only subtitles (hides text), uses prev/next segment navigation, loop count, and gap settings
- **Configurable dictation settings**:
  - Loop count: number of times to repeat a segment before advancing
  - Loop gap: pause duration between repeats
- **Subtitle overlay font size setting**: Small/medium/large/xlarge options for video subtitle overlay
- **Comprehensive source code comments**: Detailed JSDoc annotations throughout `main.ts`, `utils.ts`, and React components for learning/forks

### Changed
- **Subtitle overlay unified**: Both video and audio now use the same inline banner approach (no separate floating overlays)
- **Audio subtitle banner v3**: 18px text, 14px pill timestamp, gradient background
- **Larger audio banner font**: 13px → 15px body, 10px → 12px timestamp with accent color
- **Dictation UX**: Subtitle browser stays visible during dictation, only the main text area is hidden
- **Subtitle browser click behavior**: Clicking a subtitle line now properly switches the active segment during dictation

### Fixed
- **Banner layout jitter resolved** (3 commits):
  1. Clamp subtitle text to 2 lines max via CSS
  2. Lock banner height to exactly 4.5em (min-height = max-height = 4.5em)
  3. Always render a DOM placeholder, never remove from DOM (prevents React reflow)
- **Audio detection**: Local file paths now correctly detected as audio
- **Audio subtitle overlay**: Uses inline banner below controls instead of covering them
- **Audio UI**: Fixed audio mode styles + subtitleLibrary `data.json` bloat (blob URLs leaving the data structure on disk)
- **YouTube/streaming URLs**: Fixed regex validation that was incorrectly rejecting valid stream URLs
- **`data.json` bloat**: Deduplicate subtitleLibrary blob URL entries to prevent the settings file from growing unbounded

### Removed
- **Live transcription feature** (removed as it was broken — the Web Speech API recognition was unreliable in Obsidian's Electron context)
- **Temp debug file** cleaned up

---

## [2026-05-14] — Initial Release

### Initial features

- 🎬 **Media Player** — Open video/audio from URLs, vault files, or local system paths in a split pane
- ⏱ **Timestamp Notes** — Insert ``\`\`\`timestamp`` code blocks that seek the player on click
- 📝 **Subtitle Import** — Import `.srt` / `.vtt` files and display synced subtitles alongside playback
- 🎤 **Voice Recording** — Record audio directly into notes with optional `\`\`\`voice-bar` code block output
- 📻 **RSS Podcast Browser** — Subscribe to podcast feeds and browse episodes in the sidebar
- 📁 **Vault Media Browser** — Browse and play media files from vault folders or local directories
- 🎯 **Subtitle Notes** — Insert the current subtitle line into your note with configurable template
- **Smart Media Library**: Sidebar panel for RSS subscriptions, media folder browsing, and saved media
- **Build optimization**: Production React build with esbuild tree-shaking; 1.35 MB → 259 KB (-80%)
- **Custom code blocks**: `\`\`\`timestamp`, `\`\`\`timestamp-url`, `\`\`\`voice-bar` rendered in reading mode
- **Settings**: Title templates, colors, seek interval, voice recordings folder, subtitle template, overlay/browser toggles, RSS subscriptions, media folders
