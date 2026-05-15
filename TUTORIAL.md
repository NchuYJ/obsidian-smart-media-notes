# Smart Media Notes Tutorial

This tutorial walks through the most useful workflows in Smart Media Notes.

## 1. Open Your First Media Source

### From a web URL

Add a line like this to a note:

```text
https://example.com/audio.mp3
```

Select it and run:

`Open media player (copy url or path and use hotkey)`

### From a vault file

Add a vault-relative path like:

```text
Attachments/audio/lesson-01.mp3
```

Select it and run the same command.

### From a local system file

On desktop, you can also use a direct file path:

```text
C:\Users\YourName\Music\lesson-01.mp3
```

## 2. Insert Clickable Timestamps

While media is playing, run:

`Insert timestamp based on videos current play time`

This inserts:

````markdown
```timestamp
02:15
```
````

In reading mode, clicking the timestamp jumps the active player.

## 3. Save a Reopenable Media Block

Use a `timestamp-url` block when you want a note to permanently keep a launchable media reference:

````markdown
```timestamp-url
Episode 12 | https://example.com/podcast.mp3
```
````

You can also use a vault path or local file path.

## 4. Import Subtitles

1. Open the media first.
2. Run `Import subtitle file for current media`.
3. Pick a `.srt` or `.vtt` file.

After import:

- the subtitle overlay can appear during playback
- the subtitle browser can appear below the player
- clicking subtitle lines jumps playback

## 5. Insert the Current Subtitle Into Notes

When playback is on a subtitle line, run:

`Insert current subtitle with timestamp`

This uses your subtitle template from settings.

## 6. Use the Smart Media Library

Open:

`Open media library sidebar`

The library includes:

- Saved Media
- RSS Subscriptions
- Media Folders

### Saved Media

Saved Media is built from the `timestamp-url` blocks in your notes and from tracked openings.

Use:

`Reconcile saved media collection`

if you want to rebuild the library from your vault notes.

### RSS

Add RSS feeds in settings, one per line:

```text
Office Ladies | https://feeds.megaphone.fm/office-ladies
```

Then open the library sidebar and browse episodes.

### Media Folders

In settings, add:

- vault folder paths
- or desktop system folder paths

Examples:

```text
Attachments/audio
English/listening
C:\Users\YourName\Music
```

## 7. Record Voice Notes

Run:

- `Start voice recording`
- `Stop voice recording and save note`

The plugin stores the audio file in your configured recordings folder and inserts a `voice-bar` block into the note.

## 8. Use Dictation Mode

Dictation mode is designed for listening and language practice.

Turn it on with:

`Toggle dictation mode`

Then you can:

- repeat the current subtitle segment
- move to the previous segment
- move to the next segment
- type what you hear into your note
- select your typed answer and run:

`Reveal dictation answer (compare with selected text)`

## 9. Recommended Setup

For a good daily workflow:

1. Set `Subtitle storage folder`
2. Set `Voice recordings folder`
3. Add your common RSS feeds
4. Add your common media folders
5. Enable `Subtitle overlay`
6. Enable `Subtitle browser`

## 10. Troubleshooting

### The player opens but nothing plays

- Check whether the URL is directly playable
- Some websites block embedding or cross-origin playback
- Try opening the direct media file URL instead of the page URL

### Local system files do not load

- Confirm the path is valid
- Confirm the file extension is included in plugin settings
- Desktop usage is recommended for system file workflows

### Subtitles do not appear

- Make sure the subtitle file actually contains cues
- Reimport the subtitle file
- Check whether the currently open media matches the subtitle binding

### The library feels out of sync

Run:

`Reconcile saved media collection`

## 11. Best Practice

Use `timestamp-url` blocks for sources you want to keep revisiting, and plain `timestamp` blocks for note anchors inside a single session. That gives you a clean mix of reusable media references and precise in-note playback points.
