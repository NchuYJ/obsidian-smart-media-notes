import {
  App,
  Editor,
  FuzzySuggestModal,
  MarkdownView,
  Modal,
  Notice,
  Plugin,
  WorkspaceLeaf,
  MarkdownPostProcessorContext,
  normalizePath,
  requestUrl,
  TFile,
} from "obsidian";

import {
  SmartMediaNotesSettings,
  DEFAULT_SETTINGS,
  TimestampPluginSettingTab,
  TimestampEntry,
} from "./settings";
import { VideoView, MediaLibraryView, VIDEO_VIEW, LIBRARY_VIEW } from "./view/VideoView";
import {
  formatSecondsAsTimestamp,
  parseTimestampToSeconds,
  parseSubtitleFile,
  urlToSafeName,
  normalizeMediaCandidate,
  isPlayableMedia,
  MEDIA_EXTENSIONS,
  isAudioFile,
  setMediaFormats,
  getVideoFormats,
  compareDictation,
  formatDictationResult,
  SubtitleCue,
  parseTimestampUrlBlock,
  ResolvedMedia,
  MediaFileEntry,
  PodcastEpisode,
} from "./utils";

interface PlayerHandle {
  seekTo(seconds: number): void;
  getCurrentTime(): number;
  props?: {
    playing?: boolean;
  };
}

interface VideoEphemeralState {
  url: string;
  setupPlayer: (player: PlayerHandle, setPlaying: (playing: boolean) => void) => void;
  setupError: (err: string) => void;
  saveTimeOnUnload: () => Promise<void>;
  start: number;
  subtitles: SubtitleCue[];
  onSubtitleChange: (cue: SubtitleCue | null) => void;
  showSubtitleOverlay: boolean;
  showSubtitleBrowser: boolean;
  subtitleOverlayFontSize?: string;
  dictationMode?: boolean;
  dictationLoopCount?: number;
  dictationLoopGap?: number;
  playlist?: { files: TFile[]; currentIndex: number } | null;
  onNavigatePlaylist?: (file: TFile) => Promise<void>;
  isAudio?: boolean;
}

interface PersistedSettingsData extends Partial<SmartMediaNotesSettings> {
  urlStartTimeMap?: Record<string, number>;
}

const ERRORS: Record<string, string> = {
  INVALID_URL:
    "\n> [!error] Invalid Media URL\n> The highlighted link is not a valid video or audio url. Please try again with a valid link.\n",
  NO_ACTIVE_VIDEO:
    "\n> [!caution] No Media Open\n> Open a video or audio file before using this hotkey.\n Highlight a media link and use 'Open media player' or pick a file from the vault.\n",
  NO_ACTIVE_SUBTITLE:
    "\n> [!info] No Active Subtitle\n> Import a subtitle file first, then move playback to a spoken line before inserting subtitle notes.\n",
  VOICE_RECORDING_UNAVAILABLE:
    "\n> [!warning] Voice Recording Unavailable\n> Your environment does not expose microphone recording APIs for this Obsidian window.\n",
};

export default class SmartMediaNotesPlugin extends Plugin {
  settings!: SmartMediaNotesSettings;
  player: PlayerHandle | null = null;
  setPlaying: ((playing: boolean) => void) | null = null;
  currentUrl: string | null = null;
  currentUrlKey: string | null = null;
  currentSubtitle: SubtitleCue | null = null;
  editor: Editor | null = null;
  mediaRecorder: MediaRecorder | null = null;
  recordedChunks: Blob[] = [];

  // 听写模式
  dictationMode: boolean = false;
  dictationLoopTimer: number | null = null;

  async onload(): Promise<void> {
    this.registerView(VIDEO_VIEW, (leaf) => new VideoView(leaf));
    this.registerView(
      LIBRARY_VIEW,
      (leaf) => new MediaLibraryView(leaf, this),
    );

    await this.loadSettings();

    // Reconcile saved media from vault notes
    this.addCommand({
      id: "reconcile-saved-media",
      name: "Reconcile saved media collection",
      callback: async () => {
        await this.reconcileTimestampCollection();
        await this.refreshLibraryView();
      },
    });
    this.addRibbonIcon("library", "Open Smart Media Library", () => {
      void this.activateLibraryView();
    });

    // timestamp code block processor
    this.registerMarkdownCodeBlockProcessor(
      "timestamp",
      (source: string, el: HTMLElement) => {
        const regExp = /\d+:\d+:\d+|\d+:\d+/g;
        const rows = source.split("\n").filter((row) => row.length > 0);
        rows.forEach((row) => {
          const match = row.match(regExp);
          if (match) {
            const div = el.createEl("div");
          const button = div.createEl("button");
          button.innerText = match[0];
          button.setCssProps({
            "background-color": this.settings.timestampColor,
            color: this.settings.timestampTextColor,
          });
            button.addEventListener("click", () => {
              const seconds = parseTimestampToSeconds(match[0]);
              if (this.player) this.player.seekTo(seconds);
            });
            div.appendChild(button);
          }
        });
      },
    );

    // timestamp-url code block processor
    this.registerMarkdownCodeBlockProcessor(
      "timestamp-url",
      (source: string, el: HTMLElement) => {
        const p = parseTimestampUrlBlock(source);
        const raw = p.url;
        const alias = p.alias;
        const resolved = this.resolveMediaUrl(raw);
        if (resolved) {
          const div = el.createEl("div");
          const button = div.createEl("button");
          const resolvedDisplay = resolved.displayPath;
          const displayRaw = alias || resolvedDisplay;
          const display =
            displayRaw.length > 55
              ? displayRaw.slice(0, 52) + "..."
              : displayRaw;
          button.innerText = display;
          button.title = alias ? alias + "\n" + resolvedDisplay : resolvedDisplay;
          button.addClass("smn-timestamp-url-btn");
          button.setCssProps({
            "background-color": this.settings.urlColor,
            color: this.settings.urlTextColor,
          });
          button.addEventListener("click", () => {
            void this.activateView(
              resolved.playableUrl,
              this.editor,
              resolved.isVaultFile ? resolved.vaultFile : null,
            );
          });
          div.appendChild(button);
        } else if (this.isPodcastUrl(raw)) {
          const div = el.createEl("div");
          const button = div.createEl("button");
          button.innerText = "🎙 " + raw;
          button.setCssProps({
            "background-color": this.settings.urlColor,
            color: this.settings.urlTextColor,
          });
          button.addEventListener("click", () => {
            new PodcastModal(this.app, this, raw, this.editor!).open();
          });
          div.appendChild(button);
        } else if (/^https?:\/\//i.test(raw)) {
          // 兜底：http/https URL 直接传给播放器（YouTube、流媒体等）
          const div = el.createEl("div");
          const button = div.createEl("button");
          const display = alias || raw.length > 55 ? (alias || raw).length > 55 ? (alias || raw).slice(0, 52) + "..." : (alias || raw) : raw;
          button.innerText = display;
          button.title = alias ? alias + "\n" + raw : raw;
          button.addClass("smn-timestamp-url-btn");
          button.setCssProps({
            "background-color": this.settings.urlColor,
            color: this.settings.urlTextColor,
          });
          button.addEventListener("click", () => {
            void this.activateView(raw, this.editor);
          });
          div.appendChild(button);
        } else {
          if (this.editor) {
            this.editor.replaceSelection(
              this.editor.getSelection() + "\n" + ERRORS["INVALID_URL"],
            );
          }
        }
      },
    );

    // voice-bar code block processor
        this.registerMarkdownCodeBlockProcessor(
      "voice-bar",
      (source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
        const filePath = source.trim();
        if (!filePath) return;
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (!file) {
          el.createEl("span", {
            text: `(missing: ${filePath})`,
            style: { color: "var(--text-error)", fontSize: "12px" },
          });
          return;
        }

        // Compact voice bar with duration display
        const container = el.createEl("div", { cls: "smn-voice-bar" });

        // Play/pause button
        const playBtn = container.createEl("span", {
          text: "\u25B6",
          cls: "smn-voice-bar-play",
        });

        // Waveform bars (shorter, fewer, cleaner)
        const waveContainer = container.createEl("div", {
          cls: "smn-voice-bar-wave",
        });

        const barCount = 14;
        for (let i = 0; i < barCount; i++) {
          const h =
            2 + Math.abs(Math.sin(i * 0.85 + 1.5) * 10 + Math.sin(i * 1.7) * 3);
          const bar = waveContainer.createEl("div", {
            cls: "smn-voice-bar-wave-bar idle",
          });
          bar.setCssProps({ height: `${Math.round(h)}px` });
        }

        // Duration label (mm:ss)
        const durationSpan = container.createEl("span", {
          cls: "smn-voice-bar-duration",
        });
        durationSpan.textContent = "--:--";

        // Current time label (shown during playback)
        const currentSpan = container.createEl("span", {
          cls: "smn-voice-bar-current is-hidden",
        });

        // Delete button
        const deleteBtn = container.createEl("span", {
          text: "\u00D7",
          title: "Delete voice recording",
          cls: "smn-voice-bar-delete",
        });
        deleteBtn.addEventListener("click", async (e) => {
          e.stopPropagation();
          e.preventDefault();
          await this.app.fileManager.trashFile(file);
          const noteFile = this.app.vault.getAbstractFileByPath(ctx.sourcePath);
          if (noteFile) {
            try {
              const content = await this.app.vault.read(noteFile);
              const escaped = filePath.replace(
                /[.*+?${}()|[\]\\]/g,
                "\\$&",
              );
              const regex = new RegExp(
                "```voice-bar\\n" + escaped + "\\n```\\n?",
                "g",
              );
              const newContent = content.replace(regex, "");
              await this.app.vault.modify(noteFile, newContent);
            } catch (_) { /* ignore */ }
          }
          new Notice("Voice recording deleted.");
        });

        // Hidden audio element
        const audio = container.createEl("audio", {
          attr: {
            src: this.app.vault.getResourcePath(file),
          },
          cls: "smn-hidden-audio",
        });

        let playing = false;

        // Format seconds to mm:ss
        function fmtSec(sec: number): string {
          const m = Math.floor(sec / 60);
          const s = Math.floor(sec % 60);
          return m + ":" + (s < 10 ? "0" : "") + s;
        }

        // Show total duration once loaded (with fallback events)
        function updateDuration() {
          if (audio.duration && isFinite(audio.duration) && audio.duration > 0) {
            durationSpan.textContent = fmtSec(audio.duration);
          }
        }
        audio.addEventListener("loadedmetadata", updateDuration);
        audio.addEventListener("durationchange", updateDuration);
        audio.addEventListener("canplay", updateDuration);
        window.setTimeout(updateDuration, 500);

        audio.addEventListener("timeupdate", () => {
          if (audio.duration) {
            // Hide the static duration label during playback, show countdown
            durationSpan.toggleClass("is-hidden", true);
            const remain = audio.duration - audio.currentTime;
            currentSpan.textContent = "-" + fmtSec(remain);
            currentSpan.toggleClass("is-hidden", false);

            const pct = audio.currentTime / audio.duration;
            const bars = waveContainer.querySelectorAll("div");
            const litCount = Math.round(pct * bars.length);
            bars.forEach((bar, i) => {
              const b = bar as HTMLElement;
              b.toggleClass("active", i < litCount);
              b.toggleClass("idle", i >= litCount);
            });
          }
        });

        audio.addEventListener("ended", () => {
          playing = false;
          playBtn.textContent = "\u25B6";
          currentSpan.toggleClass("is-hidden", true);
          durationSpan.toggleClass("is-hidden", false);
          const bars = waveContainer.querySelectorAll("div");
          bars.forEach((bar) => {
            (bar as HTMLElement).removeClass("active");
            (bar as HTMLElement).addClass("idle");
          });
        });

        // Toggle play/pause on click
        container.addEventListener("click", () => {
          if (playing) {
            audio.pause();
            playing = false;
            playBtn.textContent = "\u25B6";
          } else {
            audio.play().catch(() => {});
            playing = true;
            playBtn.textContent = "\u23F8";
          }
        });
      },
    );

    // Commands
    this.addCommand({
      id: "trigger-player",
      name: "Open media player (copy url or path and use hotkey)",
      editorCallback: async (editor: Editor) => {
        const selected = editor.getSelection().trim();
        const parsedSel = parseTimestampUrlBlock(selected);
        const selectedUrl = parsedSel.url || selected;
        const selectedAlias = parsedSel.alias;
        const resolved = this.resolveMediaUrl(selectedUrl);
        if (resolved) {
          void this.activateView(
            resolved.playableUrl,
            editor,
            resolved.isVaultFile ? resolved.vaultFile : null,
          );
          this.settings.noteTitle
            ? editor.replaceSelection(
                "\n" +
                  this.settings.noteTitle +
                  "\n```timestamp-url\n" +
                  (selectedAlias ? selectedAlias + " | " : "") +
                  resolved.displayPath +
                  "\n```\n",
              )
            : editor.replaceSelection(
                "```timestamp-url\n" +
                  (selectedAlias ? selectedAlias + " | " : "") +
                  resolved.displayPath +
                  "\n```\n",
              );
          this.editor = editor;
          void this.trackTimestamp(resolved.playableUrl, {
            displayPath: resolved.displayPath,
            sourceLabel: resolved.isVaultFile ? "Vault" : resolved.isSystemFile ? "System" : "URL",
            title: resolved.displayPath.split("/").pop() || resolved.displayPath,
          });
          void this.refreshLibraryView();
        } else if (this.isPodcastUrl(selectedUrl)) {
          this.editor = editor;
          new PodcastModal(this.app, this, selectedUrl, editor).open();
        } else if (/^https?:\/\//i.test(selectedUrl)) {
          // 兜底：http/https URL 直接传给播放器（YouTube、流媒体等）
          // react-player 能自动识别并播放这些 URL
          void this.activateView(selectedUrl, editor);
          this.settings.noteTitle
            ? editor.replaceSelection(
                "\n" + this.settings.noteTitle +
                "\n```timestamp-url\n" + (selectedAlias || selectedUrl.split("/").pop()?.split("?")[0] || "Media") + " | " + selectedUrl + "\n```\n",
              )
            : editor.replaceSelection(
                "```timestamp-url\n" + (selectedAlias || selectedUrl.split("/").pop()?.split("?")[0] || "Media") + " | " + selectedUrl + "\n```\n",
              );
          this.editor = editor;
          await this.trackTimestamp(selectedUrl, {
            displayPath: selectedUrl,
            sourceLabel: "URL",
            title: selectedAlias || selectedUrl,
          });
          await this.refreshLibraryView();
        } else {
          editor.replaceSelection(ERRORS["INVALID_URL"]);
        }
        editor.setCursor(editor.getCursor().line + 1);
      },
    });

    this.addCommand({
      id: "timestamp-insert",
      name: "Insert timestamp based on videos current play time",
      editorCallback: (editor: Editor) => {
        if (!this.player) {
          editor.replaceSelection(ERRORS["NO_ACTIVE_VIDEO"]);
          return;
        }
        const time = formatSecondsAsTimestamp(
          Number(this.player.getCurrentTime().toFixed(2)),
        );
        let insertion = "```timestamp\n" + time + "\n```\n";
        if (
          this.settings.includeSubtitleWithTimestamp &&
          this.currentSubtitle
        ) {
          const subtitleLine = this.settings.timestampWithSubtitleTemplate
            .replace("{time}", time)
            .replace("{text}", this.currentSubtitle.text);
          insertion += subtitleLine.endsWith("\n")
            ? subtitleLine
            : subtitleLine + "\n";
        }
        editor.replaceSelection(insertion);
      },
    });

    this.addCommand({
      id: "pause-player",
      name: "Pause player",
      editorCallback: () => {
        if (this.player && this.setPlaying)
          this.setPlaying(!this.player.props.playing);
      },
    });

    this.addCommand({
      id: "seek-forward",
      name: "Seek Forward",
      editorCallback: () => {
        if (this.player)
          this.player.seekTo(
            this.player.getCurrentTime() +
              parseInt(this.settings.forwardSeek),
          );
      },
    });

    this.addCommand({
      id: "seek-backward",
      name: "Seek Backward",
      editorCallback: () => {
        if (this.player)
          this.player.seekTo(
            this.player.getCurrentTime() -
              parseInt(this.settings.backwardsSeek),
          );
      },
    });

    this.addCommand({
      id: "open-sample-modal-complex",
      name: "Open local media file",
      editorCallback: (editor: Editor) => {
        this.editor = editor;
        new LocalFileModal(this.app, this.activateView.bind(this), editor).open();
        return true;
      },
    });

    this.addCommand({
      id: "open-vault-media",
      name: "Open media from vault",
      editorCallback: (editor: Editor) => {
        this.editor = editor;
        new VaultMediaModal(this.app, this).open();
        return true;
      },
    });

    this.addCommand({
      id: "open-media-library",
      name: "Open media library sidebar",
      callback: async () => {
        await this.activateLibraryView();
      },
    });

    this.addCommand({
      id: "import-subtitle-file",
      name: "Import subtitle file for current media",
      editorCallback: (editor: Editor) => {
        this.editor = editor;
        new SubtitleModal(this.app, this).open();
        return true;
      },
    });

    this.addCommand({
      id: "insert-current-subtitle-note",
      name: "Insert current subtitle with timestamp",
      editorCallback: async (editor: Editor) => {
        this.editor = editor;
        if (!this.player) {
          editor.replaceSelection(ERRORS["NO_ACTIVE_VIDEO"]);
          return;
        }
        if (!this.currentSubtitle) {
          editor.replaceSelection(ERRORS["NO_ACTIVE_SUBTITLE"]);
          return;
        }
        const time = formatSecondsAsTimestamp(this.currentSubtitle.start);
        const note = this.settings.subtitleTemplate
          .replace("{time}", time)
          .replace("{text}", this.currentSubtitle.text);
        editor.replaceSelection(note.endsWith("\n") ? note : note + "\n");
      },
    });

    this.addCommand({
      id: "start-voice-recording",
      name: "Start voice recording",
      editorCallback: async (editor: Editor) => {
        this.editor = editor;
        await this.startVoiceRecording();
      },
    });

    this.addCommand({
      id: "stop-voice-recording",
      name: "Stop voice recording and save note",
      editorCallback: async (editor: Editor) => {
        this.editor = editor;
        await this.stopVoiceRecording(editor);
      },
    });

    // ---- 听写模式命令 ----
    this.addCommand({
      id: "toggle-dictation",
      name: "Toggle dictation mode",
      callback: () => {
        this.dictationMode = !this.dictationMode;
        if (!this.dictationMode) {
          this.stopDictationLoop();
        }
        // 刷新所有播放器视图以更新 UI
        const leaves = this.app.workspace.getLeavesOfType(VIDEO_VIEW);
        leaves.forEach((leaf) => {
          if (leaf.view instanceof VideoView && leaf.view.currentEphemeralState) {
            leaf.setEphemeralState({
              ...leaf.view.currentEphemeralState,
              dictationMode: this.dictationMode,
              dictationLoopCount: parseFloat(this.settings.dictationLoopCount) || 0,
              dictationLoopGap: parseFloat(this.settings.dictationLoopGap) || 0.5,
            });
          }
        });
        new Notice(
          this.dictationMode
            ? "Dictation mode ON — subtitles hidden, segment loops"
            : "Dictation mode OFF",
        );
      },
    });

    this.addCommand({
      id: "dictation-reveal",
      name: "Reveal dictation answer (compare with selected text)",
      editorCallback: (editor: Editor) => {
        if (!this.dictationMode) {
          new Notice("Enable dictation mode first.");
          return;
        }
        if (!this.currentSubtitle) {
          new Notice("No active subtitle to compare.");
          return;
        }
        const selected = editor.getSelection().trim();
        if (!selected) {
          new Notice("Select your typed text in the editor first.");
          return;
        }
        const diff = compareDictation(selected, this.currentSubtitle.text);
        const result = formatDictationResult(diff, this.currentSubtitle.text);
        editor.replaceSelection(result);
        if (diff.allCorrect) {
          new Notice("Perfect! All words correct.");
        }
      },
    });

    this.addCommand({
      id: "dictation-prev-segment",
      name: "Dictation: Previous segment",
      callback: () => {
        if (!this.dictationMode || !this.player) return;
        const subs = this.settings.subtitleLibrary[this.currentUrlKey || ""] || [];
        if (!subs.length || !this.currentSubtitle) return;
        const idx = subs.findIndex((c: SubtitleCue) => c.start === this.currentSubtitle!.start);
        if (idx > 0) {
          this.player.seekTo(subs[idx - 1].start);
        }
      },
    });

    this.addCommand({
      id: "dictation-next-segment",
      name: "Dictation: Next segment",
      callback: () => {
        if (!this.dictationMode || !this.player) return;
        const subs = this.settings.subtitleLibrary[this.currentUrlKey || ""] || [];
        if (!subs.length || !this.currentSubtitle) return;
        const idx = subs.findIndex((c: SubtitleCue) => c.start === this.currentSubtitle!.start);
        if (idx >= 0 && idx < subs.length - 1) {
          this.player.seekTo(subs[idx + 1].start);
        }
      },
    });

    this.addSettingTab(new TimestampPluginSettingTab(this.app, this));
  }

  async onunload(): Promise<void> {
    this.stopDictationLoop();
    this.player = null;
    this.editor = null;
    this.setPlaying = null;
    this.currentUrl = null;
    this.currentUrlKey = null;
    this.currentSubtitle = null;
    if (this.mediaRecorder && this.mediaRecorder.state !== "inactive") {
      this.mediaRecorder.stop();
    }
  }

  // ---- Dictation mode helpers ----
  stopDictationLoop(): void {
    this.dictationMode = false;
    if (this.dictationLoopTimer) {
      window.clearInterval(this.dictationLoopTimer);
      this.dictationLoopTimer = null;
    }
  }

  // ---- System file resolution ----
  async resolveSystemFilePath(systemPath: string): Promise<string | null> {
    try {
      const fs = require("fs");
      const path = require("path");
      const buffer = fs.readFileSync(systemPath);
      const ext = path.extname(systemPath).toLowerCase();
      const mimeMap: Record<string, string> = {
        ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".ogg": "audio/ogg",
        ".wav": "audio/wav", ".flac": "audio/flac", ".opus": "audio/ogg",
        ".mp4": "video/mp4", ".m4v": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime",
        ".avi": "video/x-msvideo", ".mkv": "video/x-matroska",
        ".flv": "video/x-flv", ".ogv": "video/ogg", ".wmv": "video/x-ms-wmv",
        ".m4b": "audio/mp4",
      };
      const mime = mimeMap[ext] || "application/octet-stream";
      const blob = new Blob([buffer], { type: mime });
      return URL.createObjectURL(blob);
    } catch (_) { /* fs not available */ }
    try {
      const normalized = systemPath.replace(/\\/g, "/");
      const fileUrl = "file:///" + encodeURI(normalized).replace(/#/g, "%23");
      const response = await requestUrl({
        url: fileUrl,
        method: "GET",
      });
      if (response.status >= 200 && response.status < 300) {
        const blob = new Blob([response.arrayBuffer]);
        return URL.createObjectURL(blob);
      }
    } catch (_) { /* fall through */ }
    return null;
  }

  // ---- Podcast detection ----
  isPodcastUrl(url: string): boolean {
    if (!url || !/^https?:\/\//i.test(url)) return false;
    if (isPlayableMedia(url)) return false;
    if (/\.(xml|rss)(\?.*)?$/i.test(url)) return true;
    if (/\/(feed|rss|podcast)\b/i.test(url)) return true;
    try {
      const host = new URL(url).hostname;
      if (
        /\bfeeds?\b|\brss\b|podcast|anchor\.fm|buzzsprout|simplecast|libsyn|spreaker|transistor\.fm|captivate\.fm|megaphone/i.test(
          host,
        )
      )
        return true;
    } catch (_) { /* not a URL */ }
    return false;
  }

  // ---- Subtitle management ----

  /** Generate a stable key for subtitle storage that won't change between sessions */
  getStableSubtitleKey(url: string, vaultFile?: TFile | null): string {
    // For vault files, use the vault path (stable across sessions)
    if (vaultFile?.path) {
      return "vault://" + vaultFile.path;
    }
    // For system files, the __system__: prefix is already stable
    if (url.startsWith("__system__:")) {
      return url;
    }
    // For blob URLs, we can't get a stable key without vaultFile — try to extract
    // a meaningful segment or fall back to the URL itself
    if (url.startsWith("blob:") || url.startsWith("app://")) {
      // These are session-specific; use as-is but they won't be stable
      // In practice, vaultFile should always be provided when calling from activateView
      return url;
    }
    // Web URLs are stable
    return url;
  }

  async getSubtitlesForUrl(
    url: string,
    vaultFile?: TFile | null,
  ): Promise<SubtitleCue[]> {
    const stableKey = this.getStableSubtitleKey(url, vaultFile);

    // Try lookup by stable key first
    const cached = this.settings.subtitleLibrary[stableKey];
    if (cached && cached.length) return cached;

    // Fallback: try the raw url (backward compat)
    const legacyCached = this.settings.subtitleLibrary[url];
    if (legacyCached && legacyCached.length) {
      // Migrate to stable key (memory only, subtitleLibrary 不持久化)
      this.settings.subtitleLibrary[stableKey] = legacyCached;
      return legacyCached;
    }

    // Try subtitleFileMap with both keys — 从 vault 文件加载
    let mappedPath = this.settings.subtitleFileMap[stableKey]
      || this.settings.subtitleFileMap[url];
    if (mappedPath) {
      try {
        if (await this.app.vault.adapter.exists(mappedPath)) {
          const content = await this.app.vault.adapter.read(mappedPath);
          const cues = parseSubtitleFile(content, mappedPath);
          if (cues.length) {
            // 缓存在内存中，不写 data.json
            this.settings.subtitleLibrary[stableKey] = cues;
            return cues;
          }
        }
      } catch (e) { /* ignore */ }
    }
    return [];
  }

  setCurrentSubtitle(subtitle: SubtitleCue | null): void {
    this.currentSubtitle = subtitle;
  }

  getTargetUrl(editor?: Editor): string | null {
    const selected = editor?.getSelection().trim() || "";
    if (selected && isPlayableMedia(selected)) return selected;
    if (selected) {
      const resolved = this.resolveMediaUrl(selected);
      if (resolved) return resolved.playableUrl;
    }
    return this.currentUrlKey || this.currentUrl;
  }

  // ---- URL resolution ----
  resolveMediaUrl(text: string): ResolvedMedia | null {
    if (!text || typeof text !== "string") return null;
    let trimmed = normalizeMediaCandidate(text);
    if (!trimmed) return null;
    if (
      /^([a-zA-Z]:\\|\/)/.test(trimmed) &&
      MEDIA_EXTENSIONS.some(function(ext: string) {
        return trimmed.toLowerCase().endsWith("." + ext);
      })
    ) {
      return {
        playableUrl: "__system__:" + trimmed,
        displayPath: trimmed,
        isVaultFile: false,
        isSystemFile: true,
      };
    }
    if (isPlayableMedia(trimmed)) {
      return { playableUrl: trimmed, displayPath: trimmed, isVaultFile: false };
    }
    const file = this.app.vault.getAbstractFileByPath(trimmed);
    if (file && MEDIA_EXTENSIONS.includes(file.extension.toLowerCase())) {
      try {
        const resourceUrl = this.app.vault.getResourcePath(file);
        return {
          playableUrl: resourceUrl,
          displayPath: trimmed,
          isVaultFile: true,
          vaultFile: file,
        };
      } catch (_) { /* ignore */ }
    }
    return null;
  }

  // ---- Playlist ----
  buildPlaylist(vaultFile: TFile): { files: TFile[]; currentIndex: number } | null {
    if (!vaultFile?.parent) return null;
    const siblings = vaultFile.parent.children
      .filter(
        (f): f is TFile =>
          f instanceof TFile &&
          MEDIA_EXTENSIONS.includes(f.extension.toLowerCase()),
      )
      .sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { numeric: true }),
      );
    if (siblings.length <= 1) return null;
    const index = siblings.findIndex((f) => f.path === vaultFile.path);
    return { files: siblings, currentIndex: index >= 0 ? index : 0 };
  }

  // ---- Subtitle import ----
  async importSubtitlesForUrl(url: string, file: File): Promise<void> {
    const content = await file.text();
    const cues = parseSubtitleFile(content, file.name);
    if (!cues.length) {
      new Notice("No subtitle cues were detected in that file.");
      return;
    }
    const stableKey = this.getStableSubtitleKey(url);
    this.settings.subtitleLibrary[stableKey] = cues;
    const folder = await this.ensureFolder(this.settings.subtitleStorageFolder);
    const safeName = urlToSafeName(stableKey);
    const ext = file.name.toLowerCase().endsWith(".vtt") ? ".vtt" : ".srt";
    const subtitlePath = normalizePath(`${folder}/${safeName}${ext}`);
    await this.app.vault.adapter.write(subtitlePath, content);
    this.settings.subtitleFileMap[stableKey] = subtitlePath;
    await this.saveSettings();
    // Update all open video views with the new subtitles
    const leaves = this.app.workspace.getLeavesOfType(VIDEO_VIEW);
    leaves.forEach((leaf) => {
      if (
        leaf.view instanceof VideoView &&
        leaf.view.currentEphemeralState
      ) {
        leaf.setEphemeralState({
          ...leaf.view.currentEphemeralState,
          subtitles: cues,
        });
      }
    });
    new Notice(`Imported ${cues.length} subtitle lines. Saved to ${subtitlePath}`);
  }

  // ---- RSS parsing ----
  parseRssSubscriptions(input: string): Array<{ title: string; url: string }> {
    return (input || "")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => {
        const parts = line.split("|");
        if (parts.length >= 2) {
          const title = parts.slice(0, -1).join("|").trim();
          const url = parts[parts.length - 1].trim();
          return { title, url };
        }
        return { title: "", url: line };
      })
      .filter((feed) => feed.url);
  }

  stringifyRssSubscriptions(): string {
    return (this.settings.rssSubscriptions || [])
      .map((feed) => {
        if (typeof feed === "string") return feed;
        return feed.title ? `${feed.title} | ${feed.url}` : feed.url;
      })
      .join("\n");
  }

  async fetchPodcastEpisodes(
    feedUrl: string,
  ): Promise<{ feedTitle: string; episodes: PodcastEpisode[]; error: string | null }> {
    try {
      const response = await requestUrl(feedUrl);
      const text = response.text;
      const feedTitleMatch = text.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      const feedTitle = feedTitleMatch
        ? feedTitleMatch[1].replace(/<[^>]+>/g, "").trim()
        : "Podcast";
      const episodes: PodcastEpisode[] = [];
      let idx = 0;
      while (idx < text.length) {
        const itemStart = text.indexOf("<item", idx);
        if (itemStart === -1) break;
        const itemEnd = text.indexOf("</item>", itemStart);
        if (itemEnd === -1) break;
        const itemText = text.slice(itemStart, itemEnd + 7);
        const titleMatch = itemText.match(
          /<title[^>]*>([\s\S]*?)<\/title>/i,
        );
        const encMatch = itemText.match(/<enclosure[^>]*url="([^"]+)"/i);
        const dateMatch = itemText.match(
          /<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i,
        );
        const durMatch =
          itemText.match(
            /<itunes:duration[^>]*>([^<]+)<\/itunes:duration>/i,
          ) ||
          itemText.match(/<duration[^>]*>([^<]+)<\/duration>/i);
        const descMatch = itemText.match(
          /<description[^>]*>([\s\S]*?)<\/description>/i,
        );
        if (encMatch) {
          let duration = "";
          if (durMatch) {
            const raw = durMatch[1].trim();
            const secs = raw.includes(":")
              ? raw.split(":").reduce((a, b) => a * 60 + parseInt(b), 0)
              : parseInt(raw);
            if (!isNaN(secs)) {
              const m = Math.floor(secs / 60);
              const s = secs % 60;
              duration = m + ":" + (s < 10 ? "0" : "") + s;
            }
          }
          episodes.push({
            title: titleMatch
              ? titleMatch[1].replace(/<[^>]+>/g, "").trim()
              : "Untitled",
            url: encMatch[1],
            date: dateMatch ? dateMatch[1].trim() : "",
            duration,
            description: descMatch
              ? descMatch[1].replace(/<[^>]+>/g, "").trim().slice(0, 160)
              : "",
          });
        }
        idx = itemEnd + 7;
      }
      if (!episodes.length) {
        const encMatches = [
          ...text.matchAll(/<enclosure[^>]*url="([^"]+)"/gi),
        ];
        encMatches.forEach((m, i) => {
          episodes.push({
            title: "Episode " + (i + 1),
            url: m[1],
            date: "",
            duration: "",
            description: "",
          });
        });
      }
      if (!episodes.length) {
        return {
          feedTitle,
          episodes: [],
          error: "No playable episodes found in this feed.",
        };
      }
      return { feedTitle, episodes, error: null };
    } catch (e) {
      return {
        feedTitle: "Podcast",
        episodes: [],
        error:
          "Failed to load podcast feed. The server may block cross-origin requests.",
      };
    }
  }

  // ---- File/folder helpers ----
  async ensureFolder(folderPath: string): Promise<string> {
    const normalized = normalizePath(folderPath);
    if (await this.app.vault.adapter.exists(normalized)) return normalized;
    const parts = normalized.split("/");
    let current = "";
    for (const part of parts) {
      current = current ? current + "/" + part : part;
      if (!(await this.app.vault.adapter.exists(current))) {
        await this.app.vault.createFolder(current);
      }
    }
    return normalized;
  }

  getMediaFilesInFolder(folderPath: string): MediaFileEntry[] {
    if (this.isSystemFolderPath(folderPath)) {
      try {
        const fs = require("fs");
        const path = require("path");
        const found: MediaFileEntry[] = [];
        const walk = (dir: string) => {
          let entries: Array<{ name: string; isDirectory(): boolean }>;
          try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
          } catch (_) {
            entries = [];
          }
          for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
              walk(fullPath);
              continue;
            }
            const ext = path
              .extname(entry.name)
              .replace(".", "")
              .toLowerCase();
            if (!MEDIA_EXTENSIONS.includes(ext)) continue;
            found.push({
              basename: path.basename(entry.name, path.extname(entry.name)),
              path: fullPath,
              playableUrl: "__system__:" + fullPath,
              vaultFile: null,
            });
          }
        };
        walk(folderPath);
        return found.sort((a, b) =>
          a.path.localeCompare(b.path, undefined, { numeric: true }),
        );
      } catch (_) {
        return [];
      }
    }
    const normalized = normalizePath(folderPath);
    return this.app.vault
      .getFiles()
      .filter((file) => {
        const ext = file.extension.toLowerCase();
        return (
          MEDIA_EXTENSIONS.includes(ext) &&
          (file.path === normalized ||
            file.path.startsWith(normalized + "/"))
        );
      })
      .map((file) => ({
        basename: file.basename,
        path: file.path,
        playableUrl: this.app.vault.getResourcePath(file),
        vaultFile: file,
      }))
      .sort((a, b) =>
        a.path.localeCompare(b.path, undefined, { numeric: true }),
      );
  }

  isSystemFolderPath(folderPath: string): boolean {
    return /^([a-zA-Z]:\\|\\\\|\/)/.test(folderPath);
  }

  // ---- Editor helpers ----
  getActiveEditor(): Editor | null {
    const markdownView =
      this.app.workspace.getActiveViewOfType(MarkdownView);
    if (markdownView?.editor) return markdownView.editor;
    const leaves = this.app.workspace.getLeavesOfType("markdown");
    for (const leaf of leaves) {
      if (leaf.view instanceof MarkdownView) return leaf.view.editor;
    }
    return this.editor;
  }

  buildLibraryNote(
    url: string,
    meta: {
      displayPath?: string;
      sourceLabel?: string;
      title?: string;
      description?: string;
    },
  ): string {
    const lines: string[] = [];
    if (this.settings.noteTitle) lines.push("", this.settings.noteTitle);
    const alias = meta.title || meta.displayPath?.split("/").pop()?.replace(/\.[^.]+$/, "") || "";
    const link = meta.displayPath || url;
    lines.push("```timestamp-url");
    lines.push(alias ? alias + " | " + link : link);
    lines.push("```");
    if (meta.sourceLabel || meta.title) {
      const label = [meta.sourceLabel, meta.title]
        .filter(Boolean)
        .join(": ");
      lines.push("> 🎙 " + label);
    }
    if (meta.description) lines.push("> " + meta.description);
    return lines.join("\n") + "\n";
  }

  async openLibraryMedia(
    url: string,
    vaultFile: TFile | null,
    meta: {
      title?: string;
      description?: string;
      sourceLabel?: string;
      displayPath?: string;
    },
    options?: { skipInsert?: boolean },
  ): Promise<void> {
    const editor = this.getActiveEditor();
    if (editor && this.settings.autoInsertLibraryNote && !options?.skipInsert) {
      this.editor = editor;
      editor.replaceSelection(this.buildLibraryNote(url, meta || {}));
    }
    await this.activateView(
      vaultFile
        ? this.app.vault.getResourcePath(vaultFile)
        : url,
      editor!,
      vaultFile || null,
    );
    // Track this media in the saved media collection
    await this.trackTimestamp(url, {
      displayPath: meta.displayPath || url,
      sourceLabel: meta.sourceLabel || "",
      title: meta.title || meta.displayPath || url,
    });
    await this.refreshLibraryView();
  }

  // ---- Timestamp collection ----
  async trackTimestamp(url: string, _meta: { displayPath?: string; sourceLabel?: string; title?: string; }): Promise<void> {
    const title = _meta.title || _meta.displayPath || urlToSafeName(url);
    const activeFile = this.app.workspace.getActiveFile();
    const notePath = activeFile?.path || "";
    const entry: TimestampEntry = {
      url: url,
      displayPath: _meta.displayPath || url,
      notePath: notePath,
      title: _meta.title || _meta.displayPath || urlToSafeName(url),
      sourceLabel: _meta.sourceLabel || "",
      tags: [],
      lastOpened: Date.now(),
    };
    const collection = this.settings.timestampCollection || [];

    // Auto-sync frontmatter tags from the note file
    if (activeFile) {
      try {
        const cache = this.app.metadataCache.getFileCache(activeFile);
        if (cache?.frontmatter?.tags && Array.isArray(cache.frontmatter.tags)) {
          entry.tags = [...cache.frontmatter.tags];
        }
      } catch (_) { /* ignore frontmatter parse errors */ }
    }

    // Deduplicate by url+notePath
    const existing = collection.findIndex(
      (e) => e.url === entry.url && e.notePath === entry.notePath
    );
    if (existing >= 0) {
      // Merge frontmatter tags with existing manual tags
      const merged = new Set([...entry.tags, ...collection[existing].tags]);
      entry.tags = [...merged];
      collection[existing] = entry;
    } else {
      collection.unshift(entry);
    }
    // Keep max 100 entries
    if (collection.length > 100) collection.length = 100;
    this.settings.timestampCollection = collection;
    await this.saveSettings();
  }

  // ---- Reconcile saved media from vault notes ----
  async reconcileTimestampCollection(): Promise<void> {
    const allFiles = this.app.vault.getMarkdownFiles();
    const collection = (this.settings.timestampCollection || []) as TimestampEntry[];
    const newCollection: TimestampEntry[] = [];
    const seen = new Set<string>();

    for (const file of allFiles) {
      try {
        const content = await this.app.vault.read(file);
        // Find all ```timestamp-url blocks
        const regex = /```timestamp-url\n([\s\S]*?)\n```/g;
        let match;
        while ((match = regex.exec(content)) !== null) {
          const raw = match[1].trim();
          if (!raw) continue;
          const parsedBlock = parseTimestampUrlBlock(raw);
          const blockUrl = parsedBlock.url;
          const blockAlias = parsedBlock.alias;
          const resolved = this.resolveMediaUrl(blockUrl);
          const url = resolved ? resolved.playableUrl : (/^https?:\/\//i.test(blockUrl) ? blockUrl : "");
          if (!url) continue;

          const key = url + "|" + file.path;
          if (seen.has(key)) continue;
          seen.add(key);

          // Find existing entry to preserve manual tags
          const existing = collection.find(
            (e) => e.url === url && e.notePath === file.path
          );

          // Get frontmatter tags
          let fmTags: string[] = [];
          try {
            const cache = this.app.metadataCache.getFileCache(file);
            if (cache?.frontmatter?.tags && Array.isArray(cache.frontmatter.tags)) {
              fmTags = [...cache.frontmatter.tags];
            }
          } catch (_) { /* ignore */ }

          const entry: TimestampEntry = {
            url,
            displayPath: resolved?.displayPath || blockUrl,
            notePath: file.path,
            title: blockAlias || resolved?.displayPath?.split("/").pop()?.replace(/\.[^.]+$/, "") || file.basename,
            sourceLabel: resolved?.isVaultFile ? "Vault" : "URL",
            tags: existing
              ? [...new Set([...fmTags, ...existing.tags])]
              : fmTags,
            lastOpened: existing?.lastOpened || Date.now(),
          };
          newCollection.push(entry);
        }
      } catch (_) { /* skip unreadable files */ }
    }

    // Cap at 100
    if (newCollection.length > 100) newCollection.length = 100;
    this.settings.timestampCollection = newCollection;
    await this.saveSettings();
    new Notice(`Saved Media reconciled: ${newCollection.length} entries from ${allFiles.length} notes.`);
  }
  // ---- View management ----
  async activateLibraryView(): Promise<void> {
    let leaf = this.app.workspace.getLeavesOfType(LIBRARY_VIEW)[0];
    if (!leaf) {
      leaf = this.app.workspace.getRightLeaf(false)!;
      await leaf.setViewState({ type: LIBRARY_VIEW, active: true });
    }
    this.app.workspace.revealLeaf(leaf);
    if (leaf.view instanceof MediaLibraryView) {
      await leaf.view.render();
    }
  }

  async refreshLibraryView(): Promise<void> {
    const leaves = this.app.workspace.getLeavesOfType(LIBRARY_VIEW);
    for (const leaf of leaves) {
      if (leaf.view instanceof MediaLibraryView) {
        await leaf.view.render();
      }
    }
  }

  async getOrCreateVideoLeaf(): Promise<WorkspaceLeaf> {
    let leaf = this.app.workspace.getLeavesOfType(VIDEO_VIEW)[0];
    if (leaf) return leaf;
    const libraryLeaf =
      this.app.workspace.getLeavesOfType(LIBRARY_VIEW)[0];
    if (libraryLeaf) {
      leaf = this.app.workspace.createLeafBySplit(libraryLeaf, "vertical");
    } else {
      leaf = this.app.workspace.getRightLeaf(false)!;
    }
    await leaf.setViewState({ type: VIDEO_VIEW, active: true });
    return leaf;
  }

  async startVoiceRecording(): Promise<void> {
    if (this.mediaRecorder && this.mediaRecorder.state !== "inactive") {
      new Notice("Voice recording is already running.");
      return;
    }
    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      if (this.editor)
        this.editor.replaceSelection(ERRORS["VOICE_RECORDING_UNAVAILABLE"]);
      return;
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
    });
    this.recordedChunks = [];
    this.mediaRecorder = new MediaRecorder(stream);
    this.mediaRecorder.ondataavailable = (event: BlobEvent) => {
      if (event.data && event.data.size > 0) {
        this.recordedChunks.push(event.data);
      }
    };
    this.mediaRecorder.onstop = () => {
      stream.getTracks().forEach((track) => track.stop());
    };
    this.mediaRecorder.start();
    new Notice("Voice recording started.");
  }

  async stopVoiceRecording(editor: Editor): Promise<void> {
    if (
      !this.mediaRecorder ||
      this.mediaRecorder.state === "inactive"
    ) {
      new Notice("No voice recording is currently running.");
      return;
    }
    const recorder = this.mediaRecorder;
    await new Promise<void>((resolve) => {
      recorder.addEventListener("stop", () => resolve(), { once: true });
      recorder.stop();
    });
    const mimeType = recorder.mimeType || "audio/webm";
    const blob = new Blob(this.recordedChunks, { type: mimeType });
    this.mediaRecorder = null;
    this.recordedChunks = [];

    const folder = await this.ensureFolder(
      this.settings.recordingsFolder,
    );
    const extension = mimeType.includes("ogg") ? "ogg" : "webm";
    const filename = `voice-note-${Date.now()}.${extension}`;
    const path = normalizePath(`${folder}/${filename}`);
    const arrayBuffer = await blob.arrayBuffer();
    await this.app.vault.createBinary(path, arrayBuffer);

    editor.replaceSelection(
      `\`\`\`voice-bar\n${path}\n\`\`\`\n`,
    );
    new Notice(`Voice recording saved to ${path}.`);
  }

  // ---- Main activate view ----
  async activateView(
    url: string,
    editor: Editor | null,
    vaultFile: TFile | null = null,
  ): Promise<void> {
    let resolvedUrl = url;
    let systemPath: string | null = null;
    if (url.startsWith("__system__:")) {
      systemPath = url.slice(11);
      resolvedUrl = (await this.resolveSystemFilePath(systemPath))!;
      if (!resolvedUrl) {
        new Notice(
          "Cannot access system file. It may be outside the vault or inaccessible.",
        );
        return;
      }
    }
    this.currentUrl = resolvedUrl;
    this.currentUrlKey = systemPath ? url : resolvedUrl;
    this.editor = editor;

    const videoLeaf = await this.getOrCreateVideoLeaf();
    this.app.workspace.revealLeaf(videoLeaf);

    const leaves = this.app.workspace.getLeavesOfType(VIDEO_VIEW);
    for (const leaf of leaves) {
      if (leaf.view instanceof VideoView) {
        const subs = await this.getSubtitlesForUrl(url, vaultFile);
        // 检测音频：使用原始 URL（本地文件 blob URL 无法通过扩展名检测）
        const audio = isAudioFile(url) ||
          (systemPath ? isAudioFile(systemPath) : false) ||
          (vaultFile?.extension
            ? !getVideoFormats().includes(vaultFile.extension.toLowerCase())
            : false);
        const state: VideoEphemeralState = {
          url: resolvedUrl,
          setupPlayer: (player, setPlaying) => {
            this.player = player;
            this.setPlaying = setPlaying;
          },
          setupError: (err: string) => {
            if (editor) {
              editor.replaceSelection(
                editor.getSelection() +
                  `\n> [!error] Streaming Error \n> ${err}\n`,
              );
            }
          },
          saveTimeOnUnload: async () => {
            if (this.player) {
              this.settings.urlStartTimeMap.set(
                url,
                Number(this.player.getCurrentTime().toFixed(0)),
              );
            }
            await this.saveSettings();
          },
          start:
            ~~(this.settings.urlStartTimeMap.get(url) || 0),
          subtitles: subs,
          onSubtitleChange: this.setCurrentSubtitle.bind(this),
          showSubtitleOverlay:
            this.settings.showSubtitleOverlay !== false,
          showSubtitleBrowser:
            this.settings.showSubtitleBrowser !== false,
          subtitleOverlayFontSize:
            this.settings.subtitleOverlayFontSize || "large",
          dictationMode: this.dictationMode,
          dictationLoopCount: parseFloat(this.settings.dictationLoopCount) || 0,
          dictationLoopGap: parseFloat(this.settings.dictationLoopGap) || 0.5,
          playlist: vaultFile
            ? this.buildPlaylist(vaultFile)
            : null,
          onNavigatePlaylist: async (file) => {
            const newUrl = this.app.vault.getResourcePath(file);
            await this.activateView(newUrl, this.editor, file);
          },
          isAudio: audio,
        };
        leaf.setEphemeralState(state);
        await this.saveSettings();
      }
    }
  }

  // ---- Settings persistence ----
  //
  // subtitleLibrary 只做运行时内存缓存，不写入 data.json。
  // 字幕数据存储在 vault 的 .srt/.vtt 文件中，通过 subtitleFileMap 映射。
  // 每次启动时 subtitleLibrary 从空开始，访问字幕时按需从磁盘文件加载。

  async loadSettings(): Promise<void> {
    const data = (await this.loadData()) as PersistedSettingsData | null;
    if (data) {
      // 如果 data.json 里残留了旧版 subtitleLibrary，清理掉
      if (data.subtitleLibrary && Object.keys(data.subtitleLibrary).length > 0) {
        data.subtitleLibrary = {};
        // 立即保存清理后的数据
        await this.saveData({ ...data, subtitleLibrary: {} });
      }

      const map = new Map<string, number>(
        Object.keys(data.urlStartTimeMap || {}).map((k) => [
          k,
          data.urlStartTimeMap[k],
        ]),
      );
      this.settings = {
        ...(DEFAULT_SETTINGS as SmartMediaNotesSettings),
        ...data,
        urlStartTimeMap: map,
        // 强制字幕缓存为空 — 从磁盘文件按需加载
        subtitleLibrary: {},
        subtitleFileMap: data.subtitleFileMap || {},
        rssSubscriptions: data.rssSubscriptions || [],
        mediaFolders: data.mediaFolders || [],
      };
    } else {
      this.settings = {
        ...(DEFAULT_SETTINGS as SmartMediaNotesSettings),
        urlStartTimeMap: new Map<string, number>(),
      };
    }
    // Apply user-defined media format lists to the shared module-level lists
    setMediaFormats(
      this.settings.videoFormats || DEFAULT_SETTINGS.videoFormats!,
      this.settings.audioFormats || DEFAULT_SETTINGS.audioFormats!,
    );
  }

  async saveSettings(): Promise<void> {
    // 不持久化 subtitleLibrary — 它只是运行时缓存
    const { subtitleLibrary, ...toSave } = this.settings;
    await this.saveData({
      ...toSave,
      urlStartTimeMap: Object.fromEntries(this.settings.urlStartTimeMap),
    });
  }
}

// ---- Modal Classes ----

class VaultMediaModal extends FuzzySuggestModal<TFile> {
  plugin: SmartMediaNotesPlugin;

  constructor(app: App, plugin: SmartMediaNotesPlugin) {
    super(app);
    this.plugin = plugin;
  }

  getItems(): TFile[] {
    return this.app.vault.getFiles().filter((file) => {
      const ext = file.extension.toLowerCase();
      return MEDIA_EXTENSIONS.includes(ext);
    });
  }

  getItemText(file: TFile): string {
    return file.path;
  }

  onChooseItem(file: TFile): void {
    const resourceUrl = this.app.vault.getResourcePath(file);
    void this.plugin.activateView(resourceUrl, this.plugin.editor, file);
  }
}

class PodcastModal extends Modal {
  plugin: SmartMediaNotesPlugin;
  feedUrl: string;
  editor: Editor | null;
  episodes: PodcastEpisode[] = [];
  feedTitle: string = "";
  error: string | null = null;

  constructor(
    app: App,
    plugin: SmartMediaNotesPlugin,
    feedUrl: string,
    editor: Editor | null,
  ) {
    super(app);
    this.plugin = plugin;
    this.feedUrl = feedUrl;
    this.editor = editor;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("smn-podcast-modal");
    const loadingDiv = contentEl.createEl("div", {
      style: { padding: "24px", textAlign: "center" },
    });
    loadingDiv.createEl("div", {
      text: "🎙",
      style: { fontSize: "32px", marginBottom: "12px" },
    });
    loadingDiv.createEl("div", {
      text: "Loading podcast feed...",
      style: { color: "var(--text-muted)", fontSize: "14px" },
    });
    loadingDiv.createEl("div", {
      text: this.feedUrl,
      style: {
        color: "var(--text-faint)",
        fontSize: "11px",
        marginTop: "4px",
        wordBreak: "break-all",
      },
    });
    void this.loadFeed();
  }

  async loadFeed(): Promise<void> {
    const { contentEl } = this;
    try {
      const response = await requestUrl(this.feedUrl);
      const text = response.text;
      const feedTitleMatch = text.match(
        /<title[^>]*>([\s\S]*?)<\/title>/i,
      );
      this.feedTitle = feedTitleMatch
        ? feedTitleMatch[1].replace(/<[^>]+>/g, "").trim()
        : "Podcast";
      const episodes: PodcastEpisode[] = [];
      let idx = 0;
      while (idx < text.length) {
        const itemStart = text.indexOf("<item", idx);
        if (itemStart === -1) break;
        const itemEnd = text.indexOf("</item>", itemStart);
        if (itemEnd === -1) break;
        const itemText = text.slice(itemStart, itemEnd + 7);
        const titleMatch = itemText.match(
          /<title[^>]*>([\s\S]*?)<\/title>/i,
        );
        const encMatch = itemText.match(
          /<enclosure[^>]*url="([^"]+)"/i,
        );
        const dateMatch = itemText.match(
          /<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i,
        );
        const durMatch =
          itemText.match(
            /<itunes:duration[^>]*>([^<]+)<\/itunes:duration>/i,
          ) ||
          itemText.match(/<duration[^>]*>([^<]+)<\/duration>/i);
        const descMatch = itemText.match(
          /<description[^>]*>([\s\S]*?)<\/description>/i,
        );
        if (encMatch) {
          let duration = "";
          if (durMatch) {
            const raw = durMatch[1].trim();
            const secs = raw.includes(":")
              ? raw
                  .split(":")
                  .reduce((a, b) => a * 60 + parseInt(b), 0)
              : parseInt(raw);
            if (!isNaN(secs)) {
              const m = Math.floor(secs / 60);
              const s = secs % 60;
              duration = m + ":" + (s < 10 ? "0" : "") + s;
            }
          }
          episodes.push({
            title: titleMatch
              ? titleMatch[1].replace(/<[^>]+>/g, "").trim()
              : "Untitled",
            url: encMatch[1],
            date: dateMatch ? dateMatch[1].trim() : "",
            duration,
            description: descMatch
              ? descMatch[1]
                  .replace(/<[^>]+>/g, "")
                  .trim()
                  .slice(0, 160)
              : "",
          });
        }
        idx = itemEnd + 7;
      }
      this.episodes = episodes;
      if (!episodes.length) {
        const encMatches = [
          ...text.matchAll(/<enclosure[^>]*url="([^"]+)"/gi),
        ];
        encMatches.forEach((m, i) => {
          episodes.push({
            title: "Episode " + (i + 1),
            url: m[1],
            date: "",
            duration: "",
            description: "",
          });
        });
        this.episodes = episodes;
      }
      if (!this.episodes.length) {
        this.error = "No playable episodes found in this feed.";
      }
    } catch (e) {
      this.error =
        "Failed to load podcast feed. The server may block cross-origin requests.";
    }

    if (this.error) {
      contentEl.empty();
      const errDiv = contentEl.createEl("div", {
        style: { padding: "24px", textAlign: "center" },
      });
      errDiv.createEl("div", {
        text: "⚠️",
        style: { fontSize: "32px", marginBottom: "12px" },
      });
      errDiv.createEl("p", {
        text: this.error,
        style: {
          color: "var(--text-error)",
          fontSize: "13px",
          marginBottom: "12px",
        },
      });
      const retryBtn = errDiv.createEl("button", { text: "Retry" });
      retryBtn.addClass("smn-podcast-error-retry");
      retryBtn.addEventListener("click", () => {
        this.error = null;
        this.onOpen();
      });
      return;
    }

    contentEl.empty();
    const titleBar = contentEl.createEl("div", {
      style: {
        padding: "14px 16px 10px",
        borderBottom: "1px solid var(--background-modifier-border)",
        flexShrink: 0,
      },
    });
    titleBar.createEl("div", {
      text: "🎙 " + this.feedTitle,
      style: { fontWeight: 700, fontSize: "15px" },
    });
    titleBar.createEl("div", {
      text: this.episodes.length + " episodes",
      style: {
        fontSize: "11px",
        color: "var(--text-muted)",
        marginTop: "2px",
      },
    });
    const list = contentEl.createEl("div", {
      style: { overflowY: "auto", flex: 1 },
    });
    this.episodes.forEach((ep, i) => {
      const num = this.episodes.length - i;
      const row = list.createEl("div", {
        cls: "smn-podcast-ep-row",
        style: {
          display: "flex",
          alignItems: "flex-start",
          gap: "10px",
          padding: "10px 16px",
          cursor: "pointer",
          borderBottom: "1px solid var(--background-modifier-border)",
          transition: "background 0.1s",
        },
      });
      const badge = row.createEl("div", {
        text: String(num),
        style: {
          width: "26px",
          height: "26px",
          borderRadius: "50%",
          background: "var(--interactive-accent)",
          color: "var(--text-on-accent)",
          fontSize: "11px",
          fontWeight: 700,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          marginTop: "1px",
        },
      });
      const body = row.createEl("div", {
        style: { flex: 1, minWidth: 0 },
      });
      body.createEl("div", {
        text: ep.title,
        style: {
          fontWeight: 600,
          fontSize: "13px",
          lineHeight: "1.3",
          wordBreak: "break-word",
        },
      });
      const meta = body.createEl("div", {
        style: {
          display: "flex",
          gap: "12px",
          marginTop: "3px",
          fontSize: "11px",
          color: "var(--text-muted)",
        },
      });
      if (ep.date) {
        try {
          const d = new Date(ep.date);
          meta.createEl("span", {
            text: d.toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
              year: "numeric",
            }),
          });
        } catch (_) {
          meta.createEl("span", { text: ep.date });
        }
      }
      if (ep.duration)
        meta.createEl("span", { text: "⏱ " + ep.duration });
      if (ep.description)
        body.createEl("div", {
          text: ep.description,
          style: {
            fontSize: "11px",
            color: "var(--text-faint)",
            marginTop: "3px",
            lineHeight: "1.3",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          },
        });
      row.addEventListener("click", async () => {
        this.close();
        const note =
          "```timestamp-url\n" +
          ep.url +
          "\n```\n> 🎙 " +
          this.feedTitle +
          ": " +
          ep.title +
          "\n";
        this.editor?.replaceSelection(note);
        await this.plugin.activateView(ep.url, this.editor);
        await this.plugin.trackTimestamp(ep.url, {
          title: ep.title,
          sourceLabel: this.feedTitle,
          displayPath: ep.url,
        });
        await this.plugin.refreshLibraryView();
      });
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

class LocalFileModal extends Modal {
  activateView: (url: string, editor: Editor | null) => void;
  editor: Editor | null;

  constructor(
    app: App,
    activateView: (url: string, editor: Editor | null) => void,
    editor: Editor | null,
  ) {
    super(app);
    this.activateView = activateView;
    this.editor = editor;
  }

  onOpen(): void {
    const { contentEl } = this;
    const input = contentEl.createEl("input");
    input.setAttribute("type", "file");
    const allFormats = [...MEDIA_EXTENSIONS];
    input.setAttribute(
      "accept",
      "video/*,audio/*," + allFormats.map(function(e: string) { return "." + e; }).join(","),
    );
    input.onchange = (e: Event) => {
      const target = e.target as HTMLInputElement;
      if (target.files?.[0]) {
        const url = URL.createObjectURL(target.files[0]);
        this.activateView(url, this.editor);
        this.close();
      }
    };
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

class SubtitleModal extends Modal {
  plugin: SmartMediaNotesPlugin;

  constructor(app: App, plugin: SmartMediaNotesPlugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen(): void {
    const { contentEl } = this;
    const targetUrl = this.plugin.getTargetUrl(this.plugin.editor!);
    contentEl.createEl("h3", { text: "Import subtitle file" });
    if (!targetUrl) {
      contentEl.createEl("p", {
        text: "Open a media file first, or select a playable URL in the editor before importing subtitles.",
      });
      return;
    }
    contentEl.createEl("p", {
      text: `Bind subtitles to: ${targetUrl}`,
    });
    const input = contentEl.createEl("input");
    input.setAttribute("type", "file");
    input.setAttribute(
      "accept",
      ".srt,.vtt,text/vtt,application/x-subrip",
    );
    input.onchange = async (e: Event) => {
      const target = e.target as HTMLInputElement;
      const file = target.files?.[0];
      if (!file) return;
      await this.plugin.importSubtitlesForUrl(targetUrl, file);
      this.close();
    };
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
