import {
  App,
  Editor,
  FuzzySuggestModal,
  MarkdownView,
  Modal,
  Notice,
  Plugin,
  Platform,
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
import { resolveBilibiliSource } from "./media/bilibiliResolver";
import {
  formatSecondsAsTimestamp,
  parseTimestampToSeconds,
  parseSubtitleFile,
  urlToSafeName,
  urlToReadableSubtitleName,
  normalizeMediaCandidate,
  isPlayableMedia,
  isBilibiliUrl,
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
  isYouTubeUrl,
  toYouTubeWatchUrl,
  toExternalTimestampUrl,
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
  forceNativePlayer?: boolean;
}

interface PersistedSettingsData extends Partial<SmartMediaNotesSettings> {
  urlStartTimeMap?: Record<string, number>;
  youtubeDirectPlayback?: boolean;
  youtubeDlpPath?: string;
}

interface SubtitleIndexData {
  version: number;
  subtitleFileMap: Record<string, string>;
}

interface DirectUrlEntry {
  originalUrl: string;
  directUrl: string;
  title?: string;
  extractor?: string;
  mediaKind?: "video" | "audio" | "hls";
  resolvedAt: number;
  expiresAt: number;
  invalidatedAt?: number;
  invalidReason?: string;
}

interface DirectUrlMapData {
  version: number;
  entries: Record<string, DirectUrlEntry>;
}

interface YtdlpFormat {
  url?: string;
  ext?: string;
  protocol?: string;
  format_id?: string;
  format_note?: string;
  vcodec?: string;
  acodec?: string;
  width?: number;
  height?: number;
  tbr?: number;
  filesize?: number;
  filesize_approx?: number;
}

interface YtdlpInfo {
  url?: string;
  title?: string;
  extractor?: string;
  ext?: string;
  protocol?: string;
  vcodec?: string;
  acodec?: string;
  width?: number;
  height?: number;
  requested_downloads?: YtdlpFormat[];
  formats?: YtdlpFormat[];
}

interface DirectUrlCandidate {
  url: string;
  mediaKind: "video" | "audio" | "hls";
}

interface SubtitleReferenceIndex {
  keys: Set<string>;
  labelsByKey: Map<string, Set<string>>;
}

interface SubtitleLibraryItem {
  path: string;
  exists: boolean;
  status: "linked" | "unused" | "missing";
  mappedKeys: string[];
  activeKeys: string[];
  labels: string[];
}

interface TimestampNode {
  time: string;
  subhead: string;
  label: string;
  seconds: number;
  mediaUrl?: string;
  preview?: string;
  previewStartLine?: number;
  previewEndLine?: number;
}

interface NodeFileSystem {
  readFileSync(path: string): Uint8Array;
  readdirSync(
    path: string,
    options: { withFileTypes: true },
  ): Array<{ name: string; isDirectory(): boolean }>;
}

interface NodePathModule {
  extname(path: string): string;
  join(...parts: string[]): string;
  basename(path: string, suffix?: string): string;
}

interface NodeChildProcess {
  execFile(
    file: string,
    args: string[],
    options: { timeout?: number; maxBuffer?: number },
    callback: (error: unknown, stdout: string, stderr: string) => void,
  ): void;
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

function buildTimestampBlockFromSelection(selection: string): string | null {
  const matches = selection
    .replace(/\uFF1A/g, ":")
    .match(/\b\d{1,2}:\d{1,2}(?::\d{1,2})?\b/g);
  if (!matches?.length) return null;
  const normalized = matches
    .map((match) => parseTimestampToSeconds(match))
    .filter((seconds): seconds is number => seconds != null)
    .map((seconds) => formatSecondsAsTimestamp(seconds));
  if (!normalized.length) return null;
  return "```timestamp\n" + normalized.join("\n") + "\n```\n";
}

export default class SmartMediaNotesPlugin extends Plugin {
  settings!: SmartMediaNotesSettings;
  player: PlayerHandle | null = null;
  setPlaying: ((playing: boolean) => void) | null = null;
  currentUrl: string | null = null;
  currentUrlKey: string | null = null;
  currentUrlCanSeek: boolean = false;
  currentMediaAlias: string = "";
  currentMediaSourceUrl: string = "";
  currentMediaDisplayPath: string = "";
  currentMediaVaultFile: TFile | null = null;
  mobileTimestampRailEl: HTMLElement | null = null;
  mobileTimestampRailView: MarkdownView | null = null;
  mobileTimestampRailEditMode: boolean = false;
  currentSubtitle: SubtitleCue | null = null;
  directUrlMap: Record<string, DirectUrlEntry> = {};
  editor: Editor | null = null;
  mediaRecorder: MediaRecorder | null = null;
  recordedChunks: Blob[] = [];

  // 听写模式
  dictationMode: boolean = false;
  dictationLoopTimer: number | null = null;

  private getNodeFs(): NodeFileSystem | null {
    const globalWithRequire = globalThis as typeof globalThis & {
      require?: (id: string) => unknown;
    };
    const mod = globalWithRequire.require?.("fs");
    return mod as NodeFileSystem | null;
  }

  private getNodePath(): NodePathModule | null {
    const globalWithRequire = globalThis as typeof globalThis & {
      require?: (id: string) => unknown;
    };
    const mod = globalWithRequire.require?.("path");
    return mod as NodePathModule | null;
  }

  private getNodeChildProcess(): NodeChildProcess | null {
    const globalWithRequire = globalThis as typeof globalThis & {
      require?: (id: string) => unknown;
    };
    const mod = globalWithRequire.require?.("child_process");
    return mod as NodeChildProcess | null;
  }

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
      icon: "refresh-cw",
      callback: async () => {
        await this.reconcileTimestampCollection();
        await this.refreshLibraryView();
      },
    });
    this.addCommand({
      id: "reconcile-subtitle-index",
      name: "Reconcile synced subtitle index",
      icon: "captions",
      callback: async () => {
        await this.reconcileSubtitleIndex();
      },
    });
    this.addCommand({
      id: "resolve-direct-url-with-ytdlp",
      name: "Resolve direct URL with yt-dlp",
      icon: "link",
      editorCallback: async (editor: Editor) => {
        const targetUrl = this.getTargetUrl(editor);
        if (!targetUrl || !/^https?:\/\//i.test(targetUrl)) {
          new Notice("Select or open an HTTP video page link first.");
          return;
        }
        await this.resolveAndSaveDirectUrl(targetUrl);
      },
    });
    this.addCommand({
      id: "toggle-mobile-timestamp-rail",
      name: "Toggle mobile timestamp rail",
      icon: "panel-left-open",
      callback: async () => {
        await this.toggleMobileTimestampRail();
      },
    });
    this.addCommand({
      id: "toggle-mobile-timestamp-rail-edit-mode",
      name: "Toggle mobile timestamp rail edit mode",
      icon: "pencil",
      callback: async () => {
        await this.toggleMobileTimestampRailEditMode();
      },
    });
    this.addRibbonIcon("library", "Open Smart Media Library", () => {
      void this.activateLibraryView();
    });

    // timestamp code block processor
    this.registerMarkdownCodeBlockProcessor(
      "timestamp",
      (source: string, el: HTMLElement) => {
        const entries = this.extractTimestampEntriesFromSource(source);
        entries.forEach((entry) => {
          const div = el.createEl("div", { cls: "smn-timestamp-node" });
          const button = div.createEl("button", {
            cls: "smn-dynamic-btn smn-timestamp-node-btn",
          });
          this.renderTimestampButtonLabel(button, entry);
          button.style.setProperty(
            "--smn-btn-bg",
            this.settings.timestampColor,
          );
          button.style.setProperty(
            "--smn-btn-color",
            this.settings.timestampTextColor,
          );
          div.appendChild(button);
          button.addEventListener("click", () => this.seekToTimestamp(entry.seconds));
          const externalUrl = toExternalTimestampUrl(
            this.currentUrlKey || this.currentUrl || "",
            entry.seconds,
          );
          if (externalUrl) {
            button.title =
              "Seek in player. On mobile platform links open externally at this timestamp.";
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
          button.addClass("smn-dynamic-btn");
          button.style.setProperty("--smn-btn-bg", this.settings.urlColor);
          button.style.setProperty(
            "--smn-btn-color",
            this.settings.urlTextColor,
          );
          button.addEventListener("click", () => {
            void this.activateView(
              resolved.playableUrl,
              this.editor,
              resolved.isVaultFile ? resolved.vaultFile : null,
              {
                alias,
                sourceUrl: raw,
                displayPath: resolved.displayPath,
              },
            );
          });
          div.appendChild(button);
        } else if (this.isPodcastUrl(raw)) {
          const div = el.createEl("div");
          const button = div.createEl("button", {
            cls: "smn-dynamic-btn",
          });
          button.innerText = "🎙 " + raw;
          button.style.setProperty("--smn-btn-bg", this.settings.urlColor);
          button.style.setProperty(
            "--smn-btn-color",
            this.settings.urlTextColor,
          );
          button.addEventListener("click", () => {
            new PodcastModal(this.app, this, raw, this.editor).open();
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
          button.addClass("smn-dynamic-btn");
          button.style.setProperty("--smn-btn-bg", this.settings.urlColor);
          button.style.setProperty(
            "--smn-btn-color",
            this.settings.urlTextColor,
          );
          button.addEventListener("click", () => {
            void this.activateView(raw, this.editor, null, {
              alias,
              sourceUrl: raw,
              displayPath: raw,
            });
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
        deleteBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          e.preventDefault();
          void (async () => {
            await this.app.fileManager.trashFile(file);
            const noteFile = this.app.vault.getAbstractFileByPath(ctx.sourcePath);
            if (noteFile instanceof TFile) {
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
              } catch {
                // ignore
              }
            }
            new Notice("Voice recording deleted.");
          })();
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
            bar.removeClass("active");
            bar.addClass("idle");
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
      icon: "play-circle",
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
            {
              alias: selectedAlias,
              sourceUrl: selectedUrl,
              displayPath: resolved.displayPath,
            },
          );
          if (this.settings.noteTitle) {
            editor.replaceSelection(
              "\n" +
                this.settings.noteTitle +
                "\n```timestamp-url\n" +
                (selectedAlias ? selectedAlias + " | " : "") +
                resolved.displayPath +
                "\n```\n",
            );
          } else {
            editor.replaceSelection(
              "```timestamp-url\n" +
                (selectedAlias ? selectedAlias + " | " : "") +
                resolved.displayPath +
                "\n```\n",
            );
          }
          this.editor = editor;
          void this.trackTimestamp(resolved.playableUrl, {
            displayPath: resolved.displayPath,
            sourceLabel: resolved.isVaultFile ? "Vault" : resolved.isSystemFile ? "System" : "URL",
            title:
              selectedAlias ||
              resolved.displayPath.split("/").pop()?.replace(/\.[^.]+$/, "") ||
              resolved.displayPath,
          });
          void this.refreshLibraryView();
        } else if (this.isPodcastUrl(selectedUrl)) {
          this.editor = editor;
          new PodcastModal(this.app, this, selectedUrl, editor).open();
        } else if (/^https?:\/\//i.test(selectedUrl)) {
          // 兜底：http/https URL 直接传给播放器（YouTube、流媒体等）
          void this.activateView(selectedUrl, editor, null, {
            alias: selectedAlias,
            sourceUrl: selectedUrl,
            displayPath: selectedUrl,
          });
          if (this.settings.noteTitle) {
            editor.replaceSelection(
              "\n" + this.settings.noteTitle +
              "\n```timestamp-url\n" + (selectedAlias || selectedUrl.split("/").pop()?.split("?")[0] || "Media") + " | " + selectedUrl + "\n```\n",
            );
          } else {
            editor.replaceSelection(
              "```timestamp-url\n" + (selectedAlias || selectedUrl.split("/").pop()?.split("?")[0] || "Media") + " | " + selectedUrl + "\n```\n",
            );
          }
          this.editor = editor;
          await this.trackTimestamp(selectedUrl, {
            displayPath: selectedUrl,
            sourceLabel: "URL",
            title: selectedAlias || selectedUrl.split("/").pop()?.split("?")[0] || selectedUrl,
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
      icon: "clock",
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
      id: "timestamp-wrap-selection",
      name: "Convert selected time text to timestamp block",
      icon: "wand-sparkles",
      editorCallback: (editor: Editor) => {
        const selected = editor.getSelection();
        const block = buildTimestampBlockFromSelection(selected);
        if (!block) {
          new Notice("Select a time like 1:23, 01:23, or 1:02:03 first.");
          return;
        }
        editor.replaceSelection(block);
      },
    });

    this.addCommand({
      id: "pause-player",
      name: "Pause player",
      icon: "pause-circle",
      editorCallback: () => {
        if (this.player && this.setPlaying)
          this.setPlaying(!this.player.props.playing);
      },
    });

    this.addCommand({
      id: "seek-forward",
      name: "Seek Forward",
      icon: "skip-forward",
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
      icon: "skip-back",
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
      icon: "folder-open",
      editorCallback: (editor: Editor) => {
        this.editor = editor;
        new LocalFileModal(this.app, this.activateView.bind(this), editor).open();
        return true;
      },
    });

    this.addCommand({
      id: "open-vault-media",
      name: "Open media from vault",
      icon: "folder-search",
      editorCallback: (editor: Editor) => {
        this.editor = editor;
        new VaultMediaModal(this.app, this).open();
        return true;
      },
    });

    this.addCommand({
      id: "open-media-library",
      name: "Open media library sidebar",
      icon: "library",
      callback: () => {
        void this.activateLibraryView();
      },
    });

    this.addCommand({
      id: "import-subtitle-file",
      name: "Import subtitle file for current media",
      icon: "captions",
      editorCallback: (editor: Editor) => {
        this.editor = editor;
        new SubtitleModal(this.app, this).open();
        return true;
      },
    });

    this.addCommand({
      id: "insert-current-subtitle-note",
      name: "Insert current subtitle with timestamp",
      icon: "message-square-plus",
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
      icon: "mic",
      editorCallback: async (editor: Editor) => {
        this.editor = editor;
        await this.startVoiceRecording();
      },
    });

    this.addCommand({
      id: "stop-voice-recording",
      name: "Stop voice recording and save note",
      icon: "square",
      editorCallback: async (editor: Editor) => {
        this.editor = editor;
        await this.stopVoiceRecording(editor);
      },
    });

    // ---- 听写模式命令 ----
    this.addCommand({
      id: "toggle-dictation",
      name: "Toggle dictation mode",
      icon: "ear",
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
      icon: "eye",
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
      icon: "step-back",
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
      icon: "step-forward",
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

  onunload(): void {
    this.stopDictationLoop();
    this.player = null;
    this.editor = null;
    this.setPlaying = null;
    this.currentUrl = null;
    this.currentUrlKey = null;
    this.currentMediaAlias = "";
    this.currentMediaSourceUrl = "";
    this.currentMediaDisplayPath = "";
    this.currentMediaVaultFile = null;
    this.clearMobileTimestampRail();
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
      const fs = this.getNodeFs();
      const path = this.getNodePath();
      if (!fs || !path) return null;
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
    } catch {
      // fs not available
    }
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
    } catch {
      // fall through
    }
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
    } catch {
      // not a URL
    }
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
    const aliasKeys = this.getSubtitleAliasKeys(url, vaultFile);

    // Try lookup by stable key first
    for (const key of aliasKeys) {
      const cached = this.settings.subtitleLibrary[key];
      if (cached && cached.length) {
        this.settings.subtitleLibrary[stableKey] = cached;
        return cached;
      }
    }

    // Fallback: try the raw url (backward compat)
    const legacyCached = this.settings.subtitleLibrary[url];
    if (legacyCached && legacyCached.length) return legacyCached;

    // Try subtitleFileMap with both keys — 从 vault 文件加载
    let mappedPath = "";
    for (const key of aliasKeys) {
      mappedPath = this.settings.subtitleFileMap[key];
      if (mappedPath) break;
    }
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
      } catch {
        // ignore
      }
    }
    return [];
  }

  getSubtitleAliasKeys(url: string, vaultFile?: TFile | null): string[] {
    const keys = new Set<string>();
    const add = (value?: string | null) => {
      const normalized = normalizeMediaCandidate(value || "");
      if (!normalized) return;
      keys.add(normalized);
      if (isYouTubeUrl(normalized)) keys.add(toYouTubeWatchUrl(normalized));
    };
    const addStable = (value?: string | null, file?: TFile | null) => {
      if (!value && !file) return;
      add(this.getStableSubtitleKey(value || "", file));
    };
    add(url);
    addStable(url, vaultFile);
    add(this.currentUrlKey);
    add(this.currentUrl);
    add(this.currentMediaSourceUrl);
    add(this.currentMediaDisplayPath);
    addStable(this.currentMediaSourceUrl);
    addStable(this.currentMediaDisplayPath);
    if (this.currentMediaVaultFile) {
      addStable(url, this.currentMediaVaultFile);
      addStable(this.currentMediaVaultFile.path, this.currentMediaVaultFile);
    }
    for (const [key, entry] of Object.entries(this.directUrlMap || {})) {
      if (!entry?.directUrl) continue;
      const directMatches =
        entry.directUrl === url ||
        entry.directUrl === this.currentUrl ||
        entry.directUrl === this.currentMediaSourceUrl;
      const originalMatches =
        key === url ||
        entry.originalUrl === url ||
        key === this.currentUrlKey ||
        entry.originalUrl === this.currentUrlKey;
      if (directMatches || originalMatches) {
        add(key);
        add(entry.originalUrl);
        add(entry.directUrl);
      }
    }
    return [...keys];
  }

  setCurrentSubtitle(subtitle: SubtitleCue | null): void {
    this.currentSubtitle = subtitle;
  }

  getTargetUrl(editor?: Editor): string | null {
    const selected = editor?.getSelection().trim() || "";
    if (selected) {
      const parsed = parseTimestampUrlBlock(selected);
      if (parsed.url && (isPlayableMedia(parsed.url) || /^https?:\/\//i.test(parsed.url))) {
        return parsed.url;
      }
      if (isPlayableMedia(selected)) return selected;
      const resolved = this.resolveMediaUrl(selected);
      if (resolved) return resolved.playableUrl;
    }
    return this.currentMediaSourceUrl || this.currentUrlKey || this.currentUrl;
  }

  getTargetAlias(editor?: Editor): string {
    const selected = editor?.getSelection().trim() || "";
    if (selected) {
      const parsed = parseTimestampUrlBlock(selected);
      if (parsed.alias) return parsed.alias;
    }
    if (this.currentMediaAlias) return this.currentMediaAlias;
    const activeFile = this.app.workspace.getActiveFile();
    if (activeFile?.basename) return activeFile.basename;
    return "";
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
      } catch {
        // ignore
      }
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
  getSubtitleStorageFolderCandidates(): string[] {
    return [
      this.settings.subtitleStorageFolder || "",
      DEFAULT_SETTINGS.subtitleStorageFolder || "",
      "Attachments/Subtitles",
      "Subtitles",
    ].filter((folder, index, folders) => folder && folders.indexOf(folder) === index)
      .map((folder) => normalizePath(folder));
  }

  getVaultSyncFileCandidatePaths(fileName: string, folderPaths: string[]): string[] {
    const candidates = new Set<string>();
    folderPaths
      .map((folder) => normalizePath(`${folder}/${fileName}`))
      .forEach((path) => candidates.add(path));
    this.app.vault.getFiles()
      .filter((file) => file.name === fileName)
      .forEach((file) => candidates.add(normalizePath(file.path)));
    return [...candidates];
  }

  getSubtitleIndexPath(): string {
    return normalizePath(`${this.settings.subtitleStorageFolder || "Subtitles"}/smart-media-notes-subtitles.json`);
  }

  getSubtitleIndexCandidatePaths(): string[] {
    return this.getVaultSyncFileCandidatePaths(
      "smart-media-notes-subtitles.json",
      this.getSubtitleStorageFolderCandidates(),
    );
  }

  async loadSubtitleIndexFromVault(): Promise<void> {
    for (const indexPath of this.getSubtitleIndexCandidatePaths()) {
      try {
        if (!(await this.app.vault.adapter.exists(indexPath))) continue;
        const raw = await this.app.vault.adapter.read(indexPath);
        const data = JSON.parse(raw) as Partial<SubtitleIndexData>;
        if (!data.subtitleFileMap || typeof data.subtitleFileMap !== "object") continue;
        this.settings.subtitleFileMap = {
          ...data.subtitleFileMap,
          ...(this.settings.subtitleFileMap || {}),
        };
      } catch {
        // Ignore invalid sync index files and continue with local mappings.
      }
    }
  }

  async saveSubtitleIndexToVault(): Promise<void> {
    const data: SubtitleIndexData = {
      version: 1,
      subtitleFileMap: this.settings.subtitleFileMap || {},
    };
    const serialized = JSON.stringify(data, null, 2);
    const candidatePaths = this.getSubtitleIndexCandidatePaths();
    const primaryFolder = await this.ensureFolder(this.settings.subtitleStorageFolder);
    const primaryPath = normalizePath(`${primaryFolder}/smart-media-notes-subtitles.json`);

    await this.app.vault.adapter.write(primaryPath, serialized);

    for (const indexPath of candidatePaths) {
      if (indexPath === primaryPath) continue;
      if (await this.app.vault.adapter.exists(indexPath)) {
        await this.app.vault.adapter.write(indexPath, serialized);
      }
    }
  }

  getDirectUrlMapPath(): string {
    return normalizePath(`${this.settings.subtitleStorageFolder || "Subtitles"}/smart-media-notes-direct-url-map.json`);
  }

  getDirectUrlMapCandidatePaths(): string[] {
    return this.getVaultSyncFileCandidatePaths(
      "smart-media-notes-direct-url-map.json",
      this.getSubtitleStorageFolderCandidates(),
    );
  }

  getDirectUrlKey(url: string): string {
    return isYouTubeUrl(url) ? toYouTubeWatchUrl(url) : normalizeMediaCandidate(url);
  }

  async cleanupLegacyDirectUrlFiles(): Promise<void> {
    const legacyPaths = this.getVaultSyncFileCandidatePaths(
      "smart-media-notes-youtube-direct.json",
      this.getSubtitleStorageFolderCandidates(),
    );
    for (const legacyPath of legacyPaths) {
      try {
        if (await this.app.vault.adapter.exists(legacyPath)) {
          await this.app.vault.adapter.remove(legacyPath);
        }
      } catch {
        // Ignore cleanup failures and keep the new unified map working.
      }
    }
  }

  private isDirectEntryInvalid(entry?: DirectUrlEntry | null): boolean {
    return !!entry?.invalidatedAt;
  }

  private getDirectEntryRank(sourceKey: string, entry?: DirectUrlEntry | null): number {
    if (!entry?.directUrl) return -100;
    if (this.isDirectEntryInvalid(entry)) return -50;
    if (this.isUnsupportedDirectUrlForSource(sourceKey, entry.directUrl)) return -20;
    if (this.isAudioOnlyDirectEntry(entry)) return -10;

    let score = 0;
    if (entry.mediaKind === "video") score += 50;
    if (entry.mediaKind === "hls") score += 10;
    if (entry.mediaKind === "audio") score -= 10;

    if (!this.isLikelyHlsDirectUrl(entry.directUrl)) score += 20;
    if (/mime=video%2F|mime=video\//i.test(entry.directUrl)) score += 15;
    if (/\.(mp4|webm|mkv|mov)(?:[/?#]|$)/i.test(entry.directUrl)) score += 10;
    if (/\b(vcodec|itag|clen|dur)=/i.test(entry.directUrl)) score += 5;

    return score;
  }

  private pickBetterDirectUrlEntry(
    sourceKey: string,
    current?: DirectUrlEntry | null,
    incoming?: DirectUrlEntry | null,
  ): DirectUrlEntry | null {
    if (!incoming?.directUrl) return current || null;
    if (!current?.directUrl) return incoming;

    const currentRank = this.getDirectEntryRank(sourceKey, current);
    const incomingRank = this.getDirectEntryRank(sourceKey, incoming);
    if (incomingRank !== currentRank) {
      return incomingRank > currentRank ? incoming : current;
    }

    const currentResolvedAt = current.resolvedAt || 0;
    const incomingResolvedAt = incoming.resolvedAt || 0;
    if (incomingResolvedAt !== currentResolvedAt) {
      return incomingResolvedAt > currentResolvedAt ? incoming : current;
    }

    const currentExpiresAt = current.expiresAt || 0;
    const incomingExpiresAt = incoming.expiresAt || 0;
    if (incomingExpiresAt !== currentExpiresAt) {
      return incomingExpiresAt > currentExpiresAt ? incoming : current;
    }

    return current;
  }

  async loadDirectUrlMapFromVault(): Promise<void> {
    try {
      const nextMap: Record<string, DirectUrlEntry> = {};
      let shouldResave = false;
      for (const mapPath of this.getDirectUrlMapCandidatePaths()) {
        if (!(await this.app.vault.adapter.exists(mapPath))) continue;
        const raw = await this.app.vault.adapter.read(mapPath);
        const data = JSON.parse(raw) as Partial<DirectUrlMapData>;
        if (data.entries && typeof data.entries === "object") {
          Object.entries(data.entries).forEach(([key, entry]) => {
            const best = this.pickBetterDirectUrlEntry(key, nextMap[key], entry);
            if (best && best !== nextMap[key]) nextMap[key] = best;
          });
        }
      }
      Object.entries(this.directUrlMap).forEach(([key, entry]) => {
        const best = this.pickBetterDirectUrlEntry(key, nextMap[key], entry);
        if (best && best !== nextMap[key]) nextMap[key] = best;
      });
      shouldResave = this.getDirectUrlMapCandidatePaths().length > 1;
      this.directUrlMap = nextMap;
      if (shouldResave && Object.keys(nextMap).length) {
        await this.saveDirectUrlMapToVault();
      }
      await this.cleanupLegacyDirectUrlFiles();
    } catch {
      this.directUrlMap = {};
    }
  }

  async saveDirectUrlMapToVault(): Promise<void> {
    const folder = await this.ensureFolder(this.settings.subtitleStorageFolder);
    const mapPath = normalizePath(`${folder}/smart-media-notes-direct-url-map.json`);
    const data: DirectUrlMapData = {
      version: 1,
      entries: this.directUrlMap,
    };
    const serialized = JSON.stringify(data, null, 2);
    const candidatePaths = this.getDirectUrlMapCandidatePaths();

    await this.app.vault.adapter.write(mapPath, serialized);

    for (const candidatePath of candidatePaths) {
      if (candidatePath === mapPath) continue;
      if (await this.app.vault.adapter.exists(candidatePath)) {
        await this.app.vault.adapter.write(candidatePath, serialized);
      }
    }

    await this.cleanupLegacyDirectUrlFiles();
  }

  getDirectUrlExpiry(directUrl: string): number {
    try {
      const expire = new URL(directUrl).searchParams.get("expire");
      const seconds = expire ? Number(expire) : 0;
      if (seconds > 0) return Math.max(Date.now(), seconds * 1000 - 5 * 60 * 1000);
    } catch {
      // Fall through to a conservative default.
    }
    return Date.now() + 6 * 60 * 60 * 1000;
  }

  private isLikelyHlsDirectUrl(value?: string): boolean {
    if (!value) return false;
    return /\.m3u8(?:[/?#]|$)/i.test(value) ||
      /\/manifest\/hls_|\/hls_playlist\/|playlist\/index\.m3u8/i.test(value);
  }

  private isUnsupportedDirectUrlForSource(sourceUrl: string, directUrl: string): boolean {
    // YouTube HLS manifests do not allow app://obsidian.md CORS access.
    // Only progressive single-file URLs are useful for YouTube direct playback.
    return isYouTubeUrl(sourceUrl) && this.isLikelyHlsDirectUrl(directUrl);
  }

  private isLikelyAudioDirectUrl(value?: string): boolean {
    if (!value) return false;
    return /\.(m4a|mp3|aac|ogg|oga|opus|wav|flac)(?:[/?#]|$)/i.test(value);
  }

  private isAudioOnlyDirectEntry(entry: DirectUrlEntry): boolean {
    return entry.mediaKind === "audio" ||
      (!entry.mediaKind && this.isLikelyAudioDirectUrl(entry.directUrl));
  }

  private getDirectUrlEntry(url: string, ...aliases: Array<string | null | undefined>): DirectUrlEntry | null {
    const keys = this.getDirectUrlLookupKeys(url, ...aliases);
    return keys.map((key) => this.directUrlMap[key]).find((item) => item?.directUrl) || null;
  }

  async invalidateDirectUrl(
    url: string,
    aliases: Array<string | null | undefined> = [],
    reason?: string,
  ): Promise<void> {
    const keys = this.getDirectUrlLookupKeys(url, ...aliases);
    let changed = false;
    keys.forEach((key) => {
      const entry = this.directUrlMap[key];
      if (!entry?.directUrl) return;
      entry.invalidatedAt = Date.now();
      entry.invalidReason = reason || "Playback failed in this Obsidian environment.";
      changed = true;
    });
    if (changed) await this.saveDirectUrlMapToVault();
  }

  getDirectUrlLookupKeys(...urls: Array<string | null | undefined>): string[] {
    const keys = new Set<string>();
    urls.forEach((url) => {
      const normalized = normalizeMediaCandidate(url || "");
      if (!normalized) return;
      keys.add(normalized);
      keys.add(this.getDirectUrlKey(normalized));
      if (isYouTubeUrl(normalized)) keys.add(toYouTubeWatchUrl(normalized));
    });
    return [...keys];
  }

  getValidDirectUrl(url: string, ...aliases: Array<string | null | undefined>): string {
    const entry = this.getDirectUrlEntry(url, ...aliases);
    if (!entry?.directUrl) return "";
    if (this.isUnsupportedDirectUrlForSource(url, entry.directUrl)) return "";
    if (this.isAudioOnlyDirectEntry(entry) && !isAudioFile(url)) return "";
    if (entry.invalidatedAt) return "";
    return entry.directUrl;
  }

  getDirectUrlStatus(url: string, ...aliases: Array<string | null | undefined>): { state: "ready" | "expired" | "missing"; label: string } {
    const entry = this.getDirectUrlEntry(url, ...aliases);
    if (!entry?.directUrl) return { state: "missing", label: "Direct URL not resolved" };
    if (this.isUnsupportedDirectUrlForSource(url, entry.directUrl)) {
      return {
        state: "expired",
        label: "Cached direct URL is YouTube HLS and cannot play in Obsidian",
      };
    }
    if (this.isAudioOnlyDirectEntry(entry) && !isAudioFile(url)) {
      return {
        state: "expired",
        label: "Cached direct URL is audio-only; refresh to resolve a video stream",
      };
    }
    if (entry.invalidatedAt) {
      return {
        state: "expired",
        label: entry.invalidReason || "Direct URL marked invalid after playback failure",
      };
    }
    return { state: "ready", label: "Direct URL ready" };
  }

  private isBrowserPlayableDirectUrl(value: string | undefined, sourceUrl: string): boolean {
    if (!value || !/^https?:\/\//i.test(value)) return false;
    if (this.isUnsupportedDirectUrlForSource(sourceUrl, value)) return false;
    return true;
  }

  private scoreYtdlpFormat(format: YtdlpFormat, sourceUrl: string): number {
    const url = format.url || "";
    if (!this.isBrowserPlayableDirectUrl(url, sourceUrl)) return -1;
    const ext = (format.ext || "").toLowerCase();
    const protocol = (format.protocol || "").toLowerCase();
    const hasVideo = Boolean(format.vcodec && format.vcodec !== "none");
    const hasAudio = Boolean(format.acodec && format.acodec !== "none");
    const hasVideoEvidence =
      hasVideo ||
      Boolean(format.width) ||
      Boolean(format.height) ||
      /\.(mp4|m4v|webm|mov|m3u8)(?:[/?#]|$)/i.test(url) ||
      protocol.includes("m3u8");
    const hasAudioEvidence =
      hasAudio ||
      this.isLikelyAudioDirectUrl(url) ||
      ext === "m4a" ||
      ext === "mp3";
    if (!isAudioFile(sourceUrl) && !hasVideoEvidence) return -1;
    if (!isAudioFile(sourceUrl) && hasAudioEvidence && !hasVideoEvidence) return -1;
    if (format.vcodec && format.acodec && (!hasVideo || !hasAudio)) return -1;
    if (isYouTubeUrl(sourceUrl) && (protocol.includes("m3u8") || ext === "m3u8")) {
      return -1;
    }
    const height = format.height || 0;
    const bitrate = format.tbr || 0;
    const hasKnownContainer =
      ["mp4", "m4v", "webm", "mov", "m3u8"].includes(ext) ||
      /\.(mp4|m4v|webm|mov|m3u8)(?:[/?#]|$)/i.test(url) ||
      protocol.includes("m3u8") ||
      protocol === "https" ||
      protocol === "http";
    let score = 0;
    if (!hasKnownContainer) score -= 300;
    if (hasVideo && hasAudio) score += 1000;
    if (hasVideo && !hasAudio) score -= 800;
    if (!hasVideo && hasAudio) score -= 900;
    if (ext === "mp4" || ext === "m4v") score += 500;
    if (ext === "webm") score += 260;
    if (ext === "m3u8") score += 230;
    if (protocol.includes("m3u8") || /\.m3u8(?:[/?#]|$)/i.test(url)) score += 210;
    if (protocol.includes("dash") || ext === "mpd") score -= 600;
    if (height) score += Math.min(height, 1080);
    if (bitrate) score += Math.min(bitrate, 4000) / 10;
    return score;
  }

  private getYtdlpMediaKind(format: YtdlpFormat): "video" | "audio" | "hls" {
    const url = format.url || "";
    const ext = (format.ext || "").toLowerCase();
    const protocol = (format.protocol || "").toLowerCase();
    if (protocol.includes("m3u8") || ext === "m3u8" || this.isLikelyHlsDirectUrl(url)) {
      return "hls";
    }
    if (
      format.vcodec === "none" ||
      (!format.vcodec && !format.width && !format.height && this.isLikelyAudioDirectUrl(url))
    ) {
      return "audio";
    }
    return "video";
  }

  private pickBrowserPlayableDirectUrl(info: YtdlpInfo, sourceUrl: string): DirectUrlCandidate | null {
    const directCandidates: YtdlpFormat[] = [
      {
        url: info.url,
        ext: info.ext,
        protocol: info.protocol,
        vcodec: info.vcodec,
        acodec: info.acodec,
        width: info.width,
        height: info.height,
      },
      ...(info.requested_downloads || []),
      ...(info.formats || []),
    ].filter((item) => Boolean(item.url));
    const ranked = directCandidates
      .map((format) => ({ format, score: this.scoreYtdlpFormat(format, sourceUrl) }))
      .filter((item) => item.score >= 0)
      .sort((a, b) => b.score - a.score);
    const best = ranked[0]?.format;
    if (!best?.url) return null;
    return {
      url: best.url,
      mediaKind: this.getYtdlpMediaKind(best),
    };
  }

  private async runYtdlpJson(
    childProcess: NodeChildProcess,
    executable: string,
    args: string[],
  ): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      childProcess.execFile(
        executable,
        args,
        { timeout: 60000, maxBuffer: 30 * 1024 * 1024 },
        (error, out, err) => {
          if (error) {
            reject(new Error(err || String(error)));
            return;
          }
          resolve(out);
        },
      );
    });
  }

  private isYtdlpFormatUnavailable(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return /requested format is not available|format not available|no video formats found/i.test(message);
  }

  async resolveAndSaveDirectUrl(url: string): Promise<void> {
    if (Platform.isMobileApp) {
      new Notice("yt-dlp direct URL resolving is only available on desktop.");
      return;
    }
    const childProcess = this.getNodeChildProcess();
    if (!childProcess?.execFile) {
      new Notice("Node child_process is unavailable in this Obsidian environment.");
      return;
    }
    const executable = this.settings.ytdlpPath || "yt-dlp";
    const baseArgs = [
      "--dump-single-json",
      "--no-playlist",
      "--no-warnings",
    ];
    const args = [
      ...baseArgs,
      "-f",
      isYouTubeUrl(url)
        ? "best[protocol=https][ext=mp4][vcodec!=none][acodec!=none]/best[protocol=http][ext=mp4][vcodec!=none][acodec!=none]/best[ext=mp4][vcodec!=none][acodec!=none]/best[ext=webm][vcodec!=none][acodec!=none]"
        : "best[ext=mp4][vcodec!=none][acodec!=none]/best[ext=webm][vcodec!=none][acodec!=none]/best[protocol*=m3u8][vcodec!=none]/best[vcodec!=none]",
      url,
    ];
    new Notice("Resolving direct URL with yt-dlp...");
    let stdout = "";
    try {
      stdout = await this.runYtdlpJson(childProcess, executable, args);
    } catch (error) {
      if (!this.isYtdlpFormatUnavailable(error)) {
        new Notice(`yt-dlp failed: ${error instanceof Error ? error.message : String(error)}`);
        return;
      }
      new Notice("Requested yt-dlp format was unavailable. Retrying with automatic format discovery...");
      try {
        stdout = await this.runYtdlpJson(childProcess, executable, [...baseArgs, url]);
      } catch (fallbackError) {
        new Notice(`yt-dlp failed: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`);
        return;
      }
    }
    if (!stdout) return;
    try {
      const info = JSON.parse(stdout) as YtdlpInfo;
      const directCandidate = this.pickBrowserPlayableDirectUrl(info, url);
      if (!directCandidate) {
        const message = isYouTubeUrl(url)
          ? "yt-dlp resolved this YouTube link, but only found HLS or separated streams. YouTube HLS is blocked by CORS in Obsidian; keep using iframe/external playback for this video."
          : "yt-dlp resolved this page, but did not find a browser-playable video URL. This site may expose audio-only, separated audio/video streams, headers, or cookies.";
        new Notice(message);
        return;
      }
      const key = this.getDirectUrlKey(url);
      this.directUrlMap[key] = {
        originalUrl: key,
        directUrl: directCandidate.url,
        title: info.title,
        extractor: info.extractor,
        mediaKind: directCandidate.mediaKind,
        resolvedAt: Date.now(),
        expiresAt: this.getDirectUrlExpiry(directCandidate.url),
      };
      await this.saveDirectUrlMapToVault();
      new Notice("Direct URL saved to the vault sync map.");
    } catch (error) {
      new Notice(`Could not parse yt-dlp output: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  collectSubtitleKeysForMedia(rawUrl: string): string[] {
    const keys = new Set<string>();
    const add = (value?: string | null) => {
      if (value) keys.add(value);
    };
    this.getSubtitleAliasKeys(rawUrl).forEach((key) => add(key));
    const resolved = this.resolveMediaUrl(rawUrl);
    if (resolved) {
      add(resolved.displayPath);
      add(resolved.playableUrl);
      add(this.getStableSubtitleKey(resolved.playableUrl, resolved.vaultFile || null));
      add(this.getStableSubtitleKey(resolved.displayPath, resolved.vaultFile || null));
    }
    return [...keys];
  }

  getSubtitlePathForMedia(rawUrl: string): string {
    const map = this.settings.subtitleFileMap || {};
    for (const key of this.collectSubtitleKeysForMedia(rawUrl)) {
      if (map[key]) return map[key];
    }
    return "";
  }

  private async collectSubtitleReferenceIndex(): Promise<SubtitleReferenceIndex> {
    const keys = new Set<string>();
    const labelsByKey = new Map<string, Set<string>>();
    const addMedia = (rawUrl: string, label?: string) => {
      if (!rawUrl) return;
      const resolved = this.resolveMediaUrl(rawUrl);
      const displayLabel =
        label ||
        resolved?.displayPath?.split("/").pop()?.replace(/\.[^.]+$/, "") ||
        rawUrl;
      this.collectSubtitleKeysForMedia(rawUrl).forEach((key) => {
        keys.add(key);
        if (!labelsByKey.has(key)) labelsByKey.set(key, new Set<string>());
        labelsByKey.get(key)?.add(displayLabel);
      });
    };

    for (const file of this.app.vault.getMarkdownFiles()) {
      try {
        const content = await this.app.vault.read(file);
        const regex = /```timestamp-url\n([\s\S]*?)\n```/g;
        let match: RegExpExecArray | null;
        while ((match = regex.exec(content)) !== null) {
          const parsed = parseTimestampUrlBlock(match[1].trim());
          addMedia(parsed.url, parsed.alias || file.basename);
        }
      } catch {
        // Ignore unreadable notes.
      }
    }

    for (const entry of this.settings.timestampCollection || []) {
      addMedia(entry.displayPath || entry.url, entry.title || entry.displayPath || entry.url);
      addMedia(entry.url, entry.title || entry.displayPath || entry.url);
    }

    return { keys, labelsByKey };
  }

  async getSubtitleLibraryItems(): Promise<SubtitleLibraryItem[]> {
    await this.loadSubtitleIndexFromVault();
    const referenceIndex = await this.collectSubtitleReferenceIndex();
    const pathToKeys = new Map<string, Set<string>>();
    const allPaths = new Set<string>();

    for (const [key, path] of Object.entries(this.settings.subtitleFileMap || {})) {
      if (!path) continue;
      const normalized = normalizePath(path);
      allPaths.add(normalized);
      if (!pathToKeys.has(normalized)) pathToKeys.set(normalized, new Set<string>());
      pathToKeys.get(normalized)?.add(key);
    }

    const folders = this.getSubtitleStorageFolderCandidates();
    for (const file of this.app.vault.getFiles()) {
      const ext = file.extension.toLowerCase();
      if (ext !== "srt" && ext !== "vtt") continue;
      const inSubtitleFolder = folders.some((folder) =>
        file.path === folder || file.path.startsWith(folder + "/"),
      );
      if (inSubtitleFolder) allPaths.add(file.path);
    }

    const items: SubtitleLibraryItem[] = [];
    for (const path of [...allPaths].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))) {
      const mappedKeys = [...(pathToKeys.get(path) || new Set<string>())];
      const exists = await this.app.vault.adapter.exists(path);
      const activeKeys = mappedKeys.filter((key) => referenceIndex.keys.has(key));
      const labels = [...new Set(activeKeys.flatMap((key) => [...(referenceIndex.labelsByKey.get(key) || [])]))];
      const status: SubtitleLibraryItem["status"] = exists
        ? activeKeys.length
          ? "linked"
          : "unused"
        : "missing";
      items.push({ path, exists, status, mappedKeys, activeKeys, labels });
    }
    return items;
  }

  async deleteSubtitleLibraryItem(path: string): Promise<void> {
    const normalized = normalizePath(path);
    const file = this.app.vault.getAbstractFileByPath(normalized);
    if (file) {
      await this.app.vault.delete(file, true);
    } else if (await this.app.vault.adapter.exists(normalized)) {
      await this.app.vault.adapter.remove(normalized);
    }

    for (const [key, mappedPath] of Object.entries(this.settings.subtitleFileMap || {})) {
      if (normalizePath(mappedPath) === normalized) delete this.settings.subtitleFileMap[key];
    }
    this.settings.subtitleLibrary = {};
    await this.saveSubtitleIndexToVault();
    await this.saveSettings();
  }

  async reconcileSubtitleIndex(): Promise<void> {
    await this.loadSubtitleIndexFromVault();
    const referenceIndex = await this.collectSubtitleReferenceIndex();

    const nextMap: Record<string, string> = {};
    let kept = 0;
    let removed = 0;
    for (const [key, path] of Object.entries(this.settings.subtitleFileMap || {})) {
      const exists = await this.app.vault.adapter.exists(path);
      if (exists && referenceIndex.keys.has(key)) {
        nextMap[key] = path;
        kept++;
      } else {
        removed++;
      }
    }
    this.settings.subtitleFileMap = nextMap;
    this.settings.subtitleLibrary = {};
    await this.saveSubtitleIndexToVault();
    await this.saveSettings();
    new Notice(`Subtitle index reconciled: ${kept} mappings kept, ${removed} stale mappings removed.`);
  }

  async importSubtitlesForUrl(url: string, file: File): Promise<void> {
    return this.importSubtitlesForMedia(url, file);
  }

  async importSubtitlesForMedia(
    url: string,
    file: File,
    mediaContext?: {
      alias?: string;
      sourceUrl?: string;
      displayPath?: string;
      vaultFile?: TFile | null;
    },
  ): Promise<void> {
    const content = await file.text();
    const cues = parseSubtitleFile(content, file.name);
    if (!cues.length) {
      new Notice("No subtitle cues were detected in that file.");
      return;
    }
    const contextVaultFile = mediaContext?.vaultFile ?? this.currentMediaVaultFile;
    const sourceUrl = mediaContext?.sourceUrl || this.currentMediaSourceUrl || "";
    const displayPath = mediaContext?.displayPath || this.currentMediaDisplayPath || "";
    const stableKey = this.getStableSubtitleKey(url, contextVaultFile);
    this.settings.subtitleLibrary[stableKey] = cues;
    const aliasKeys = [
      ...this.getSubtitleAliasKeys(url, contextVaultFile),
      ...this.getSubtitleAliasKeys(sourceUrl, contextVaultFile),
      ...this.getSubtitleAliasKeys(displayPath, contextVaultFile),
    ].filter((key, index, keys) => key && key !== stableKey && keys.indexOf(key) === index);
    aliasKeys.forEach((key) => {
      this.settings.subtitleLibrary[key] = cues;
    });
    const folder = await this.ensureFolder(this.settings.subtitleStorageFolder);
    const alias = mediaContext?.alias || this.getTargetAlias(this.editor || undefined);
    const readableTarget = alias || displayPath || sourceUrl || stableKey;
    const safeName = urlToReadableSubtitleName(readableTarget, file.name, stableKey);
    const ext = file.name.toLowerCase().endsWith(".vtt") ? ".vtt" : ".srt";
    const subtitlePath = normalizePath(`${folder}/${safeName}${ext}`);
    await this.app.vault.adapter.write(subtitlePath, content);
    this.settings.subtitleFileMap[stableKey] = subtitlePath;
    aliasKeys.forEach((key) => {
      this.settings.subtitleFileMap[key] = subtitlePath;
    });
    await this.saveSubtitleIndexToVault();
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
        const fs = this.getNodeFs();
        const path = this.getNodePath();
        if (!fs || !path) return [];
        const found: MediaFileEntry[] = [];
        const walk = (dir: string) => {
          let entries: Array<{ name: string; isDirectory(): boolean }>;
          try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
          } catch {
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
      } catch {
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

  getMarkdownViewForEditor(editor: Editor | null): MarkdownView | null {
    const leaves = this.app.workspace.getLeavesOfType("markdown");
    for (const leaf of leaves) {
      if (leaf.view instanceof MarkdownView && (!editor || leaf.view.editor === editor)) {
        return leaf.view;
      }
    }
    return this.app.workspace.getActiveViewOfType(MarkdownView);
  }

  seekToTimestamp(seconds: number): void {
    const fallbackUrl = toExternalTimestampUrl(
      this.currentUrlKey || this.currentUrl || "",
      seconds,
    );
    if (fallbackUrl && Platform.isMobileApp) {
      if (this.currentUrlCanSeek && this.player) {
        this.player.seekTo(seconds);
      } else {
        window.open(fallbackUrl, "_blank", "noopener,noreferrer");
      }
      return;
    }
    if (this.player) this.player.seekTo(seconds);
    else if (fallbackUrl) window.open(fallbackUrl, "_blank", "noopener,noreferrer");
  }

  getTimestampLabel(entry: { time: string; subhead?: string }): string {
    const mode = this.settings.timestampDisplayMode || "time-subhead";
    const subhead = entry.subhead?.trim() || "";
    if (mode === "subhead" && subhead) return subhead;
    if (mode === "time") return entry.time;
    return subhead ? `${entry.time} ${subhead}` : entry.time;
  }

  renderTimestampButtonLabel(button: HTMLElement, entry: TimestampNode): void {
    button.empty();
    const mode = this.settings.timestampDisplayMode || "time-subhead";
    const hasSubhead = Boolean(entry.subhead);
    if (mode === "subhead" && hasSubhead) {
      button.createSpan({ cls: "smn-timestamp-subhead", text: entry.subhead });
      return;
    }
    button.createSpan({ cls: "smn-timestamp-time", text: entry.time });
    if (mode !== "time" && hasSubhead) {
      button.createSpan({ cls: "smn-timestamp-subhead", text: entry.subhead });
    }
  }

  extractTimestampEntriesFromSource(source: string): TimestampNode[] {
    const entries: TimestampNode[] = [];
    let currentSubhead = "";
    const lines = source.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      const subheadMatch = trimmed.match(/^#{1,6}\s*(.+)$/);
      if (subheadMatch) {
        currentSubhead = subheadMatch[1].trim();
        continue;
      }
      const timeRegex = /\b\d{1,2}:\d{1,2}(?::\d{1,2})?\b/g;
      let timeMatch: RegExpExecArray | null;
      while ((timeMatch = timeRegex.exec(line)) !== null) {
        const seconds = parseTimestampToSeconds(timeMatch[0]);
        if (seconds == null) continue;
        const time = formatSecondsAsTimestamp(seconds);
        const node: TimestampNode = {
          time,
          subhead: currentSubhead,
          label: "",
          seconds,
        };
        node.label = this.getTimestampLabel(node);
        entries.push(node);
      }
    }
    return entries;
  }

  getTimestampPreviewRange(content: string, seconds: number): {
    text: string;
    startLine: number;
    endLine: number;
  } | null {
    const lines = content.split("\n");
    const time = formatSecondsAsTimestamp(seconds);
    const compactTime = time.replace(/^00:/, "");
    const index = lines.findIndex((line) =>
      line.includes(time) || line.includes(compactTime),
    );
    if (index < 0) return null;
    const start = Math.max(0, index - 2);
    const end = Math.min(lines.length, index + 5);
    const text = lines
      .slice(start, end)
      .join("\n")
      .slice(0, 700);
    return { text, startLine: start, endLine: end };
  }

  extractTimestampEntries(content: string): TimestampNode[] {
    const entries: TimestampNode[] = [];
    const blockRegex = /```timestamp\s*\n([\s\S]*?)```/g;
    let blockMatch: RegExpExecArray | null;
    while ((blockMatch = blockRegex.exec(content)) !== null) {
      const nodes = this.extractTimestampEntriesFromSource(blockMatch[1]);
      nodes.forEach((node) => {
        const preview = this.getTimestampPreviewRange(content, node.seconds);
        if (preview) {
          node.preview = preview.text;
          node.previewStartLine = preview.startLine;
          node.previewEndLine = preview.endLine;
        }
      });
      entries.push(...nodes);
    }
    return entries;
  }

  extractTimestampEntriesByMedia(content: string): TimestampNode[] {
    const entries: TimestampNode[] = [];
    const blockRegex = /```(timestamp-url|timestamp)\s*\n([\s\S]*?)```/g;
    let currentMediaUrl = "";
    let blockMatch: RegExpExecArray | null;
    while ((blockMatch = blockRegex.exec(content)) !== null) {
      if (blockMatch[1] === "timestamp-url") {
        currentMediaUrl = parseTimestampUrlBlock(blockMatch[2].trim()).url;
        continue;
      }
      const nodes = this.extractTimestampEntriesFromSource(blockMatch[2]);
      nodes.forEach((node) => {
        node.mediaUrl = currentMediaUrl;
        entries.push(node);
      });
    }
    return entries;
  }

  getTimestampMediaMatchKeys(rawUrl?: string | null): string[] {
    const keys = new Set<string>();
    const add = (value?: string | null) => {
      const normalized = normalizeMediaCandidate(value || "");
      if (!normalized) return;
      keys.add(normalized);
      keys.add(this.getStableSubtitleKey(normalized));
      keys.add(this.getDirectUrlKey(normalized));
      if (isYouTubeUrl(normalized)) keys.add(toYouTubeWatchUrl(normalized));
    };
    add(rawUrl);
    const resolved = rawUrl ? this.resolveMediaUrl(rawUrl) : null;
    if (resolved) {
      add(resolved.displayPath);
      add(resolved.playableUrl);
      add(this.getStableSubtitleKey(resolved.playableUrl, resolved.vaultFile || null));
      add(this.getStableSubtitleKey(resolved.displayPath, resolved.vaultFile || null));
    }
    for (const [key, entry] of Object.entries(this.directUrlMap || {})) {
      if (!entry?.directUrl) continue;
      if (keys.has(key) || keys.has(entry.originalUrl) || keys.has(entry.directUrl)) {
        add(key);
        add(entry.originalUrl);
        add(entry.directUrl);
      }
    }
    return [...keys];
  }

  timestampNodeMatchesMedia(node: TimestampNode, mediaUrl: string, displayPath?: string): boolean {
    if (!node.mediaUrl) return false;
    const candidates = new Set<string>([
      ...this.getTimestampMediaMatchKeys(mediaUrl),
      ...this.getTimestampMediaMatchKeys(displayPath),
    ]);
    return this.getTimestampMediaMatchKeys(node.mediaUrl).some((key) => candidates.has(key));
  }

  async getTimestampEntriesForNote(
    notePath: string,
    mediaUrl?: string,
    displayPath?: string,
  ): Promise<TimestampNode[]> {
    if (!notePath) return [];
    const file = this.app.vault.getAbstractFileByPath(notePath);
    if (!(file instanceof TFile)) return [];
    try {
      const content = await this.app.vault.read(file);
      if (!mediaUrl) return this.extractTimestampEntries(content);
      return this.extractTimestampEntriesByMedia(content)
        .filter((node) => this.timestampNodeMatchesMedia(node, mediaUrl, displayPath));
    } catch {
      return [];
    }
  }

  clearMobileTimestampRail(): void {
    this.mobileTimestampRailEl?.remove();
    this.mobileTimestampRailEl = null;
    this.mobileTimestampRailView?.containerEl.removeClass("smn-mobile-timestamp-mode");
    this.mobileTimestampRailView = null;
    this.mobileTimestampRailEditMode = false;
  }

  async toggleMobileTimestampRail(): Promise<void> {
    this.settings.showMobileTimestampRail = this.settings.showMobileTimestampRail === false;
    await this.saveSettings();

    if (!Platform.isMobileApp) {
      new Notice(
        `Mobile timestamp rail ${this.settings.showMobileTimestampRail ? "enabled" : "disabled"}.`,
      );
      return;
    }

    if (this.settings.showMobileTimestampRail === false) {
      this.clearMobileTimestampRail();
      new Notice("Mobile timestamp rail disabled.");
      return;
    }

    const editor = this.getActiveEditor();
    await this.showMobileTimestampRail(editor);
    new Notice("Mobile timestamp rail enabled.");
  }

  async toggleMobileTimestampRailEditMode(): Promise<void> {
    this.mobileTimestampRailEditMode = !this.mobileTimestampRailEditMode;

    if (!Platform.isMobileApp) {
      new Notice(
        `Mobile timestamp rail edit mode ${this.mobileTimestampRailEditMode ? "enabled" : "disabled"}.`,
      );
      return;
    }

    const editor = this.getActiveEditor();
    if (this.mobileTimestampRailEl) {
      await this.showMobileTimestampRail(editor);
    }
    new Notice(
      this.mobileTimestampRailEditMode
        ? "Mobile timestamp rail edit mode enabled."
        : "Mobile timestamp rail preview mode restored.",
    );
  }

  async saveMobileTimestampPreview(
    view: MarkdownView,
    startLine: number,
    endLine: number,
    nextText: string,
  ): Promise<void> {
    const normalizedText = nextText.replace(/\r/g, "");
    const editor = view.editor;
    if (editor) {
      editor.replaceRange(
        normalizedText,
        { line: startLine, ch: 0 },
        {
          line: endLine,
          ch: 0,
        },
      );
      new Notice("Note snippet updated.");
      return;
    }
    if (!view.file) return;
    const content = await this.app.vault.read(view.file);
    const lines = content.split("\n");
    lines.splice(startLine, endLine - startLine, ...normalizedText.split("\n"));
    await this.app.vault.modify(view.file, lines.join("\n"));
    new Notice("Note snippet updated.");
  }

  async showMobileTimestampRail(editor: Editor | null): Promise<void> {
    if (!Platform.isMobileApp) return;
    if (this.settings.showMobileTimestampRail === false) {
      this.clearMobileTimestampRail();
      return;
    }
    const view = this.getMarkdownViewForEditor(editor);
    if (!view) return;
    const content = editor
      ? editor.getValue()
      : view.file
        ? await this.app.vault.read(view.file)
        : "";
    const timestamps = this.extractTimestampEntries(content);
    this.clearMobileTimestampRail();

    view.containerEl.addClass("smn-mobile-timestamp-mode");
    this.mobileTimestampRailView = view;
    const rail = view.containerEl.createDiv({ cls: "smn-mobile-timestamp-rail" });
    this.mobileTimestampRailEl = rail;

    const header = rail.createDiv({ cls: "smn-mobile-timestamp-rail-header" });
    const headerText = header.createDiv({ cls: "smn-mobile-timestamp-rail-title" });
    headerText.createSpan({ text: "Timestamps" });
    headerText.createEl("small", {
      text: view.file?.basename || "Current note",
    });
    const closeBtn = header.createEl("button", {
      cls: "smn-mobile-timestamp-rail-close",
      text: "Exit",
      title: "Show the full note again",
    });
    closeBtn.addEventListener("click", () => this.clearMobileTimestampRail());

    const list = rail.createDiv({ cls: "smn-mobile-timestamp-rail-list" });
    if (!timestamps.length) {
      list.createDiv({
        cls: "smn-mobile-timestamp-rail-empty",
        text: "No timestamp blocks found in this note.",
      });
      const exitBtn = rail.createEl("button", {
        cls: "smn-mobile-timestamp-rail-exit",
        text: "Exit timestamp rail",
      });
      exitBtn.addEventListener("click", () => this.clearMobileTimestampRail());
      return;
    }
    timestamps.forEach((entry) => {
      const item = list.createDiv({ cls: "smn-mobile-timestamp-rail-row" });
      const button = item.createEl("button", {
        cls: "smn-mobile-timestamp-rail-item",
        text: entry.label,
      });
      button.addEventListener("click", () => this.seekToTimestamp(entry.seconds));
      if (
        this.settings.showMobileTimestampRailPreview === true &&
        entry.preview &&
        entry.previewStartLine != null &&
        entry.previewEndLine != null
      ) {
        const expandBtn = item.createEl("button", {
          cls: "smn-mobile-timestamp-rail-expand",
          text: "+",
          title: this.mobileTimestampRailEditMode
            ? "Edit nearby note content"
            : "Preview nearby note content",
        });
        const preview = item.createDiv({ cls: "smn-mobile-timestamp-rail-preview" });
        if (this.mobileTimestampRailEditMode) {
          const textarea = preview.createEl("textarea", {
            cls: "smn-mobile-timestamp-rail-editor",
            text: entry.preview,
          });
          const actions = preview.createDiv({ cls: "smn-mobile-timestamp-rail-actions" });
          const saveBtn = actions.createEl("button", {
            cls: "smn-mobile-timestamp-rail-save",
            text: "Save",
          });
          saveBtn.addEventListener("click", async (event) => {
            event.stopPropagation();
            saveBtn.disabled = true;
            await this.saveMobileTimestampPreview(
              view,
              entry.previewStartLine!,
              entry.previewEndLine!,
              textarea.value,
            );
            saveBtn.disabled = false;
          });
        } else {
          preview.createDiv({
            cls: "smn-mobile-timestamp-rail-preview-text",
            text: entry.preview,
          });
        }
        preview.style.display = "none";
        expandBtn.addEventListener("click", (event) => {
          event.stopPropagation();
          const shouldShow = preview.style.display === "none";
          preview.style.display = shouldShow ? "block" : "none";
          expandBtn.setText(shouldShow ? "-" : "+");
        });
      }
    });
    const exitBtn = rail.createEl("button", {
      cls: "smn-mobile-timestamp-rail-exit",
      text: "Exit timestamp rail",
    });
    exitBtn.addEventListener("click", () => this.clearMobileTimestampRail());
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
    options?: { skipInsert?: boolean; directPlaybackOverride?: boolean },
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
      {
        alias: meta.title,
        sourceUrl: meta.displayPath || url,
        displayPath: meta.displayPath || url,
        directPlaybackOverride: options?.directPlaybackOverride,
      },
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
      } catch {
        // ignore frontmatter parse errors
      }
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
          } catch {
            // ignore
          }

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
      } catch {
        // skip unreadable files
      }
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
    mediaContext?: {
      alias?: string;
      sourceUrl?: string;
      displayPath?: string;
      directPlaybackOverride?: boolean;
    },
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
    let usedDirectUrl = false;
    const shouldUseDirectPlayback =
      mediaContext?.directPlaybackOverride ??
      (Platform.isMobileApp && isYouTubeUrl(url) ? true : this.settings.directPlayback);
    if (
      !systemPath &&
      shouldUseDirectPlayback &&
      /^https?:\/\//i.test(url)
    ) {
      await this.loadDirectUrlMapFromVault();
      const directUrl = this.getValidDirectUrl(
        url,
        mediaContext?.sourceUrl,
        mediaContext?.displayPath,
      );
      if (directUrl) {
        resolvedUrl = directUrl;
        usedDirectUrl = true;
      } else {
        const reloadedDirectUrl = this.getValidDirectUrl(
          url,
          mediaContext?.sourceUrl,
          mediaContext?.displayPath,
        );
        if (reloadedDirectUrl) {
          resolvedUrl = reloadedDirectUrl;
          usedDirectUrl = true;
        }
      }
    }
    if (!usedDirectUrl && !systemPath && Platform.isMobileApp && isYouTubeUrl(url)) {
      this.clearMobileTimestampRail();
      window.open(toYouTubeWatchUrl(url), "_blank", "noopener,noreferrer");
      new Notice("Opening YouTube externally on mobile.");
      return;
    }
    if (
      !systemPath &&
      this.settings.experimentalBilibiliDirectPlayback &&
      isBilibiliUrl(url)
    ) {
      const source = await resolveBilibiliSource(url, {
        preferDirect: true,
        cookie: this.settings.bilibiliCookie,
      });
      if (source.type === "direct") {
        resolvedUrl = source.url;
        new Notice("Bilibili direct playback enabled for this video.");
      }
    }
    this.currentUrl = resolvedUrl;
    this.currentUrlKey = systemPath || isBilibiliUrl(url) || usedDirectUrl ? url : resolvedUrl;
    this.currentUrlCanSeek = usedDirectUrl || (!isYouTubeUrl(url) && (!isBilibiliUrl(url) || resolvedUrl !== url));
    this.currentMediaAlias = mediaContext?.alias || "";
    this.currentMediaSourceUrl = mediaContext?.sourceUrl || url;
    this.currentMediaDisplayPath = mediaContext?.displayPath || mediaContext?.sourceUrl || url;
    this.currentMediaVaultFile = vaultFile;
    this.editor = editor;
    await this.showMobileTimestampRail(editor);
    const isBilibiliDirectAttempt = isBilibiliUrl(url) && resolvedUrl !== url;

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
            if (isBilibiliDirectAttempt) {
              new Notice("Bilibili direct playback failed. Falling back to embedded player.");
              const previous = this.settings.experimentalBilibiliDirectPlayback;
              this.settings.experimentalBilibiliDirectPlayback = false;
              void this.activateView(url, editor, vaultFile, mediaContext).finally(() => {
                this.settings.experimentalBilibiliDirectPlayback = previous;
              });
              return;
            }
            if (usedDirectUrl) {
              new Notice("Direct URL playback failed. Marking this cached URL invalid and falling back.");
              void this.invalidateDirectUrl(
                url,
                [mediaContext?.sourceUrl, mediaContext?.displayPath],
                err,
              ).finally(() => {
                void this.activateView(url, editor, vaultFile, {
                  ...mediaContext,
                  directPlaybackOverride: false,
                });
              });
              return;
            }
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
            this.clearMobileTimestampRail();
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
            await this.activateView(newUrl, this.editor, file, {
              alias: file.basename,
              sourceUrl: file.path,
              displayPath: file.path,
            });
          },
          isAudio: audio,
          forceNativePlayer: usedDirectUrl,
        };
        leaf.setEphemeralState(state);
        void this.saveSettings();
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
        directPlayback:
          data.directPlayback ?? data.youtubeDirectPlayback ?? DEFAULT_SETTINGS.directPlayback,
        ytdlpPath:
          data.ytdlpPath || data.youtubeDlpPath || DEFAULT_SETTINGS.ytdlpPath,
        urlStartTimeMap: map,
        // 强制字幕缓存为空 — 从磁盘文件按需加载
        subtitleLibrary: {},
        subtitleFileMap: data.subtitleFileMap || {},
        directPlaybackOverrides: data.directPlaybackOverrides || {},
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
    await this.loadSubtitleIndexFromVault();
    await this.loadDirectUrlMapFromVault();
  }

  async saveSettings(): Promise<void> {
    // 不持久化 subtitleLibrary — 它只是运行时缓存
    const { subtitleLibrary: _subtitleLibrary, ...toSave } = this.settings;
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
    void this.plugin.activateView(resourceUrl, this.plugin.editor, file, {
      alias: file.basename,
      sourceUrl: file.path,
      displayPath: file.path,
    });
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
        await this.plugin.activateView(ep.url, this.editor, null, {
          alias: ep.title,
          sourceUrl: ep.url,
          displayPath: ep.url,
        });
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
  activateView: (
    url: string,
    editor: Editor | null,
    vaultFile?: TFile | null,
    mediaContext?: {
      alias?: string;
      sourceUrl?: string;
      displayPath?: string;
    },
  ) => void;
  editor: Editor | null;

  constructor(
    app: App,
    activateView: (
      url: string,
      editor: Editor | null,
      vaultFile?: TFile | null,
      mediaContext?: {
        alias?: string;
        sourceUrl?: string;
        displayPath?: string;
      },
    ) => void,
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
        const file = target.files[0];
        const url = URL.createObjectURL(file);
        this.activateView(url, this.editor, null, {
          alias: file.name.replace(/\.[^.]+$/, ""),
          sourceUrl: file.name,
          displayPath: file.name,
        });
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
    const targetAlias = this.plugin.getTargetAlias(this.plugin.editor || undefined);
    contentEl.createEl("h3", { text: "Import subtitle file" });
    if (!targetUrl) {
      contentEl.createEl("p", {
        text: "Open a media file first, or select a playable URL in the editor before importing subtitles.",
      });
      return;
    }
    contentEl.createEl("p", {
      text: "Choose a .srt or .vtt file. Smart Media Notes will save a renamed copy in your vault subtitle folder.",
    });
    contentEl.createEl("p", {
      text: targetAlias
        ? `Current media: ${targetAlias}`
        : `Current media: ${this.plugin.currentMediaDisplayPath || targetUrl}`,
    });
    contentEl.createEl("p", {
      text: `Linked URL/path: ${targetUrl}`,
      cls: "smn-subtitle-modal-link",
    });
    const pickerRow = contentEl.createEl("div", { cls: "smn-subtitle-import-row" });
    const pickButton = pickerRow.createEl("button", {
      cls: "smn-subtitle-import-button",
      text: "Choose subtitle file",
    });
    const pickedName = pickerRow.createEl("span", {
      cls: "smn-subtitle-import-name",
      text: "No file selected",
    });
    const input = contentEl.createEl("input");
    input.setAttribute("type", "file");
    input.setAttribute(
      "accept",
      ".srt,.vtt,text/vtt,application/x-subrip",
    );
    input.addClass("smn-hidden-file-input");
    pickButton.addEventListener("click", () => input.click());
    input.onchange = async (e: Event) => {
      const target = e.target as HTMLInputElement;
      const file = target.files?.[0];
      if (!file) return;
      pickedName.setText(file.name);
      pickButton.setText("Importing...");
      pickButton.disabled = true;
      await this.plugin.importSubtitlesForUrl(targetUrl, file);
      this.close();
    };
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
