import { ItemView, WorkspaceLeaf } from "obsidian";
import React from "react";
import { createRoot, Root } from "react-dom/client";
import ReactDOM from "react-dom";
import VideoContainer, { PlaylistInfo } from "./VideoContainer";
import { SubtitleCue } from "../utils";

export const VIDEO_VIEW = "video-view";
export const LIBRARY_VIEW = "smart-media-library-view";

interface EphemeralState {
  url: string;
  setupPlayer: (player: any, setPlaying: (p: boolean) => void) => void;
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
  onNavigatePlaylist?: (file: any) => void;
  isAudio?: boolean;
}

export class VideoView extends ItemView {
  root: Root;
  saveTimeOnUnload: () => Promise<void> = async () => {};
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
      }),
    );
  }

  async onClose(): Promise<void> {
    if (this.saveTimeOnUnload) await this.saveTimeOnUnload();
    this.root.unmount();
    ReactDOM.unmountComponentAtNode(this.containerEl.children[1]);
  }
}

export class MediaLibraryView extends ItemView {
  plugin: any;

  constructor(leaf: WorkspaceLeaf, plugin: any) {
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
    container.style.padding = "0";

    const wrap = container.createEl("div", {
      style: {
        height: "100%",
        overflowY: "auto",
        background:
          "linear-gradient(180deg, var(--background-primary) 0%, var(--background-secondary) 100%)",
      },
    });

    const header = wrap.createEl("div", {
      style: {
        padding: "16px 16px 12px",
        borderBottom: "1px solid var(--background-modifier-border)",
        position: "sticky",
        top: "0",
        background:
          "color-mix(in srgb, var(--background-primary) 92%, transparent)",
        backdropFilter: "blur(10px)",
        zIndex: "1",
      },
    });

    this.renderSavedMediaSection(wrap);
    this.renderRssSection(wrap);
    this.renderFolderSection(wrap);
  }


  private renderSavedMediaSection(parent: HTMLElement): void {
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
      style: { padding: "12px 12px 0" },
    });
    const summary = section.createEl("summary");
    summary.style.cssText =
      "font-size:11px;font-weight:700;color:var(--text-muted);" +
      "text-transform:uppercase;letter-spacing:0.5px;margin:0 0 10px;" +
      "cursor:pointer;list-style:none;display:flex;align-items:center;gap:6px;";
    summary.createEl("span", {
      text: " Saved Media",
      style: { fontSize: "11px", letterSpacing: "0.5px", fontWeight: "700" },
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
      return;
    }

    // ---- Collect all unique tags for filter bar ----
    const allTags = [...new Set(collection.reduce((acc, e) => acc.concat(e.tags), ([] as string[])))].sort();
    const activeFilterTag = this._savedMediaFilterTag || "";

    // Tag filter bar — integrated into the summary row
    if (allTags.length) {
      const filterBar = section.createEl("div", {
        style: {
          display: "flex",
          flexWrap: "wrap",
          gap: "4px",
          margin: "0 0 8px",
          alignItems: "center",
        },
      });
      const allPill = filterBar.createEl("span", {
        text: "All",
        style: {
          fontSize: "10px",
          padding: "2px 8px",
          borderRadius: "6px",
          cursor: "pointer",
          fontWeight: activeFilterTag ? "400" : "600",
          color: activeFilterTag ? "var(--text-muted)" : "var(--text-on-accent)",
          background: activeFilterTag ? "transparent" : "var(--interactive-accent)",
          border: "1px solid " + (activeFilterTag ? "var(--background-modifier-border)" : "var(--interactive-accent)"),
        },
      });
      allPill.addEventListener("click", () => {
        this._savedMediaFilterTag = "";
        this.render();
      });
      allTags.forEach((tag) => {
        const isActive = activeFilterTag === tag;
        const pill = filterBar.createEl("span", {
          text: tag,
          style: {
            fontSize: "10px",
            padding: "2px 8px",
            borderRadius: "6px",
            cursor: "pointer",
            fontWeight: isActive ? "600" : "400",
            color: isActive ? "var(--text-on-accent)" : "var(--text-muted)",
            background: isActive ? "var(--interactive-accent)" : "transparent",
            border: "1px solid " + (isActive ? "var(--interactive-accent)" : "var(--background-modifier-border)"),
          },
        });
        pill.addEventListener("click", () => {
          this._savedMediaFilterTag = tag === activeFilterTag ? "" : tag;
          this.render();
        });
        pill.addEventListener("mouseenter", () => {
          if (!isActive) pill.style.borderColor = "var(--text-muted)";
        });
        pill.addEventListener("mouseleave", () => {
          if (!isActive) pill.style.borderColor = "var(--background-modifier-border)";
        });
      });
    }    // Sort newest first
    const sorted = [...collection].sort((a, b) => b.lastOpened - a.lastOpened);
    const filtered = activeFilterTag
      ? sorted.filter((e) => e.tags.includes(activeFilterTag))
      : sorted;

    if (!filtered.length) {
      section.createEl("div", {
        text: activeFilterTag
          ? `No saved media tagged "${activeFilterTag}".`
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

    filtered.forEach((entry) => {
      const row = section.createEl("div");
      row.style.cssText =
        "margin-bottom:10px;padding:12px 14px;border:1px solid var(--background-modifier-border);" +
        "border-radius:10px;background:var(--background-secondary);cursor:pointer;" +
        "transition:background 0.15s;";
      row.addEventListener("mouseenter", () => {
        row.style.background = "var(--background-modifier-hover)";
      });
      row.addEventListener("mouseleave", () => {
        row.style.background = "var(--background-secondary)";
      });

      // Title line
      const titleRow = row.createEl("div", {
        style: {
          display: "flex",
          alignItems: "center",
          gap: "6px",
          marginBottom: "4px",
        },
      });
      const titleEl = titleRow.createEl("span", {
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

      // URL display
      const urlEl = row.createEl("div", {
        text: entry.displayPath || entry.url,
        style: {
          fontSize: "10px",
          color: "var(--text-faint)",
          marginBottom: "8px",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          opacity: "0.7",
        },
      });

      // Remove button
      const removeBtn = titleRow.createEl("span", {
        text: "\u2715",
        title: "Remove from collection",
      });
      removeBtn.style.cssText =
        "font-size:10px;color:var(--text-faint);cursor:pointer;padding:2px;opacity:0.4;" +
        "transition:opacity 0.15s, color 0.15s;";
      removeBtn.addEventListener("mouseenter", () => {
        removeBtn.style.opacity = "1";
        removeBtn.style.color = "var(--text-error)";
      });
      removeBtn.addEventListener("mouseleave", () => {
        removeBtn.style.opacity = "0.4";
        removeBtn.style.color = "var(--text-faint)";
      });
      removeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const coll = this.plugin.settings.timestampCollection || [];
        const pos = coll.findIndex(
          (e: any) => e.url === entry.url && e.notePath === entry.notePath
        );
        if (pos >= 0) {
          coll.splice(pos, 1);
          this.plugin.settings.timestampCollection = coll;
          this.plugin.saveSettings();
          this.render();
        }
      });

      // Sub-info line
      const infoLine = row.createEl("div", {
        style: {
          fontSize: "10px",
          color: "var(--text-faint)",
          marginBottom: "4px",
          display: "flex",
          gap: "8px",
          alignItems: "center",
        },
      });
      infoLine.createEl("span", {
        text: entry.sourceLabel || "",
        style: { opacity: "0.6" },
      });
      if (entry.notePath) {
        const noteLink = infoLine.createEl("span", {
          text: "\uD83D\uDCC4 " + (entry.notePath.split("/").pop()?.replace(/.md$/, "") || ""),
          style: { cursor: "pointer", color: "var(--text-accent)" },
        });
        noteLink.addEventListener("click", (e) => {
          e.stopPropagation();
          const file = this.app.vault.getAbstractFileByPath(entry.notePath);
          if (file) {
            // @ts-ignore
            this.app.workspace.getLeaf().openFile(file);
          }
        });
      }
      const d = new Date(entry.lastOpened);
      infoLine.createEl("span", {
        text: d.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
        style: { opacity: "0.6", marginLeft: "auto" },
      });

      // Tags
      const tagRow = row.createEl("div", {
        style: { display: "flex", flexWrap: "wrap", gap: "3px", alignItems: "center" },
      });
      entry.tags.forEach((tag) => {
        const pill = tagRow.createEl("span", {
          text: tag,
          style: {
            fontSize: "9px",
            padding: "1px 6px",
            borderRadius: "8px",
            background: "var(--interactive-accent)",
            color: "var(--text-on-accent)",
            cursor: "pointer",
          },
        });
        pill.addEventListener("click", (e) => {
          e.stopPropagation();
          this._savedMediaFilterTag = tag;
          this.render();
        });
      });

      // Click row to jump to note and open media
      row.addEventListener("click", async () => {
        const noteFile = this.app.vault.getAbstractFileByPath(entry.notePath);
        if (noteFile) {
          // @ts-ignore
          this.app.workspace.getLeaf().openFile(noteFile);
        }
        await this.plugin.openLibraryMedia(entry.url, null, {
          title: entry.title,
          sourceLabel: entry.sourceLabel,
          displayPath: entry.displayPath,
        });
      });
    });
  }
  private renderRssSection(parent: HTMLElement): void {
    const feeds = (this.plugin.settings.rssSubscriptions || [])
      .map((feed: any) =>
        typeof feed === "string" ? { title: "", url: feed } : feed,
      )
      .filter((feed: any) => feed && feed.url);

    const section = parent.createEl("details", {
      style: { padding: "12px 12px 0" },
    });
    const summary = section.createEl("summary");
    summary.style.cssText =
      "font-size:11px;font-weight:700;color:var(--text-muted);" +
      "text-transform:uppercase;letter-spacing:0.5px;margin:0 0 10px;" +
      "cursor:pointer;list-style:none;display:flex;align-items:center;gap:6px;";
    summary.createEl("span", {
      text: " RSS Subscriptions",
      style: { fontSize: "11px", letterSpacing: "0.5px", fontWeight: "700" },
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
        // @ts-ignore
        this.app.setting.open();
        // @ts-ignore
        this.app.setting.openTabById(this.plugin.manifest.id);
      });
      return;
    }

    const rssList = section.createEl("div", { style: { maxHeight: "300px", overflowY: "auto" } });
    feeds.forEach((feed: any) => {
      const details = rssList.createEl("details", {
        cls: "smart-media-library-details",
      });
      details.style.cssText =
        "margin-bottom:10px;border:1px solid var(--background-modifier-border);border-radius:14px;background:var(--background-secondary);overflow:hidden;box-shadow:0 6px 20px rgba(0,0,0,0.04);";

      const summary = details.createEl("summary");
      summary.style.cssText =
        "list-style:none;cursor:pointer;padding:12px 14px;display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:13px;font-weight:600;";

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
        result.episodes.forEach((ep: any, index: number) => {
          const row = body.createEl("div", {
            style: {
              padding: "10px 14px",
              borderTop:
                index === 0
                  ? "none"
                  : "1px solid var(--background-modifier-border)",
              cursor: "pointer",
            },
          });
          row.addEventListener(
            "mouseenter",
            () =>
              (row.style.background = "var(--background-modifier-hover)"),
          );
          row.addEventListener("mouseleave", () => (row.style.background = ""));
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
        (folder: any) => typeof folder === "string" && folder.trim().length,
      )
      .map((folder: string) => folder.trim());

    const section = parent.createEl("details", { style: { padding: "12px" } });
    const summary = section.createEl("summary");
    summary.style.cssText =
      "font-size:11px;font-weight:700;color:var(--text-muted);" +
      "text-transform:uppercase;letter-spacing:0.5px;margin:0 0 10px;" +
      "cursor:pointer;list-style:none;display:flex;align-items:center;gap:6px;";
    summary.createEl("span", {
      text: " Media Folders",
      style: { fontSize: "11px", letterSpacing: "0.5px", fontWeight: "700" },
    });
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
        // @ts-ignore
        this.app.setting.open();
        // @ts-ignore
        this.app.setting.openTabById(this.plugin.manifest.id);
      });
      return;
    }

    const foldList = section.createEl("div", { style: { maxHeight: "300px", overflowY: "auto" } });
    folders.forEach((folderPath: string) => {
      const details = foldList.createEl("details");
      details.style.cssText =
        "margin-bottom:10px;border:1px solid var(--background-modifier-border);border-radius:14px;background:var(--background-secondary);overflow:hidden;box-shadow:0 6px 20px rgba(0,0,0,0.04);";

      const summary = details.createEl("summary");
      summary.style.cssText =
        "list-style:none;cursor:pointer;padding:12px 14px;display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:13px;font-weight:600;";

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

      files.forEach((file: any, index: number) => {
        const row = body.createEl("div", {
          style: {
            padding: "10px 14px",
            borderTop:
              index === 0
                ? "none"
                : "1px solid var(--background-modifier-border)",
            cursor: "pointer",
          },
        });
        row.addEventListener(
          "mouseenter",
          () => (row.style.background = "var(--background-modifier-hover)"),
        );
        row.addEventListener("mouseleave", () => (row.style.background = ""));
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
