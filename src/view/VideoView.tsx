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
    header.createEl("div", {
      text: "Smart Media Library",
      style: { fontWeight: "700", fontSize: "16px", letterSpacing: "0.01em" },
    });

    this.renderRssSection(wrap);
    this.renderFolderSection(wrap);
  }

  private renderRssSection(parent: HTMLElement): void {
    const feeds = (this.plugin.settings.rssSubscriptions || [])
      .map((feed: any) =>
        typeof feed === "string" ? { title: "", url: feed } : feed,
      )
      .filter((feed: any) => feed && feed.url);

    const section = parent.createEl("div", {
      style: { padding: "12px 12px 0" },
    });
    section.createEl("div", {
      text: "RSS Subscriptions",
      style: {
        fontSize: "11px",
        fontWeight: "700",
        color: "var(--text-muted)",
        textTransform: "uppercase",
        letterSpacing: "0.5px",
        margin: "0 4px 10px",
      },
    });

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

    feeds.forEach((feed: any) => {
      const details = section.createEl("details", {
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

    const section = parent.createEl("div", { style: { padding: "12px" } });
    section.createEl("div", {
      text: "Media Folders",
      style: {
        fontSize: "11px",
        fontWeight: "700",
        color: "var(--text-muted)",
        textTransform: "uppercase",
        letterSpacing: "0.5px",
        margin: "0 4px 10px",
      },
    });

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

    folders.forEach((folderPath: string) => {
      const details = section.createEl("details");
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
