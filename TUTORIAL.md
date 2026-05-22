# Smart Media Notes Tutorial

This tutorial focuses on the fastest way to start taking video notes with Smart Media Notes.

## 1. Your First Video Note

Create a note and add a `timestamp-url` block:

````markdown
```timestamp-url
My lesson video | https://www.youtube.com/watch?v=example
```
````

You can use:

- a web URL
- a vault media path
- a desktop file path

Then click the rendered button or run:

`Open media player (copy url or path and use hotkey)`

## 2. Insert Timestamps While Watching

While the media is playing, run:

`Insert timestamp based on videos current play time`

This inserts:

````markdown
```timestamp
02:15
```
````

If you want a short heading with the timestamp, use:

````markdown
```timestamp
#Vocabulary
02:15
```
````

In reading mode, clicking the timestamp jumps the active player.

## 3. Convert Existing Note Times

If you already typed plain time text such as:

```text
1:23
12:08
1:02:03
```

select it and run:

`Convert selected time text to timestamp block`

This is especially useful when:

- the player cannot report exact current time
- you are working from a mobile device
- you are reviewing notes after watching

## 4. Import Subtitles

1. Open the media first.
2. Run `Import subtitle file for current media`.
3. Pick a `.srt` or `.vtt` file.

After import, Smart Media Notes can:

- show the current subtitle under the video
- show a subtitle browser below the player
- jump when you click a subtitle line
- insert the current subtitle into the note

## 5. Use yt-dlp for Mobile-Friendly Video Notes

This is one of the most important beta workflows.

### Why use it

Some websites give you a page link, not a raw media file. On mobile, those page links often open an external app instead of staying inside Obsidian.

Smart Media Notes can use `yt-dlp` on desktop to resolve a direct stream URL, then save that mapping into the vault for later reuse.

### How to do it

1. Install `yt-dlp` on desktop.
2. Open plugin settings.
3. Enable `Use yt-dlp direct URL map`.
4. Confirm `yt-dlp executable path` is correct.
5. Select your video page URL in the note.
6. Run:
   `Resolve direct URL with yt-dlp`

If the resolve succeeds, the mapping is written to:

```text
Subtitles/smart-media-notes-direct-url-map.json
```

If your vault syncs to mobile, that mapping can sync too.

### Result

Now the same note can often be reopened on mobile using Obsidian's own player instead of leaving the app.

## 6. Mobile Timestamp Rail

When a player opens on mobile, the note area can become narrow.

Smart Media Notes can replace that squeezed note area with a timestamp rail so you can still work comfortably.

### What it does

- shows timestamp buttons for quick jumping
- can show nearby note preview
- can switch into edit mode by command

### Useful commands

- `Toggle mobile timestamp rail`
- `Toggle mobile timestamp rail edit mode`

### Preview vs edit

By default, expanding a timestamp preview only shows nearby note content.

It does **not** jump straight into editing.

When you really want to edit from the rail, run:

`Toggle mobile timestamp rail edit mode`

Then expand a timestamp and the preview area becomes editable.

## 7. Smart Media Library

Open:

`Open media library sidebar`

The library is your control center for media notes.

It can manage:

- Saved Media
- Subtitles
- RSS Subscriptions
- Media Folders

### Saved Media

Saved Media entries come from your notes and tracked openings.

Each item can help you:

- reopen the media
- jump to linked timestamps
- upload or replace subtitles
- choose `Direct` or `Original` playback mode

### Subtitles

The library can show:

- subtitle files mapped to media
- unused subtitle files
- missing mappings

This makes it easier to keep the vault clean over time.

## 8. Reconcile When Things Change

Run these commands after deleting or updating notes, URLs, or subtitle files:

- `Reconcile saved media collection`
- `Reconcile synced subtitle index`

These commands help keep the library and subtitle mapping files accurate.

## 9. Voice Notes and Dictation

### Voice notes

Run:

- `Start voice recording`
- `Stop voice recording and save note`

The plugin stores the audio in your vault and inserts a `voice-bar` block into the note.

### Dictation mode

Turn it on with:

`Toggle dictation mode`

Then you can:

- repeat the current subtitle segment
- move to the previous or next segment
- type what you hear
- compare your answer with:
  `Reveal dictation answer (compare with selected text)`

## 10. Recommended Setup

For a strong daily setup:

1. Set `Subtitle storage folder`
2. Enable `Subtitle overlay`
3. Enable `Subtitle browser`
4. Enable `Mobile timestamp rail`
5. Enable `Mobile timestamp note preview`
6. Enable `Use yt-dlp direct URL map`
7. Add your common vault media folders

## 11. Troubleshooting

### The player opens but nothing plays

- The site may block direct playback
- The resolved direct URL may have expired
- The site may require cookies, headers, or unsupported streams
- Switch the saved item back to `Original` mode in the library if needed

### Mobile still opens an external app

- Confirm the source actually has a resolved direct URL
- Confirm the vault synced `smart-media-notes-direct-url-map.json`
- Refresh the direct URL from desktop if the old one expired

### Subtitles do not appear

- Make sure the subtitle file contains cues
- Reimport the subtitle file
- Check whether the current media matches the subtitle mapping
- Run `Reconcile synced subtitle index`

### The library feels out of sync

Run:

- `Reconcile saved media collection`
- `Reconcile synced subtitle index`

## 12. Best Practice

For long-term media study, the cleanest workflow is:

1. Put one `timestamp-url` block near the top of the note
2. Keep all related `timestamp` blocks under that media section
3. Import subtitles early
4. Use the library to manage direct/original playback and subtitle files
5. Use `yt-dlp` on desktop so mobile stays usable later
