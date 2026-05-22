# Smart Media Notes

Smart Media Notes is an [Obsidian](https://obsidian.md) plugin for serious video and audio note-taking.

It turns Obsidian into a media study workspace where you can:

- open video and audio beside your notes
- bind notes to a media source with `timestamp-url`
- insert clickable `timestamp` blocks while you study
- import subtitles and jump by subtitle line
- manage saved media, subtitles, RSS feeds, and media folders in one library
- keep working on mobile instead of breaking your flow

This project builds on [ObsidianTimestampNotes](https://github.com/juliang22/ObsidianTimestampNotes) by [@juliang22](https://github.com/juliang22), then expands it into a full media-notes workflow for language learning, research, lectures, interviews, podcasts, and long-form video study.

## Why This Beta Matters

This beta focuses on one big goal:

**make video note-taking feel native inside Obsidian, including on mobile**

The newest workflow highlights:

- Better support for `.m3u8` / HLS playback
- Better support for Bilibili links
- Subtitle overlay plus subtitle browser
- Smart Media Library for saved media and subtitle management
- Mobile timestamp rail for quick timestamp jumping while the player is open
- Optional `yt-dlp` direct URL resolution for supported sites

That last point is especially important.

For some sites, especially YouTube and other page-based video sources, Smart Media Notes can use `yt-dlp` on desktop to resolve a direct playable stream URL, save that mapping into your vault, and let mobile Obsidian reuse it later.

That means your workflow can become:

1. Resolve the direct URL once on desktop
2. Sync the vault
3. Open the same video note on mobile
4. Watch inside Obsidian and keep taking notes without jumping out to another app

## Core Workflow

### 1. Bind a note to a media source

Use a `timestamp-url` block:

````markdown
```timestamp-url
Amy-Mashed potato and rice noodles | https://www.youtube.com/watch?v=example
```
````

This creates a reopenable media button in reading mode and gives Smart Media Notes a source to associate with timestamps and subtitles.

### 2. Watch and take notes

While the media is open, run:

`Insert timestamp based on videos current play time`

This inserts:

````markdown
```timestamp
00:42
```
````

You can also add a subhead:

````markdown
```timestamp
#Key idea
00:42
```
````

### 3. Import subtitles

Run:

`Import subtitle file for current media`

Then you can:

- show the current subtitle as an overlay
- browse all subtitle lines below the player
- click a subtitle line to jump playback
- insert the current subtitle into your note

### 4. Reopen later from the library

Open:

`Open media library sidebar`

The library keeps your saved media entries, timestamps, subtitles, RSS subscriptions, vault media folders, and desktop media folders together in one place.

## What It Can Do

- Open media from web URLs, vault files, and desktop file paths
- Play many direct video and audio URLs inside Obsidian
- Play HLS streams from `.m3u8` when the stream allows browser/WebView playback
- Open Bilibili video links and try direct playback when available
- Resolve supported page links to direct streams with `yt-dlp`
- Sync resolved direct URL mappings through the vault
- Insert clickable `timestamp` and `timestamp-url` code blocks
- Convert selected time text into timestamp blocks
- Show subtitle overlay and subtitle browser
- Manage subtitles inside the Smart Media Library
- Record voice notes into the vault
- Browse podcast RSS feeds
- Browse vault media folders
- Browse local desktop media folders
- Use dictation mode for language learning
- Use mobile timestamp rail while the player is open

## Install

### Release Install

1. Download `manifest.json`, `main.js`, and `styles.css` from the latest release.
2. Create this folder in your vault if it does not exist:

```text
.obsidian/plugins/smart-media-notes
```

3. Copy the three files into that folder.
4. Restart Obsidian or reload community plugins.
5. Enable `Smart Media Notes` in `Settings -> Community plugins`.

### Manual Build

```bash
git clone https://github.com/NchuYJ/obsidian-smart-media-notes.git
cd obsidian-smart-media-notes
npm install
npm run build
```

Then copy:

- `main.js`
- `manifest.json`
- `styles.css`

into:

```text
{your-vault}/.obsidian/plugins/smart-media-notes/
```

## yt-dlp Direct Playback

`yt-dlp` is optional, but it unlocks one of the most useful beta workflows.

### What it does

For supported HTTP video page links, Smart Media Notes can ask `yt-dlp` to resolve a direct playable URL and save it into the vault.

This helps when:

- the original link is a page URL, not a raw media URL
- mobile cannot use the normal embedded player
- you want the same note to work across desktop and mobile

### What to do

1. Install `yt-dlp` on your desktop system.
2. In plugin settings, enable:
   `Use yt-dlp direct URL map`
3. If needed, set:
   `yt-dlp executable path`
4. Select a supported HTTP link in a note, then run:
   `Resolve direct URL with yt-dlp`

You can also refresh direct URLs from the Smart Media Library.

### How sync works

Resolved direct URLs are saved into:

```text
Subtitles/smart-media-notes-direct-url-map.json
```

This file lives in your vault, so if your vault syncs across devices, the resolved mapping can sync too.

### Important limitations

- Some sites return direct links that expire and need refresh
- Some sites require headers, cookies, or blocked cross-origin requests
- Some sites only expose streams that Obsidian cannot play directly
- YouTube direct playback is best-effort and depends on what `yt-dlp` can resolve into a browser-playable stream

If direct playback fails, you can switch a saved item back to `Original` mode in the Smart Media Library.

## Mobile Workflow

This beta puts much more emphasis on mobile than older versions.

### Mobile video notes

With a synced direct URL map, supported links can open in Obsidian's own player on mobile instead of always jumping to another app.

### Mobile timestamp rail

When the player squeezes the note area, Smart Media Notes can replace that narrow note pane with a timestamp rail so you can:

- jump through timestamps quickly
- preview nearby note content
- optionally enter edit mode through a command

### Why this matters

It makes mobile note review feel closer to desktop:

- player stays visible
- timestamps stay reachable
- notes stay connected to the media instead of being hidden behind app switches

## Subtitles and Sync

Imported subtitle files are stored in your vault subtitle folder, `Subtitles` by default.

Smart Media Notes also writes a sync index:

```text
Subtitles/smart-media-notes-subtitles.json
```

That lets other devices reconnect media links to subtitle files even when plugin `data.json` is not synced.

Useful maintenance commands:

- `Reconcile synced subtitle index`
- `Reconcile saved media collection`

Use them after deleting or renaming:

- subtitle files
- media links
- video notes
- saved media entries

## Main Features

### Smart Media Player

- supports video and audio
- supports vault files and many direct media URLs
- supports page-link workflows through `yt-dlp`
- supports fallback behavior when embedding is blocked

### Subtitle Tools

- import `.srt` and `.vtt`
- show current subtitle as overlay
- browse subtitle rows below the player
- click subtitle lines to jump
- insert subtitle text into notes
- manage subtitle mappings from the library

### Smart Media Library

The library can manage:

- saved media entries
- timestamps linked to those entries
- subtitle mappings and unused subtitle files
- podcast RSS subscriptions
- vault media folders
- local desktop media folders

### Voice Notes

You can record audio directly into your vault and insert an inline player:

````markdown
```voice-bar
Attachments/voice-notes/voice-note-123456.webm
```
````

### Dictation Mode

Dictation mode is useful for language learning:

- loop the current subtitle segment
- move to previous or next segment
- hide subtitle text while keeping timing anchors
- reveal and compare typed text against the original subtitle

## Commands

Main commands include:

- `Open media player (copy url or path and use hotkey)`
- `Insert timestamp based on videos current play time`
- `Convert selected time text to timestamp block`
- `Open media library sidebar`
- `Import subtitle file for current media`
- `Insert current subtitle with timestamp`
- `Resolve direct URL with yt-dlp`
- `Reconcile saved media collection`
- `Reconcile synced subtitle index`
- `Toggle mobile timestamp rail`
- `Toggle mobile timestamp rail edit mode`
- `Toggle dictation mode`
- `Reveal dictation answer (compare with selected text)`
- `Start voice recording`
- `Stop voice recording and save note`

## Settings

Important settings:

- `Use yt-dlp direct URL map`
- `yt-dlp executable path`
- `Subtitle storage folder`
- `Subtitle overlay`
- `Subtitle browser`
- `Subtitle overlay font size`
- `Mobile timestamp rail`
- `Mobile timestamp note preview`
- `Timestamp display format`
- `Auto insert library note`
- `Include subtitle with timestamp`
- `Timestamp + subtitle template`
- `Video formats`
- `Audio formats`
- `Media folders`

## Best Use Cases

Smart Media Notes is especially good for:

- language learning from subtitled video
- lecture and course notes
- interview review
- documentary study
- podcast study notes
- research workflows that need timestamped evidence

## Tutorial

For a guided walkthrough, see [TUTORIAL.md](./TUTORIAL.md).

## Development

```bash
npm install
npm run dev
npm run build
```

Project structure:

```text
src/
  main.ts
  settings.ts
  utils.ts
  media/
    bilibiliResolver.ts
  view/
    VideoContainer.tsx
    VideoView.tsx
```

## Acknowledgments

Derived from [ObsidianTimestampNotes](https://github.com/juliang22/ObsidianTimestampNotes) by [juliang22](https://github.com/juliang22).

## License

MIT
