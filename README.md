# Smart Media Notes

Smart Media Notes is an [Obsidian](https://obsidian.md) plugin for media-based note taking. It lets you open video and audio inside Obsidian, insert clickable timestamps, import subtitles, record voice notes, browse podcast feeds, and keep a reusable media library next to your notes.

This project builds on [ObsidianTimestampNotes](https://github.com/juliang22/ObsidianTimestampNotes) by [@juliang22](https://github.com/juliang22), and extends it with a full media workflow for study, listening practice, research, and review.

## What It Can Do

- Open media from web URLs, vault files, and local system paths
- Insert clickable `timestamp` and `timestamp-url` code blocks
- Import `.srt` and `.vtt` subtitles and keep them synced with playback
- Show a subtitle overlay and subtitle browser below the player
- Record voice notes into your vault as inline `voice-bar` blocks
- Save and reopen frequently used media from a Smart Media Library view
- Browse podcast RSS feeds and launch episodes directly
- Browse vault media folders
- Browse local system media folders on desktop
- Use dictation mode for language learning and listening drills

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

## Quick Start

### Open a media link

1. Put a media URL or vault file path in your note.
2. Select it.
3. Run the command `Open media player (copy url or path and use hotkey)`.

### Insert a timestamp

While media is playing, run:

`Insert timestamp based on videos current play time`

This inserts:

````markdown
```timestamp
01:23
```
````

Clicking the timestamp in reading mode seeks the active player.

### Bind a media source to a note

You can also insert:

````markdown
```timestamp-url
Lesson 01 | https://example.com/audio.mp3
```
````

or:

````markdown
```timestamp-url
https://example.com/audio.mp3
```
````

Clicking the rendered button reopens the media.

## Main Features

### Smart Media Player

- Supports video and audio
- Works with many web URLs through `react-player`
- Works with Obsidian vault files
- Supports direct local system file paths

### Subtitle Support

- Import `.srt` or `.vtt`
- Show current subtitle as an overlay
- Show subtitles in a scrollable browser
- Click a subtitle line to jump playback
- Insert the current subtitle into your note

### Smart Media Library

The library view can show:

- saved media entries from your notes
- podcast RSS subscriptions
- vault media folders
- local system media folders

Saved entries can be filtered by tags and reopened quickly.

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
- hide subtitle text while keeping time anchors
- reveal and compare typed text against the original subtitle

## Commands

Main commands include:

- `Open media player (copy url or path and use hotkey)`
- `Insert timestamp based on videos current play time`
- `Pause player`
- `Seek Forward`
- `Seek Backward`
- `Open local media file`
- `Open media from vault`
- `Open media library sidebar`
- `Import subtitle file for current media`
- `Insert current subtitle with timestamp`
- `Start voice recording`
- `Stop voice recording and save note`
- `Toggle dictation mode`
- `Reveal dictation answer (compare with selected text)`
- `Dictation: Previous segment`
- `Dictation: Next segment`
- `Reconcile saved media collection`

## Settings

Important settings:

- `Title`
- `URL Button Color`
- `Timestamp Button Color`
- `Forward time seek`
- `Backwards time seek`
- `Voice recordings folder`
- `Subtitle note template`
- `Subtitle overlay`
- `Subtitle browser`
- `Subtitle overlay font size`
- `Dictation loop count`
- `Dictation gap between repeats`
- `Subtitle storage folder`
- `RSS subscriptions`
- `Video formats`
- `Audio formats`
- `Media folders`
- `Auto insert library note`
- `Include subtitle with timestamp`
- `Timestamp + subtitle template`

## Desktop Notes

The plugin works best on desktop.

System file paths and system folder scanning are primarily intended for desktop workflows. If you only want vault-safe media browsing, use vault media files and vault folders.

## Tutorial

For a more guided walkthrough, see [TUTORIAL.md](./TUTORIAL.md).

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
  view/
    VideoContainer.tsx
    VideoView.tsx
```

## Acknowledgments

Derived from [ObsidianTimestampNotes](https://github.com/juliang22/ObsidianTimestampNotes) by [juliang22](https://github.com/juliang22).

## License

MIT
