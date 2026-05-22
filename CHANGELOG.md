# Changelog

All notable changes to Smart Media Notes are documented here.

The project started on 2026-05-14 and was developed over two days of intensive iteration.

---

## [1.3.2] — Review Fixes and Mobile Rail Polish

### Changed
- Plugin description wording now avoids the redundant product name in `manifest.json`.
- Release candidate build now uses the native media / iframe player split without the old dynamic script injection player path.

### Fixed
- Mobile timestamp rail now filters timestamps to the currently opened media instead of showing every timestamp on the page.
- Mobile timestamp rail preview now works again after media-based timestamp filtering.

---

## [1.3.0] — Beta: Video Notes, Mobile Playback, and Direct URL Sync

### Added
- Dedicated HLS player path for `.m3u8` streams using native browser support when available and `hls.js` as the fallback.
- Clearer HLS playback error message for streams blocked by browser/WebView support, CORS, or streaming permissions.
- Bilibili video-page detection for `BV` and `av` links, rendered through Bilibili's official embedded player.
- External-open fallback button for embedded platform players, useful on mobile WebView environments where iframe playback is restricted.
- Mobile-friendly player, subtitle, playlist, tag, and library touch sizing.
- Command to convert selected time text such as `1:23` or `1:02:03` into a clickable `timestamp` block.
- Experimental Bilibili direct playback resolver that tries Bilibili API playback URLs before falling back to the embedded player.
- Optional local Bilibili cookie setting for experimental resolver requests.
- External timestamp fallback for YouTube and Bilibili links, opening platform URLs with the selected time when mobile iframe playback is blocked.
- Vault-synced subtitle index at `Subtitles/smart-media-notes-subtitles.json` so imported subtitle mappings can sync across desktop and mobile without syncing plugin `data.json`.
- Vault-synced direct URL map at `Subtitles/smart-media-notes-direct-url-map.json` so resolved page-link playback can sync across desktop and mobile.
- Generic `yt-dlp` direct URL resolver for supported HTTP video page links, with Smart Media Library refresh support and per-item direct/original playback choice.
- Command to reconcile the synced subtitle index after media notes, subtitle files, or timestamp-url links are deleted or changed.
- More readable subtitle filenames based on media identity, original subtitle filename, and a short hash.
- Smart Media Library subtitle management, including mapped and unused subtitle visibility plus delete/update flows from inside the library.
- Mobile timestamp rail with expandable timestamp previews for narrow note panes while the player is open.
- Command to toggle mobile timestamp rail on demand.
- Command to toggle mobile timestamp rail edit mode on demand.

### Changed
- Existing direct media, vault media, audio, YouTube/embed-style links, subtitles, playlist navigation, and timestamp controls continue through the existing player path.
- README and tutorial now focus on video note-taking, mobile workflows, subtitle usage, and `yt-dlp`-based direct playback sync.
- Bilibili embeds no longer use a manual estimated timer; timestamp creation should use selected time text, while timestamp click-to-jump remains supported.
- Bilibili direct playback automatically falls back to the embedded player if the resolved media URL cannot play in Obsidian.
- Mobile player/subtitle layout refined so the player, current subtitle banner, and subtitle browser share the screen more predictably.
- Mobile timestamp preview now opens in read-only preview mode by default, with editing gated behind a dedicated command.
- Saved Media entries now group and show only the timestamps that belong to the nearest related `timestamp-url` section.
- Subtitle overlay text is now selectable and copyable.
- Direct URL cache validity now depends on real playback failure instead of expiring automatically on every restart.

### Fixed
- Duplicate vault copies of the direct URL map no longer fight each other on mobile; the plugin now prefers the better resolved entry and writes the merged result back to existing map files.
- Mobile YouTube opening now checks synced direct URL mappings before falling back to external app open.
- Legacy `smart-media-notes-youtube-direct.json` files are cleaned up so only the unified direct URL map remains active.
- Subtitle index cleanup now updates existing synced index files, preventing deleted or unused subtitle entries from reappearing after refresh or restart.
- Direct playback candidate selection now avoids common audio-only and unsupported YouTube HLS cases more reliably.

---

## [2026-05-15] — Fixes: Voice Bar Duration, Timestamp Collection Connected, Collapsible Library

### Fixed
- **Voice bar duration display**: Added `durationchange` + `canplay` event listeners and 500ms timeout fallback for reliable duration loading in Obsidian's render pipeline. Duration label now hides during playback (countdown shown instead) and restores on end.
- **Timestamp collection connected**: `trackTimestamp()` was fully implemented but **never called** — now correctly invoked from `trigger-player` command, `openLibraryMedia()`, and podcast modal episode selection. Collection auto-refreshes the library view after each addition.

### Changed
- **Timestamps tracked on creation**: When inserting `\`\`\`timestamp-url` blocks via trigger-player, library clicks, or podcast episodes, the entry is automatically added to Saved Media collection.
- **Library sections now collapsible**: RSS Subscriptions and Media Folders sections wrapped in `<details>` elements with summary headers — default to expanded when content exists. Prevents overflow when many feeds/folders are configured.

---

## [2026-05-15] — Saved Media UI Overhaul: Details Collapse, Note Tag Sync, Tag Filter

### Added
- **Saved Media collapsible UI**: Section now uses `<details>` + `<summary>` pattern, matching RSS Subscriptions and Media Folders for visual consistency
- **Note frontmatter tag auto-sync**: `trackTimestamp()` reads the active note's YAML frontmatter `tags` field and merges them into the Saved Media entry on each open. Manual tags are preserved and merged with frontmatter tags.
- **Tag filter bar**: Saved Media now shows a filter bar at the top with all unique tags. Click a tag to filter by it; click "All" to clear. Active tag is highlighted.
- **Tag pills click to filter**: Clicking any tag pill on an entry now activates the tag filter for that tag (instead of removing it as before)

### Fixed
- **flatMap → reduce**: Replaced ES2019 `flatMap` with `reduce(…concat…)` compatible with ES2018 build target — the tag filter bar now correctly collects all tags and filters entries.
- **Tag filter bar UI**: Pills now use `border` instead of background-only style, better matching the Library section aesthetic. Filter bar only renders when there are tags.
- **Sections closed by default**: Removed `section.open = true` from all three Library sections — they now start collapsed to prevent layout overflow in busy vaults.
- **Saved media click no longer re-inserts timestamp**: Added `skipInsert` option to `openLibraryMedia()`. Saved Media entries now open without creating duplicate `\`\`\`timestamp-url` blocks (the note already has one).
- **Frontmatter tag sync now works**: Replaced broken `instanceof this.app.vault.fileClass` check (non-existent property) with simple `if (activeFile)` — tags now correctly sync from note YAML frontmatter.
- **Removed ugly empty state text**: "Media you open via..." banner removed — empty Saved Media section now just shows collapsed with count 0.
- **Reconcile feature**: New `🔄` button in Saved Media header + "Reconcile saved media collection" command. Scans entire vault for `\`\`\`timestamp-url` blocks, resolves them, and rebuilds the Saved Media collection — handles deleted/moved timestamps.
- **Timestamp URL aliases**: `\`\`\`timestamp-url` blocks now support `name | link` format — pipe-separated single line. The alias is displayed as the button text and used as the Saved Media entry title. Backward-compatible with two-line and URL-only formats. New blocks automatically emit `name | link` format.
- **Wrap selection hotkey**: New command `Insert timestamp-url from selection (name \| link)` — select `Name | https://...` text and press hotkey to wrap it in a `\`\`\`timestamp-url` block. `trigger-player` command now also parses `name | link` selections.

### Changed
- Saved Media section UI unified with RSS/Folders (`<details>` with count). `_savedMediaFilterTag` state preserved across re-renders.
- **All library sections now closed by default** (Saved Media, RSS Subscriptions, Media Folders) — prevents layout overflow.
- **Saved Media entries skip timestamp insertion** — clicking an entry opens the note and player without adding a duplicate `timestamp-url` block (since the note already has one).

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
