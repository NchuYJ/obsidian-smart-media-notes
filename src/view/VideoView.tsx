/**
 * VideoView.tsx — Obsidian 自定义视图
 *
 * Obsidian 插件可以注册两种视图：
 *   - VideoView:      媒体播放器面板（左侧/右侧分栏）
 *   - MediaLibraryView: 媒体库侧边栏（RSS + 文件夹浏览）
 *
 * 核心概念：Obsidian ItemView
 *   ItemView 是 Obsidian 提供的面板基类。每个 ItemView 有自己的 DOM 容器，
 *   插件通过重写 getViewType()、getDisplayText()、getIcon() 来定义面板。
 *
 * 这里用 React 渲染内容：
 *   createRoot(containerEl.children[1]) 在 Obsidian 面板的 DOM 里挂载 React 组件树。
 *   containerEl.children[1] 是 Obsidian 为视图内容预留的 div。
 */

import { ItemView, WorkspaceLeaf } from "obsidian";
import React from "react";
// React 18 的 createRoot API — 替代旧的 ReactDOM.render()
import { createRoot, Root } from "react-dom/client";
import ReactDOM from "react-dom";
import VideoContainer, { PlaylistInfo } from "./VideoContainer";
import { SubtitleCue } from "../utils";

// ---- 视图类型标识符 ----
// registerView() 和 getLeavesOfType() 用这个字符串来识别视图
export const VIDEO_VIEW = "video-view";
export const LIBRARY_VIEW = "smart-media-library-view";

// ============================================================
// VideoView — 媒体播放器面板
// ============================================================

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
}

export class VideoView extends ItemView {
  /** React 18 的 Root 对象 — 用于 render/unmount */
  root: Root;

  /** 面板关闭时保存播放进度的回调 */
  saveTimeOnUnload: () => Promise<void> = async () => {};

  /** 当前渲染的状态 — 用于外部更新字幕等 */
  currentEphemeralState?: EphemeralState;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
    // containerEl.children[0] = Obsidian 的视图头部
    // containerEl.children[1] = 内容区域（我们挂 React 的地方）
    this.root = createRoot(this.containerEl.children[1]);
  }

  /** 视图类型标识 — 必须和 registerView() 的第一个参数一致 */
  getViewType(): string {
    return VIDEO_VIEW;
  }

  /** 标签页标题 */
  getDisplayText(): string {
    return "Smart Media Notes";
  }

  /** 标签页图标（Obsidian 内置图标名） */
  getIcon(): string {
    return "video";
  }

  /**
   * 设置"瞬时状态" — 这是 Obsidian 的轻量级状态传递机制
   *
   * 和 setState() 的区别：
   *   - setState() 会触发序列化/反序列化，用于持久化
   *   - setEphemeralState() 只传内存引用，不会写入 data.json
   *
   * 这里用它在不关闭面板的情况下更新 URL、字幕、播放列表。
   */
  setEphemeralState(state: EphemeralState): void {
    this.currentEphemeralState = state;
    this.saveTimeOnUnload = state.saveTimeOnUnload;
    // 用 React.createElement 而非 JSX，因为这里没有构建时的 JSX 转换
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
      }),
    );
  }

  /** 面板关闭时：保存播放进度 + 卸载 React 组件 */
  async onClose(): Promise<void> {
    if (this.saveTimeOnUnload) await this.saveTimeOnUnload();
    this.root.unmount();
    // 同时调用旧的 unmountComponentAtNode 确保清理干净
    ReactDOM.unmountComponentAtNode(this.containerEl.children[1]);
  }
}

// ============================================================
// MediaLibraryView — 媒体库侧边栏
// ============================================================

export class MediaLibraryView extends ItemView {
  /** 持有插件实例引用，用于调用 fetchPodcastEpisodes()、getMediaFilesInFolder() 等 */
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

  /** 面板打开时：渲染内容 + 注册文件系统事件监听 */
  async onOpen(): Promise<void> {
    await this.render();
    // 监听 vault 文件变化 — 文件增删改名时自动刷新列表
    // registerEvent() 确保插件卸载时自动取消监听
    this.registerEvent(this.app.vault.on("create", () => this.render()));
    this.registerEvent(this.app.vault.on("delete", () => this.render()));
    this.registerEvent(this.app.vault.on("rename", () => this.render()));
  }

  /**
   * 重绘整个侧边栏
   *
   * Obsidian 没有用 React 渲染这个视图，而是用原生 DOM API (createEl)。
   * 这是因为侧边栏内容比较简单（列表 + 展开折叠），原生 DOM 足够。
   */
  async render(): Promise<void> {
    // Obsidian 约定：containerEl.children[1] 是内容容器
    const container = this.containerEl.children[1];
    container.empty(); // 清空旧内容
    container.style.padding = "0";

    // 外层包装
    const wrap = container.createEl("div", {
      style: {
        height: "100%",
        overflowY: "auto",
        // 渐变背景 — 从主题主色渐变到次要色
        background:
          "linear-gradient(180deg, var(--background-primary) 0%, var(--background-secondary) 100%)",
      },
    });

    // 标题栏 — sticky 固定在顶部
    const header = wrap.createEl("div", {
      style: {
        padding: "16px 16px 12px",
        borderBottom: "1px solid var(--background-modifier-border)",
        position: "sticky",
        top: "0",
        // color-mix 是 CSS 新特性 — 92% 背景色 + 8% 透明 → 半透明毛玻璃效果
        background: "color-mix(in srgb, var(--background-primary) 92%, transparent)",
        backdropFilter: "blur(10px)",
        zIndex: "1",
      },
    });
    header.createEl("div", {
      text: "Smart Media Library",
      style: { fontWeight: "700", fontSize: "16px", letterSpacing: "0.01em" },
    });

    // 渲染两个区块：RSS 订阅 + 媒体文件夹
    this.renderRssSection(wrap);
    this.renderFolderSection(wrap);
  }

  /**
   * 渲染 RSS 订阅区块
   *
   * 使用 <details> / <summary> 元素实现展开/折叠。
   * 首次展开时才加载 feeds（懒加载）。
   */
  private renderRssSection(parent: HTMLElement): void {
    // 解析 RSS 订阅列表 — 支持 "Title | URL" 和纯 URL 两种格式
    const feeds = (this.plugin.settings.rssSubscriptions || [])
      .map((feed: any) =>
        typeof feed === "string" ? { title: "", url: feed } : feed,
      )
      .filter((feed: any) => feed && feed.url);

    const section = parent.createEl("div", { style: { padding: "12px 12px 0" } });

    // 区块标题
    section.createEl("div", {
      text: "RSS Subscriptions",
      style: {
        fontSize: "11px", fontWeight: "700", color: "var(--text-muted)",
        textTransform: "uppercase", letterSpacing: "0.5px", margin: "0 4px 10px",
      },
    });

    // 空状态提示
    if (!feeds.length) {
      const empty = section.createEl("div", {
        text: "Add RSS feed URLs in plugin settings to see them here.",
        style: {
          margin: "0 4px 12px", padding: "12px",
          border: "1px dashed var(--background-modifier-border)",
          borderRadius: "8px", color: "var(--text-muted)", fontSize: "12px",
        },
      });
      // 点击空状态 → 打开设置面板
      empty.addEventListener("click", () => {
        // @ts-ignore — Obsidian 内部 API
        this.app.setting.open();
        // @ts-ignore
        this.app.setting.openTabById(this.plugin.manifest.id);
      });
      return;
    }

    // 渲染每个 RSS feed
    feeds.forEach((feed: any) => {
      // <details> 元素 — 原生展开/折叠，无需 JS 状态管理
      const details = section.createEl("details", { cls: "smart-media-library-details" });
      details.style.cssText =
        "margin-bottom:10px;border:1px solid var(--background-modifier-border);" +
        "border-radius:14px;background:var(--background-secondary);overflow:hidden;" +
        "box-shadow:0 6px 20px rgba(0,0,0,0.04);";

      // <summary> — 折叠状态的标题行
      const summary = details.createEl("summary");
      summary.style.cssText =
        "list-style:none;cursor:pointer;padding:12px 14px;display:flex;" +
        "align-items:center;justify-content:space-between;gap:10px;font-size:13px;font-weight:600;";

      // 左侧：标题 + URL
      const left = summary.createEl("div", { style: { minWidth: "0", flex: "1" } });
      left.createEl("div", {
        text: feed.title || feed.url,
        style: { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
      });
      left.createEl("div", {
        text: feed.url,
        style: {
          marginTop: "3px", fontSize: "11px", color: "var(--text-muted)",
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          fontWeight: "400",
        },
      });

      // 右侧：加载状态 / 集数
      const status = summary.createEl("div", {
        text: "",
        style: { fontSize: "11px", color: "var(--text-accent)" },
      });

      const body = details.createEl("div", {
        style: { borderTop: "1px solid var(--background-modifier-border)", padding: "8px 0" },
      });

      let loaded = false;

      // <details> 的 toggle 事件 — 展开时才加载 RSS feed
      details.addEventListener("toggle", async () => {
        if (!details.open || loaded) return;
        loaded = true;
        status.setText("Loading...");

        // 调用插件的 fetchPodcastEpisodes 方法获取播客列表
        const result = await this.plugin.fetchPodcastEpisodes(feed.url);
        body.empty();

        if (result.error) {
          status.setText("Error");
          const errorEl = body.createEl("div", {
            text: result.error,
            style: { padding: "10px 14px", color: "var(--text-error)", fontSize: "12px" },
          });
          // 点击错误信息 → 重置状态，允许重新加载
          errorEl.addEventListener("click", () => { loaded = false; body.empty(); });
          return;
        }

        status.setText(result.episodes.length + " items");

        if (!result.episodes.length) {
          body.createEl("div", {
            text: "No playable items found in this feed.",
            style: { padding: "10px 14px", color: "var(--text-muted)", fontSize: "12px" },
          });
          return;
        }

        // 渲染每集
        result.episodes.forEach((ep: any, index: number) => {
          const row = body.createEl("div", {
            style: {
              padding: "10px 14px",
              borderTop: index === 0 ? "none" : "1px solid var(--background-modifier-border)",
              cursor: "pointer",
            },
          });
          // 鼠标悬停效果
          row.addEventListener("mouseenter", () =>
            (row.style.background = "var(--background-modifier-hover)"));
          row.addEventListener("mouseleave", () => (row.style.background = ""));

          row.createEl("div", {
            text: ep.title || "Untitled",
            style: { fontSize: "13px", fontWeight: "600", lineHeight: "1.35" },
          });

          // 元数据行：日期 + 时长
          const metaBits: string[] = [];
          if (ep.date) {
            try {
              metaBits.push(new Date(ep.date).toLocaleDateString(undefined, {
                month: "short", day: "numeric", year: "numeric",
              }));
            } catch (_) { metaBits.push(ep.date); }
          }
          if (ep.duration) metaBits.push("⏱ " + ep.duration);
          if (metaBits.length) {
            row.createEl("div", {
              text: metaBits.join("  "),
              style: { marginTop: "4px", fontSize: "11px", color: "var(--text-muted)" },
            });
          }
          if (ep.description) {
            row.createEl("div", {
              text: ep.description,
              style: {
                marginTop: "4px", fontSize: "11px", color: "var(--text-faint)",
                lineHeight: "1.35",
              },
            });
          }

          // 点击 → 在笔记中插入链接并打开播放器
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

  /**
   * 渲染媒体文件夹区块
   *
   * 支持两种路径：
   *   - Vault 内部路径（如 "English/listening"）
   *   - Windows 系统路径（如 "D:\Music"）
   */
  private renderFolderSection(parent: HTMLElement): void {
    const folders = (this.plugin.settings.mediaFolders || [])
      .filter((folder: any) => typeof folder === "string" && folder.trim().length)
      .map((folder: string) => folder.trim());

    const section = parent.createEl("div", { style: { padding: "12px" } });

    section.createEl("div", {
      text: "Media Folders",
      style: {
        fontSize: "11px", fontWeight: "700", color: "var(--text-muted)",
        textTransform: "uppercase", letterSpacing: "0.5px", margin: "0 4px 10px",
      },
    });

    if (!folders.length) {
      const empty = section.createEl("div", {
        text: "Add vault folders or Windows folder paths in plugin settings to browse local audio and video here.",
        style: {
          margin: "0 4px 12px", padding: "12px",
          border: "1px dashed var(--background-modifier-border)",
          borderRadius: "8px", color: "var(--text-muted)", fontSize: "12px",
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
        "margin-bottom:10px;border:1px solid var(--background-modifier-border);" +
        "border-radius:14px;background:var(--background-secondary);overflow:hidden;" +
        "box-shadow:0 6px 20px rgba(0,0,0,0.04);";

      const summary = details.createEl("summary");
      summary.style.cssText =
        "list-style:none;cursor:pointer;padding:12px 14px;display:flex;" +
        "align-items:center;justify-content:space-between;gap:10px;font-size:13px;font-weight:600;";

      const left = summary.createEl("div", { style: { minWidth: "0", flex: "1" } });
      left.createEl("div", {
        text: folderPath,
        style: { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
      });

      // 预扫描文件数量（在折叠状态就显示）
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
          style: { padding: "10px 14px", color: "var(--text-muted)", fontSize: "12px" },
        });
        return;
      }

      files.forEach((file: any, index: number) => {
        const row = body.createEl("div", {
          style: {
            padding: "10px 14px",
            borderTop: index === 0 ? "none" : "1px solid var(--background-modifier-border)",
            cursor: "pointer",
          },
        });
        row.addEventListener("mouseenter", () =>
          (row.style.background = "var(--background-modifier-hover)"));
        row.addEventListener("mouseleave", () => (row.style.background = ""));

        row.createEl("div", {
          text: file.basename,
          style: { fontSize: "13px", fontWeight: "600", lineHeight: "1.35" },
        });
        row.createEl("div", {
          text: file.path,
          style: {
            marginTop: "4px", fontSize: "11px", color: "var(--text-muted)",
            lineHeight: "1.35", wordBreak: "break-all",
          },
        });

        row.addEventListener("click", async () => {
          await this.plugin.openLibraryMedia(
            file.playableUrl, file.vaultFile || null,
            { title: file.basename, sourceLabel: folderPath, displayPath: file.path },
          );
        });
      });
    });
  }
}
