import { Editor, ItemView, MarkdownView, Modal, Notice, TFile, WorkspaceLeaf } from "obsidian";
import React from "react";
import { createRoot, Root } from "react-dom/client";
import VideoContainer, { PlaylistInfo } from "./VideoContainer";
import {
  MediaFileEntry,
  PodcastEpisode,
  SubtitleCue,
  isBilibiliUrl,
  isHlsUrl,
  isYouTubeUrl,
} from "../utils";
import type SmartMediaNotesPlugin from "../main";

interface PlayerHandle {
  seekTo(seconds: number): void;
  getCurrentTime(): number;
  props?: {
    playing?: boolean;
  };
}

interface RssSubscriptionEntry {
  title: string;
  url: string;
}

export const VIDEO_VIEW = "video-view";
export const LIBRARY_VIEW = "smart-media-library-view";

interface EphemeralState {
  url: string;
  setupPlayer: (player: PlayerHandle, setPlaying: (p: boolean) => void) => void;
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
  playlist?: PlaylistInfo | null;
  onNavigatePlaylist?: (file: TFile) => Promise<void>;
  isAudio?: boolean;
  forceNativePlayer?: boolean;
}

export class VideoView extends ItemView {
  root: Root;
  saveTimeOnUnload: () => Promise<void> = () => Promise.resolve();
  currentEphemeralState?: EphemeralState;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
    this.root = createRoot(this.containerEl.children[1]);
  }

  getViewType(): string {
    return VIDEO_VIEW;
  }

  getDisplayText(): string {
    return "Smart Media Notes";
  }

  getIcon(): string {
    return "video";
  }

  setEphemeralState(state: EphemeralState): void {
    this.currentEphemeralState = state;
    this.saveTimeOnUnload = state.saveTimeOnUnload;
    this.root.render(
      React.createElement(VideoContainer, {
        url: state.url,
        start: state.start,
        setupPlayer: state.setupPlayer,
        setupError: state.setupError,
        subtitles: state.subtitles,
        onSubtitleChange: state.onSubtitleChange,
        showSubtitleOverlay: state.showSubtitleOverlay,
        showSubtitleBrowser: state.showSubtitleBrowser,
        subtitleOverlayFontSize: state.subtitleOverlayFontSize,
        dictationMode: state.dictationMode,
        dictationLoopCount: state.dictationLoopCount,
        dictationLoopGap: state.dictationLoopGap,
        playlist: state.playlist,
        onNavigatePlaylist: state.onNavigatePlaylist,
        isAudio: state.isAudio,
        forceNativePlayer: state.forceNativePlayer,
      }),
    );
  }

  async onClose(): Promise<void> {
    if (this.saveTimeOnUnload) await this.saveTimeOnUnload();
    this.root.unmount();
  }
}

export class MediaLibraryView extends ItemView {
  plugin: SmartMediaNotesPlugin;

  constructor(leaf: WorkspaceLeaf, plugin: SmartMediaNotesPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return LIBRARY_VIEW;
  }

  getDisplayText(): string {
    return "Media Library";
  }

  getIcon(): string {
    return "library";
  }

  async onOpen(): Promise<void> {
    await this.render();
    this.registerEvent(this.app.vault.on("create", () => this.render()));
    this.registerEvent(this.app.vault.on("delete", () => this.render()));
    this.registerEvent(this.app.vault.on("rename", () => this.render()));
  }

  async render(): Promise<void> {
    const container = this.containerEl.children[1];
    container.empty();
    container.setCssProps({ padding: "0" });

    const wrap = container.createEl("div", {
      cls: "smn-library-wrap",
    });

    const header = wrap.createEl("div", {
      cls: "smn-library-header",
    });
    const headerText = header.createEl("div", { cls: "smn-library-header-text" });
    headerText.createEl("div", {
      cls: "smn-library-title",
      text: "Smart Media Library",
    });
    headerText.createEl("div", {
      cls: "smn-library-subtitle",
      text: "Media, subtitles, feeds, and vault files",
    });
    const refreshBtn = header.createEl("button", {
      cls: "smn-library-header-action",
      text: "Refresh",
      title: "Reconcile saved media and synced subtitle index",
    });
    refreshBtn.addEventListener("click", async (event) => {
      event.stopPropagation();
      refreshBtn.disabled = true;
      refreshBtn.setText("Syncing...");
      await this.plugin.reconcileTimestampCollection();
      await this.plugin.reconcileSubtitleIndex();
      await this.plugin.refreshLibraryView();
      new Notice("Smart Media Library refreshed.");
    });

    await this.renderSavedMediaSection(wrap);
    await this.renderSubtitleSection(wrap);
    this.renderRssSection(wrap);
    this.renderFolderSection(wrap);
  }


  private async renderSavedMediaSection(parent: HTMLElement): Promise<void> {
    const collection = (this.plugin.settings.timestampCollection || []) as Array<{
      url: string;
      displayPath: string;
      notePath: string;
      title: string;
      sourceLabel: string;
      tags: string[];
      lastOpened: number;
    }>;

    const section = parent.createEl("details", {
      cls: "smn-library-section-block",
    });
    const summary = section.createEl("summary", {
      cls: "smn-library-section-summary",
    });
    summary.createEl("span", {
      text: " Saved Media",
      style: { fontSize: "12px", letterSpacing: "0.5px", fontWeight: "600" },
    });
    summary.createEl("span", {
      text: String(collection.length),
      style: {
        fontSize: "10px",
        color: "var(--text-faint)",
        fontWeight: "400",
      },
    });
    // Restore open state to avoid collapse on tag filter clicks
    if (this._savedMediaOpen) section.open = true;
    // Listen for toggle to track open state
    section.addEventListener("toggle", () => { this._savedMediaOpen = section.open; });

    if (!collection.length) {
      section.createEl("div", {
        cls: "smn-library-section-hint",
        text: "Open a timestamp-url block or media file once, and it will appear here for quick access.",
      });
      return;
    }

    // ---- Collect all unique tags for filter bar ----
    const allTags = [...new Set(collection.reduce((acc, e) => acc.concat(e.tags), ([] as string[])))].sort();
    const activeFilterTags = (this._savedMediaFilterTags || []) as string[];
    const hasFilter = activeFilterTags.length > 0;

    // Tag filter bar — integrated into the summary row
    if (allTags.length) {
      const filterBar = section.createEl("div", {
        cls: "smn-library-filter-bar",
      });
      const allPill = filterBar.createEl("span", { text: "All" });
      allPill.addClass("smn-library-filter-pill");
      allPill.toggleClass("is-active", !hasFilter);
      allPill.addEventListener("click", () => {
        this._savedMediaFilterTags = [];
        void this.render();
      });
      allTags.forEach((tag) => {
        const isActive = activeFilterTags.includes(tag);
        const pill = filterBar.createEl("span", { text: tag });
        pill.addClass("smn-library-filter-pill");
        pill.toggleClass("is-active", isActive);
        pill.addEventListener("click", () => {
          if (activeFilterTags.includes(tag)) {
            this._savedMediaFilterTags = activeFilterTags.filter(t => t !== tag);
          } else {
            this._savedMediaFilterTags = [...activeFilterTags, tag];
          }
          void this.render();
        });
      });
    }    // Sort newest first
    const sorted = [...collection].sort((a, b) => b.lastOpened - a.lastOpened);
    const filtered = hasFilter
      ? sorted.filter((e) => activeFilterTags.every(t => e.tags.includes(t)))
      : sorted;

    if (!filtered.length) {
      section.createEl("div", {
        text: hasFilter
          ? `No saved media tagged "${activeFilterTags.join(", ")}".`
          : "No saved media found.",
        style: {
          margin: "0 4px 12px",
          padding: "12px",
          border: "1px dashed var(--background-modifier-border)",
          borderRadius: "8px",
          color: "var(--text-muted)",
          fontSize: "11px",
          lineHeight: "1.5",
        },
      });
      return;
    }

    for (const entry of filtered) {
      const subtitlePath = this.plugin.getSubtitlePathForMedia(entry.url);
      const timestampNodes = await this.plugin.getTimestampEntriesForNote(
        entry.notePath,
        entry.url,
        entry.displayPath,
      );
      const row = section.createEl("div", {
        cls: "smn-saved-entry",
      });

      // Title line
      const titleRow = row.createEl("div", {
        cls: "smn-saved-entry-title-row",
        style: {
          display: "flex",
          alignItems: "center",
          gap: "6px",
          marginBottom: "4px",
        },
      });
      const titleEl = titleRow.createEl("span", {
        cls: "smn-saved-entry-title",
        text: entry.title || entry.displayPath,
        style: {
          fontSize: "13px",
          fontWeight: "600",
          color: "var(--text-normal)",
          flex: "1",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        },
      });

      titleRow.createEl("span", {
        cls: "smn-source-chip",
        text: this.getMediaKindLabel(entry.url, entry.sourceLabel),
      });

      // Remove button
      const removeBtn = titleRow.createEl("span", {
        text: "\u2715",
        title: "Remove from collection",
        cls: "smn-saved-entry-remove",
      });
      removeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const coll = this.plugin.settings.timestampCollection || [];
        const pos = coll.findIndex(
          (item) => item.url === entry.url && item.notePath === entry.notePath
        );
        if (pos >= 0) {
          coll.splice(pos, 1);
          this.plugin.settings.timestampCollection = coll;
          void this.plugin.saveSettings();
          void this.render();
        }
      });

      // Sub-info line — source + note name + date with proper spacing
      const infoLine = row.createEl("div", {
        cls: "smn-saved-entry-info",
        style: {
          fontSize: "10px",
          color: "var(--text-faint)",
          marginBottom: "6px",
          display: "flex",
          gap: "10px",
          alignItems: "center",
        },
      });
      if (entry.sourceLabel) {
        infoLine.createEl("span", {
          text: entry.sourceLabel,
          style: { opacity: "0.6", flexShrink: "0" },
        });
        infoLine.createEl("span", { text: "·", style: { opacity: "0.3" } });
      }
      if (entry.notePath) {
        const noteLink = infoLine.createEl("span", {
          text: "\uD83D\uDCC4 " + (entry.notePath.split("/").pop()?.replace(/.md$/, "") || ""),
          style: { cursor: "pointer", color: "var(--text-accent)", flexShrink: "0" },
        });
        noteLink.addEventListener("click", (e) => {
          e.stopPropagation();
          const file = this.app.vault.getAbstractFileByPath(entry.notePath);
          if (file instanceof TFile) {
            void this.app.workspace.getLeaf().openFile(file);
          }
        });
        infoLine.createEl("span", { text: "·", style: { opacity: "0.3", flexShrink: "0" } });
      }
      const d = new Date(entry.lastOpened);
      infoLine.createEl("span", {
        text: d.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
        style: { opacity: "0.6", flexShrink: "0" },
      });

      const subtitleLine = row.createEl("div", {
        cls: subtitlePath ? "smn-subtitle-status has-subtitle" : "smn-subtitle-status is-missing",
      });
      const subtitleText = subtitleLine.createEl("span", {
        cls: "smn-subtitle-status-text",
        text: subtitlePath ? "CC " + subtitlePath : "CC No subtitle linked",
      });
      const subtitleInput = subtitleLine.createEl("input");
      subtitleInput.setAttribute("type", "file");
      subtitleInput.setAttribute("accept", ".srt,.vtt,text/vtt,application/x-subrip");
      subtitleInput.addClass("smn-hidden-file-input");
      const uploadSubtitleBtn = subtitleLine.createEl("button", {
        cls: "smn-saved-subtitle-upload",
        text: subtitlePath ? "Update" : "Upload",
        title: subtitlePath ? "Update subtitles for this media" : "Upload subtitles for this media",
      });
      uploadSubtitleBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        subtitleInput.click();
      });
      subtitleInput.addEventListener("click", (event) => event.stopPropagation());
      subtitleInput.onchange = async (event: Event) => {
        event.stopPropagation();
        const target = event.target as HTMLInputElement;
        const file = target.files?.[0];
        if (!file) return;
        uploadSubtitleBtn.disabled = true;
        uploadSubtitleBtn.setText("Saving...");
        await this.plugin.importSubtitlesForMedia(entry.url, file, {
          alias: entry.title || entry.displayPath,
          sourceUrl: entry.displayPath || entry.url,
          displayPath: entry.displayPath || entry.url,
        });
        await this.plugin.refreshLibraryView();
        new Notice("Subtitles saved for this media.");
      };

      if (/^https?:\/\//i.test(entry.url)) {
        const directStatus = this.plugin.getDirectUrlStatus(
          entry.url,
          entry.displayPath,
        );
        const overrideMap = this.plugin.settings.directPlaybackOverrides || {};
        const overrideValue = overrideMap[entry.url];
        const directAvailable = directStatus.state === "ready";
        const useDirect = directAvailable && (overrideValue ?? true);
        const directLine = row.createEl("div", {
          cls: `smn-direct-url-status is-${directStatus.state}`,
        });
        directLine.createEl("span", {
          cls: "smn-direct-url-status-text",
          text: directStatus.label,
        });
        const modeBtn = directLine.createEl("button", {
          cls: useDirect
            ? "smn-direct-url-mode is-direct"
            : "smn-direct-url-mode is-original",
          text: useDirect ? "Direct" : "Original",
          title: directAvailable
            ? "Toggle whether this saved item opens with the yt-dlp direct URL or the original page URL"
            : "Resolve a direct URL before using direct mode",
        });
        modeBtn.disabled = !directAvailable;
        modeBtn.addEventListener("click", async (event) => {
          event.stopPropagation();
          this.plugin.settings.directPlaybackOverrides = {
            ...(this.plugin.settings.directPlaybackOverrides || {}),
            [entry.url]: !useDirect,
          };
          await this.plugin.saveSettings();
          await this.plugin.refreshLibraryView();
        });
        const resolveBtn = directLine.createEl("button", {
          cls: "smn-direct-url-resolve",
          text: directStatus.state === "ready" ? "Refresh" : "Resolve",
          title: "Resolve this link with yt-dlp on desktop",
        });
        resolveBtn.addEventListener("click", async (event) => {
          event.stopPropagation();
          resolveBtn.disabled = true;
          resolveBtn.setText("Resolving...");
          await this.plugin.resolveAndSaveDirectUrl(entry.url);
          await this.plugin.refreshLibraryView();
        });
      }

      // Tags
      const tagRow = row.createEl("div", {
        cls: "smn-saved-entry-tags",
        style: { display: "flex", flexWrap: "wrap", alignItems: "center" },
      });
      entry.tags.forEach((tag) => {
        const pill = tagRow.createEl("span", {
          text: tag,
          cls: "smn-tag-pill",
        });
        pill.addEventListener("click", (e) => {
          e.stopPropagation();
          const current = (this._savedMediaFilterTags || []) as string[];
          this._savedMediaFilterTags = current.includes(tag)
            ? current.filter(t => t !== tag)
            : [...current, tag];
          void this.render();
        });
      });

      if (timestampNodes.length) {
        const timestampGroupKey = `${entry.url}|${entry.notePath}`;
        const nodesDetails = row.createEl("details", { cls: "smn-saved-timestamp-details" });
        const expandedTimestampGroups = (this._expandedTimestampGroups || new Set<string>()) as Set<string>;
        this._expandedTimestampGroups = expandedTimestampGroups;
        if (expandedTimestampGroups.has(timestampGroupKey)) nodesDetails.open = true;
        nodesDetails.addEventListener("click", (event) => {
          event.stopPropagation();
        });
        nodesDetails.addEventListener("toggle", () => {
          if (nodesDetails.open) expandedTimestampGroups.add(timestampGroupKey);
          else expandedTimestampGroups.delete(timestampGroupKey);
        });
        const nodesSummary = nodesDetails.createEl("summary", { cls: "smn-saved-timestamp-summary" });
        nodesSummary.createEl("span", { text: "Timestamps" });
        nodesSummary.createEl("span", { text: String(timestampNodes.length) });
        const nodesRow = nodesDetails.createEl("div", { cls: "smn-saved-timestamp-nodes" });
        timestampNodes.forEach((node) => {
          const chip = nodesRow.createEl("button", {
            cls: "smn-saved-timestamp-node",
            text: node.label,
            title: node.subhead ? `${node.time} ${node.subhead}` : node.time,
          });
          chip.addEventListener("click", async (event) => {
            event.stopPropagation();
            expandedTimestampGroups.add(timestampGroupKey);
            this.plugin.settings.urlStartTimeMap.set(entry.url, node.seconds);
            await this.plugin.saveSettings();
            await this.plugin.openLibraryMedia(entry.url, null, {
              title: entry.title,
              sourceLabel: entry.sourceLabel,
              displayPath: entry.displayPath,
            }, {
          skipInsert: true,
          directPlaybackOverride:
                this.plugin.settings.directPlaybackOverrides?.[entry.url] ??
                true,
            });
            window.setTimeout(() => this.plugin.seekToTimestamp(node.seconds), 350);
          });
        });
      }

      // Click row to jump to note and open media
      row.addEventListener("click", async () => {
        const noteFile = this.app.vault.getAbstractFileByPath(entry.notePath);
        if (noteFile) {
          // Find the timestamp-url block line
          let cursorLine = 0;
          try {
            const content = await this.app.vault.read(noteFile);
            const lines = content.split("\n");
            let inBlock = false;
            for (let i = 0; i < lines.length; i++) {
              if (lines[i].trim() === "```timestamp-url") {
                inBlock = true;
                continue;
              }
              if (inBlock && lines[i].trim() === "```") {
                inBlock = false;
                continue;
              }
              if (inBlock) {
                const blockLine = lines[i].trim();
                const parsed = blockLine.includes("|")
                  ? blockLine.substring(blockLine.indexOf("|") + 1).trim()
                  : blockLine;
                if (parsed === entry.url || parsed === entry.displayPath || blockLine.includes(entry.url)) {
                  cursorLine = i - 1; // jump to ```timestamp-url header
                  break;
                }
              }
            }
          } catch (_) { /* ignore */ }
          const leaf = this.app.workspace.getLeaf() ?? this.app.workspace.getMostRecentLeaf();
          if (!leaf) return;
          await leaf.openFile(noteFile);
          // Set cursor after view is ready
          const view = leaf.view;
          if (view instanceof MarkdownView) {
            view.editor.setCursor({ line: cursorLine, ch: 0 });
            view.editor.scrollIntoView({ from: { line: cursorLine, ch: 0 }, to: { line: cursorLine, ch: 0 } }, true);
          }
        }
        await this.plugin.openLibraryMedia(entry.url, null, {
          title: entry.title,
          sourceLabel: entry.sourceLabel,
          displayPath: entry.displayPath,
        }, {
          skipInsert: true,
          directPlaybackOverride:
            this.plugin.settings.directPlaybackOverrides?.[entry.url] ??
            true,
        });
      });
    }
  }

  private getMediaKindLabel(url: string, sourceLabel?: string): string {
    if (isBilibiliUrl(url)) return "Bilibili";
    if (isYouTubeUrl(url)) return "YouTube";
    if (isHlsUrl(url)) return "HLS";
    if (sourceLabel) return sourceLabel;
    return /^https?:\/\//i.test(url) ? "URL" : "Vault";
  }

  private async renderSubtitleSection(parent: HTMLElement): Promise<void> {
    const items = await this.plugin.getSubtitleLibraryItems();
    const linkedItems = items.filter((item) => item.status === "linked");
    const unusedItems = items.filter((item) => item.status !== "linked");

    const section = parent.createEl("details", {
      cls: "smn-library-section-block has-top-border",
    });
    const summary = section.createEl("summary", {
      cls: "smn-library-section-summary",
    });
    summary.createEl("span", {
      text: " Subtitles",
      style: { fontSize: "12px", letterSpacing: "0.5px", fontWeight: "600" },
    });
    summary.createEl("span", {
      text: String(items.length),
      style: {
        fontSize: "10px",
        color: "var(--text-faint)",
        fontWeight: "400",
      },
    });

    if (this._subtitlesOpen) section.open = true;
    section.addEventListener("toggle", () => { this._subtitlesOpen = section.open; });

    if (!items.length) {
      section.createEl("div", {
        cls: "smn-library-section-hint",
        text: "No synced subtitle files found yet. Import subtitles while a media item is open to manage them here.",
      });
      return;
    }

    const renderGroup = (
      title: string,
      groupItems: typeof items,
      emptyText: string,
    ) => {
      const group = section.createEl("div", { cls: "smn-subtitle-group" });
      group.createEl("div", {
        cls: "smn-subtitle-group-title",
        text: `${title} (${groupItems.length})`,
      });
      if (!groupItems.length) {
        group.createEl("div", {
          cls: "smn-library-section-hint small",
          text: emptyText,
        });
        return;
      }

      groupItems.forEach((item) => {
        const row = group.createEl("div", {
          cls: item.status === "linked"
            ? "smn-subtitle-manager-row is-linked"
            : "smn-subtitle-manager-row is-unused",
        });
        const body = row.createEl("div", { cls: "smn-subtitle-manager-body" });
        const titleRow = body.createEl("div", { cls: "smn-subtitle-manager-title-row" });
        titleRow.createEl("span", {
          cls: "smn-subtitle-manager-title",
          text: item.path.split("/").pop() || item.path,
        });
        titleRow.createEl("span", {
          cls: item.status === "linked"
            ? "smn-source-chip"
            : "smn-source-chip is-muted",
          text: item.status === "linked" ? "Linked" : item.exists ? "Unused" : "Missing",
        });
        body.createEl("div", {
          cls: "smn-subtitle-manager-path",
          text: item.path,
        });
        body.createEl("div", {
          cls: "smn-subtitle-manager-meta",
          text: item.status === "linked"
            ? `Mapped to: ${item.labels.slice(0, 3).join(", ")}${item.labels.length > 3 ? "..." : ""}`
            : item.mappedKeys.length
              ? "No current media link uses this subtitle mapping."
              : "No media mapping found for this subtitle file.",
        });

        const deleteBtn = row.createEl("button", {
          cls: "smn-subtitle-manager-delete",
          text: item.exists ? "Delete" : "Remove",
          title: item.exists
            ? "Delete this subtitle file from the vault and remove its mappings"
            : "Remove missing subtitle mappings",
        });
        deleteBtn.addEventListener("click", async (event) => {
          event.stopPropagation();
          const ok = await confirmSubtitleDeletion(this.app, item.path, item.exists);
          if (!ok) return;
          deleteBtn.disabled = true;
          await this.plugin.deleteSubtitleLibraryItem(item.path);
          new Notice(item.exists ? "Subtitle file deleted." : "Subtitle mapping removed.");
          await this.render();
        });
      });
    };

    renderGroup("Linked subtitles", linkedItems, "No subtitle files are currently linked to media.");
    renderGroup("Unused subtitles", unusedItems, "No unused subtitle files found.");
  }

  private renderRssSection(parent: HTMLElement): void {
    const feeds = (this.plugin.settings.rssSubscriptions || [])
      .map((feed): RssSubscriptionEntry =>
        typeof feed === "string" ? { title: "", url: feed } : feed,
      )
      .filter((feed) => Boolean(feed?.url));

    const section = parent.createEl("details", {
      cls: "smn-library-section-block has-top-border",
    });
    const summary = section.createEl("summary", {
      cls: "smn-library-section-summary",
    });
    summary.createEl("span", {
      text: " RSS Subscriptions",
      style: { fontSize: "12px", letterSpacing: "0.5px", fontWeight: "600" },
    });
    summary.createEl("span", {
      text: String(feeds.length),
      style: {
        fontSize: "10px",
        color: "var(--text-faint)",
        fontWeight: "400",
      },
    });
    // Default to expanded if there are feeds
    // Restore open state to avoid collapse on tag filter clicks
    if (this._rssOpen) section.open = true;
    section.addEventListener("toggle", () => { this._rssOpen = section.open; });

    if (!feeds.length) {
      const empty = section.createEl("div", {
        text: "Add RSS feed URLs in plugin settings to see them here.",
        style: {
          margin: "0 4px 12px",
          padding: "12px",
          border: "1px dashed var(--background-modifier-border)",
          borderRadius: "8px",
          color: "var(--text-muted)",
          fontSize: "12px",
        },
      });
      empty.addEventListener("click", () => {
        const setting = (this.app as App & {
          setting?: { open(): void; openTabById(id: string): void };
        }).setting;
        setting?.open();
        setting?.openTabById(this.plugin.manifest.id);
      });
      return;
    }

    const rssList = section.createEl("div", { style: { maxHeight: "300px", overflowY: "auto" } });
    feeds.forEach((feed) => {
      const details = rssList.createEl("details", {
        cls: "smn-library-details",
      });

      const summary = details.createEl("summary", {
        cls: "smn-library-summary",
      });

      const left = summary.createEl("div", {
        style: { minWidth: "0", flex: "1" },
      });
      left.createEl("div", {
        text: feed.title || feed.url,
        style: {
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        },
      });
      left.createEl("div", {
        text: feed.url,
        style: {
          marginTop: "3px",
          fontSize: "11px",
          color: "var(--text-muted)",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          fontWeight: "400",
        },
      });

      const status = summary.createEl("div", {
        text: "",
        style: { fontSize: "11px", color: "var(--text-accent)" },
      });

      const body = details.createEl("div", {
        style: { borderTop: "1px solid var(--background-modifier-border)", padding: "8px 0" },
      });

      let loaded = false;
      details.addEventListener("toggle", async () => {
        if (!details.open || loaded) return;
        loaded = true;
        status.setText("Loading...");
        const result = await this.plugin.fetchPodcastEpisodes(feed.url);
        body.empty();
        if (result.error) {
          status.setText("Error");
          const errorEl = body.createEl("div", {
            text: result.error,
            style: {
              padding: "10px 14px",
              color: "var(--text-error)",
              fontSize: "12px",
            },
          });
          errorEl.addEventListener("click", () => {
            loaded = false;
            body.empty();
          });
          return;
        }
        status.setText(result.episodes.length + " items");
        if (!result.episodes.length) {
          body.createEl("div", {
            text: "No playable items found in this feed.",
            style: {
              padding: "10px 14px",
              color: "var(--text-muted)",
              fontSize: "12px",
            },
          });
          return;
        }
        result.episodes.forEach((ep: PodcastEpisode, index: number) => {
          const row = body.createEl("div", {
            cls: "smn-episode-row",
            style: {
              borderTop:
                index === 0
                  ? "none"
                  : "1px solid var(--background-modifier-border)",
            },
          });
          row.createEl("div", {
            text: ep.title || "Untitled",
            style: {
              fontSize: "13px",
              fontWeight: "600",
              lineHeight: "1.35",
            },
          });
          const metaBits: string[] = [];
          if (ep.date) {
            try {
              metaBits.push(
                new Date(ep.date).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                }),
              );
            } catch (_) {
              metaBits.push(ep.date);
            }
          }
          if (ep.duration) metaBits.push("⏱ " + ep.duration);
          if (metaBits.length) {
            row.createEl("div", {
              text: metaBits.join("  "),
              style: {
                marginTop: "4px",
                fontSize: "11px",
                color: "var(--text-muted)",
              },
            });
          }
          if (ep.description) {
            row.createEl("div", {
              text: ep.description,
              style: {
                marginTop: "4px",
                fontSize: "11px",
                color: "var(--text-faint)",
                lineHeight: "1.35",
              },
            });
          }
          row.addEventListener("click", async () => {
            await this.plugin.openLibraryMedia(ep.url, null, {
              title: ep.title,
              description: ep.description,
              sourceLabel: result.feedTitle || feed.title || feed.url,
            });
          });
        });
      });
    });
  }

  private renderFolderSection(parent: HTMLElement): void {
    const folders = (this.plugin.settings.mediaFolders || [])
      .filter(
        (folder): folder is string => typeof folder === "string" && folder.trim().length > 0,
      )
      .map((folder: string) => folder.trim());

    const section = parent.createEl("details", {
      cls: "smn-library-section-block has-top-border",
    });
    const summary = section.createEl("summary", {
      cls: "smn-library-section-summary",
    });
    summary.createEl("span", {
      text: " Media Folders",
      style: { fontSize: "12px", letterSpacing: "0.5px", fontWeight: "600" },
    });
    summary.createEl("span", { text: String(folders.length), style: { fontSize: "11px", color: "var(--text-faint)", fontWeight: "400" } });
    // Restore open state to avoid collapse on tag filter clicks
    if (this._foldersOpen) section.open = true;
    section.addEventListener("toggle", () => { this._foldersOpen = section.open; });

    if (!folders.length) {
      const empty = section.createEl("div", {
        text: "Add vault folders or Windows folder paths in plugin settings to browse local audio and video here.",
        style: {
          margin: "0 4px 12px",
          padding: "12px",
          border: "1px dashed var(--background-modifier-border)",
          borderRadius: "8px",
          color: "var(--text-muted)",
          fontSize: "12px",
        },
      });
      empty.addEventListener("click", () => {
        const setting = (this.app as App & {
          setting?: { open(): void; openTabById(id: string): void };
        }).setting;
        setting?.open();
        setting?.openTabById(this.plugin.manifest.id);
      });
      return;
    }

    const foldList = section.createEl("div", { style: { maxHeight: "300px", overflowY: "auto" } });
    folders.forEach((folderPath: string) => {
      const details = foldList.createEl("details", {
        cls: "smn-library-details",
      });

      const summary = details.createEl("summary", {
        cls: "smn-library-summary",
      });

      const left = summary.createEl("div", {
        style: { minWidth: "0", flex: "1" },
      });
      left.createEl("div", {
        text: folderPath,
        style: {
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        },
      });

      const files = this.plugin.getMediaFilesInFolder(folderPath);
      summary.createEl("div", {
        text: String(files.length),
        style: { fontSize: "11px", color: "var(--text-muted)" },
      });

      const body = details.createEl("div", {
        style: { borderTop: "1px solid var(--background-modifier-border)", padding: "8px 0" },
      });

      if (!files.length) {
        body.createEl("div", {
          text: "No media files found in this folder.",
          style: {
            padding: "10px 14px",
            color: "var(--text-muted)",
            fontSize: "12px",
          },
        });
        return;
      }

      files.forEach((file: MediaFileEntry, index: number) => {
        const row = body.createEl("div", {
          cls: "smn-folder-row",
          style: {
            borderTop:
              index === 0
                ? "none"
                : "1px solid var(--background-modifier-border)",
          },
        });
        row.createEl("div", {
          text: file.basename,
          style: {
            fontSize: "13px",
            fontWeight: "600",
            lineHeight: "1.35",
          },
        });
        row.createEl("div", {
          text: file.path,
          style: {
            marginTop: "4px",
            fontSize: "11px",
            color: "var(--text-muted)",
            lineHeight: "1.35",
            wordBreak: "break-all",
          },
        });
        row.addEventListener("click", async () => {
          await this.plugin.openLibraryMedia(
            file.playableUrl,
            file.vaultFile || null,
            {
              title: file.basename,
              sourceLabel: folderPath,
              displayPath: file.path,
            },
          );
        });
      });
    });
  }
}

function confirmSubtitleDeletion(
  app: MediaLibraryView["app"],
  path: string,
  exists: boolean,
): Promise<boolean> {
  return new Promise((resolve) => {
    const modal = new SubtitleDeleteConfirmModal(app, path, exists, resolve);
    modal.open();
  });
}

class SubtitleDeleteConfirmModal extends Modal {
  private answered = false;

  constructor(
    app: MediaLibraryView["app"],
    private path: string,
    private exists: boolean,
    private resolve: (value: boolean) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass("smn-confirm-modal");
    contentEl.createEl("h3", {
      text: this.exists ? "Delete subtitle file?" : "Remove missing subtitle mapping?",
    });
    contentEl.createEl("p", {
      text: this.exists
        ? "This will delete the subtitle file from your vault and remove all Smart Media Notes mappings that point to it."
        : "The subtitle file is already missing from your vault. This will only remove stale Smart Media Notes mappings.",
    });
    contentEl.createEl("p", {
      cls: "smn-confirm-path",
      text: this.path,
    });
    const actions = contentEl.createEl("div", { cls: "smn-confirm-actions" });
    const cancelBtn = actions.createEl("button", {
      cls: "smn-confirm-cancel",
      text: "Cancel",
    });
    const deleteBtn = actions.createEl("button", {
      cls: "smn-confirm-delete",
      text: this.exists ? "Delete subtitle" : "Remove mapping",
    });
    cancelBtn.addEventListener("click", () => this.finish(false));
    deleteBtn.addEventListener("click", () => this.finish(true));
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.answered) this.resolve(false);
  }

  private finish(value: boolean): void {
    this.answered = true;
    this.resolve(value);
    this.close();
  }
}
