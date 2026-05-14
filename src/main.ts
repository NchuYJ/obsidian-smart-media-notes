/**
 * main.ts — 插件入口文件
 *
 * ============================================================
 * Obsidian 插件开发核心概念
 * ============================================================
 *
 * 【Plugin 生命周期】
 *   onload()  → 插件被启用时调用（注册视图、命令、事件监听器）
 *   onunload() → 插件被禁用时调用（清理资源、移除视图）
 *
 * 【视图系统】
 *   registerView(type, factory) → 注册自定义面板
 *   ItemView → 自定义面板基类（见 VideoView.tsx 和 VideoView.tsx 的 MediaLibraryView）
 *
 * 【命令系统】
 *   addCommand({ id, name, editorCallback }) → 注册可绑定快捷键的命令
 *
 * 【Markdown 后处理】
 *   registerMarkdownCodeBlockProcessor(lang, callback) → 自定义代码块渲染
 *   例如：```timestamp ```timestamp-url ```voice-bar
 *
 * 【设置系统】
 *   addSettingTab(tab) → 注册设置面板（见 settings.ts）
 *   loadData() / saveData() → 读写 data.json
 *
 * 【数据持久化】
 *   this.settings → 运行时配置对象
 *   this.loadData() → 从 data.json 读取
 *   this.saveData(this.settings) → 写入 data.json
 *   （注意：Map 类型需要转成普通对象才能序列化）
 *
 * 【事件系统】
 *   this.registerEvent(...) → 注册事件监听（插件卸载时自动清理）
 *   this.app.vault.on("create"/"delete"/"rename") → 文件系统事件
 *
 * ============================================================
 * 本插件的数据流
 * ============================================================
 *
 *   用户选中 URL → resolveMediaUrl() → activateView()
 *     → getOrCreateVideoLeaf() → VideoView.setEphemeralState()
 *       → React.createRoot().render(VideoContainer)
 *         → react-player 播放 + 字幕同步
 *
 *   用户点时间戳按钮 → parseTimestampToSeconds() → player.seekTo()
 *
 *   用户导字幕 → importSubtitlesForUrl()
 *     → 保存 .srt 文件 + 更新 subtitleFileMap
 *     → getSubtitlesForUrl() 按需加载
 *
 *   用户录音 → startVoiceRecording()
 *     → MediaRecorder API → stopVoiceRecording()
 *       → 保存 .webm/.ogg 文件 + 插入 voice-bar 代码块
 */

import {
  App,
  Editor,
  FuzzySuggestModal,   // 模糊搜索模态框 — 用于浏览 vault 媒体文件
  MarkdownView,
  Modal,               // 模态框基类 — 用于文件选择、播客列表
  Notice,              // 弹出通知 — Obsidian 右上角的提示
  Plugin,              // 插件基类 — 所有 Obsidian 插件的入口
  WorkspaceLeaf,
  MarkdownPostProcessorContext,
  normalizePath,       // 路径规范化 — 把反斜杠转正斜杠
  TFile,               // Obsidian 文件对象
} from "obsidian";
import React from "react";
import ReactDOM from "react-dom";
import { createRoot } from "react-dom/client";

import {
  SmartMediaNotesSettings,
  DEFAULT_SETTINGS,
  TimestampPluginSettingTab,
} from "./settings";
import { VideoView, MediaLibraryView, VIDEO_VIEW, LIBRARY_VIEW } from "./view/VideoView";
import VideoContainer from "./view/VideoContainer";
import {
  formatSecondsAsTimestamp,
  parseTimestampToSeconds,
  parseSubtitleFile,
  findCueAtTime,
  urlToSafeName,
  normalizeMediaCandidate,
  isPlayableMedia,
  MEDIA_EXTENSIONS,
  SubtitleCue,
  ResolvedMedia,
} from "./utils";

// ============================================================
// 错误消息模板 — 统一管理，方便今后国际化
// ============================================================
// Obsidian 的 callout 语法：> [!type] Title\n> Body
// 支持 info/warning/error/caution/quote 等类型

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

// ============================================================
// 插件主类
// ============================================================
// Plugin 是 Obsidian 提供的基类。所有插件都必须 extend Plugin。
// export default 告诉 Obsidian 用这个类作为插件入口。

export default class SmartMediaNotesPlugin extends Plugin {
  // ---- 运行时状态 ----
  // settings! 是 TypeScript 的 definite assignment assertion
  // 表示 "我知道它在 onload 里会被赋值，别报错"
  settings!: SmartMediaNotesSettings;

  // 播放器相关
  player: any = null;           // react-player 实例引用
  setPlaying: any = null;       // 控制播放/暂停的 setState 函数
  currentUrl: string | null = null;     // 当前播放的 URL
  currentUrlKey: string | null = null;  // 稳定的 URL key（用于保存进度）
  currentSubtitle: SubtitleCue | null = null;  // 当前高亮的字幕

  // 编辑器相关
  editor: Editor | null = null;  // 当前活动编辑器引用

  // 录音相关
  mediaRecorder: MediaRecorder | null = null;
  recordedChunks: Blob[] = [];
  liveTranscript: string = "";
  speechRecognition: any = null;  // Web Speech API 实例

  // ==========================================================
  // onload() — 插件启动入口
  // ==========================================================
  // Obsidian 在用户启用插件或启动应用时调用此方法。
  // 这里完成所有初始化：注册视图、命令、代码块处理器、设置面板。

  async onload(): Promise<void> {
    // ---- 注册自定义视图 ----
    // registerView(类型标识, 工厂函数)
    // 类型标识是字符串，用于 getLeavesOfType() 查找视图
    this.registerView(VIDEO_VIEW, (leaf) => new VideoView(leaf));
    this.registerView(
      LIBRARY_VIEW,
      (leaf) => new MediaLibraryView(leaf, this),
    );

    // ---- 加载设置 ----
    // loadSettings() 从 data.json 读取用户配置
    await this.loadSettings();

    // ---- 侧边栏图标 ----
    // addRibbonIcon() 在 Obsidian 左侧边栏添加图标按钮
    this.addRibbonIcon("library", "Open Smart Media Library", () => {
      this.activateLibraryView();
    });

    // ---- 注册 Markdown 代码块处理器 ----
    // 当 Obsidian 渲染代码块时，如果语言标识匹配，就调用回调
    // 例如：```timestamp\n01:23\n``` → 渲染为可点击的时间戳按钮

    /**
     * ```timestamp 代码块
     * 把时间戳文本渲染成可点击的按钮，点击跳转到视频对应时间
     */
    this.registerMarkdownCodeBlockProcessor(
      "timestamp",
      (source: string, el: HTMLElement) => {
        const regExp = /\d+:\d+:\d+|\d+:\d+/g;  // 匹配 1:23 或 1:23:45
        const rows = source.split("\n").filter((row) => row.length > 0);
        rows.forEach((row) => {
          const match = row.match(regExp);
          if (match) {
            const div = el.createEl("div");  // Obsidian 的 DOM 创建辅助方法
            const button = div.createEl("button");
            button.innerText = match[0];
            // 用 CSS 变量 — 自动适配主题
            button.style.backgroundColor = this.settings.timestampColor;
            button.style.color = this.settings.timestampTextColor;
            button.addEventListener("click", () => {
              const seconds = parseTimestampToSeconds(match[0]);
              if (this.player) this.player.seekTo(seconds!);
            });
            div.appendChild(button);
          }
        });
      },
    );

    /**
     * ```timestamp-url 代码块
     * 把媒体 URL 渲染成可点击的按钮，点击打开播放器
     */
    this.registerMarkdownCodeBlockProcessor(
      "timestamp-url",
      (source: string, el: HTMLElement) => {
        const raw = source.trim();
        // 尝试解析：是 vault 文件？系统文件？网络 URL？
        const resolved = this.resolveMediaUrl(raw);
        if (resolved) {
          const div = el.createEl("div");
          const button = div.createEl("button");
          // 路径太长时截断显示
          const display =
            resolved.displayPath.length > 55
              ? resolved.displayPath.slice(0, 52) + "..."
              : resolved.displayPath;
          button.innerText = display;
          button.title = resolved.displayPath;  // 鼠标悬停看完整路径
          button.style.cssText =
            "max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
          button.style.backgroundColor = this.settings.urlColor;
          button.style.color = this.settings.urlTextColor;
          button.addEventListener("click", () => {
            this.activateView(
              resolved.playableUrl,
              this.editor,
              resolved.isVaultFile ? resolved.vaultFile : null,
            );
          });
          div.appendChild(button);
        } else if (this.isPodcastUrl(raw)) {
          // 如果识别为播客 RSS URL → 打开播客浏览器
          const div = el.createEl("div");
          const button = div.createEl("button");
          button.innerText = "🎙 " + raw;
          button.style.backgroundColor = this.settings.urlColor;
          button.style.color = this.settings.urlTextColor;
          button.addEventListener("click", () => {
            new PodcastModal(this.app, this, raw, this.editor!).open();
          });
          div.appendChild(button);
        } else {
          // 无法识别 → 在编辑器中插入错误信息
          if (this.editor) {
            this.editor.replaceSelection(
              this.editor.getSelection() + "\n" + ERRORS["INVALID_URL"],
            );
          }
        }
      },
    );

    /**
     * ```voice-bar 代码块
     * 把语音笔记文件路径渲染成内联音频播放器（带动画波形条）
     */
    this.registerMarkdownCodeBlockProcessor(
      "voice-bar",
      (source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
        const filePath = source.trim();
        if (!filePath) return;

        // 从 vault 中找到文件
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (!file) {
          el.createEl("span", {
            text: `(missing: ${filePath})`,
            style: { color: "var(--text-error)", fontSize: "12px" },
          });
          return;
        }

        // 构建 UI：播放按钮 + 波形条 + 删除按钮
        const container = el.createEl("div");
        container.style.cssText =
          "display:inline-flex;align-items:center;gap:8px;padding:8px 14px;" +
          "border-radius:20px;background:var(--background-modifier-hover);" +
          "cursor:pointer;user-select:none;max-width:260px;min-width:140px;" +
          "border:1px solid var(--background-modifier-border);";

        const playBtn = container.createEl("span", { text: "▶" });
        playBtn.style.cssText = "font-size:16px;flex-shrink:0;line-height:1;";

        // 波形条 — 用 22 个 div 模拟音频波形
        const waveContainer = container.createEl("div");
        waveContainer.style.cssText =
          "display:flex;align-items:center;gap:2px;flex:1;height:28px;overflow:hidden;";

        const barCount = 22;
        for (let i = 0; i < barCount; i++) {
          // sin 函数生成不同高度的条形，看起来像波形
          const height =
            4 + Math.abs(Math.sin(i * 0.7 + 2) * 18 + Math.sin(i * 1.3) * 6);
          const bar = waveContainer.createEl("div");
          bar.style.cssText =
            `width:2px;height:${height}px;border-radius:1px;` +
            `background:var(--interactive-accent);flex-shrink:0;` +
            `transition:background 0.2s;`;
        }

        // 删除按钮
        const deleteBtn = container.createEl("span", {
          text: "×", title: "Delete voice recording",
        });
        deleteBtn.style.cssText =
          "font-size:16px;color:var(--text-muted);flex-shrink:0;cursor:pointer;" +
          "padding:0 2px;line-height:1;opacity:0.5;transition:opacity 0.15s;";
        deleteBtn.addEventListener("mouseenter", () => {
          deleteBtn.style.opacity = "1";
          deleteBtn.style.color = "var(--text-error)";
        });
        deleteBtn.addEventListener("mouseleave", () => {
          deleteBtn.style.opacity = "0.5";
          deleteBtn.style.color = "var(--text-muted)";
        });

        // 删除逻辑：删除音频文件 + 从笔记中移除代码块
        deleteBtn.addEventListener("click", async (e) => {
          e.stopPropagation();
          e.preventDefault();
          await this.app.vault.delete(file);
          const noteFile = this.app.vault.getAbstractFileByPath(ctx.sourcePath);
          if (noteFile) {
            try {
              const content = await this.app.vault.read(noteFile);
              const escaped = filePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
              const regex = new RegExp(
                "```voice-bar\\n" + escaped + "\\n```\\n?", "g",
              );
              const newContent = content.replace(regex, "");
              await this.app.vault.modify(noteFile, newContent);
            } catch (_) { /* 忽略错误 */ }
          }
          new Notice("Voice recording deleted.");
        });

        // 隐藏的 <audio> 元素 — 实际播放音频
        const audio = container.createEl("audio", {
          attr: {
            src: this.app.vault.getResourcePath(file),
            style: "position:absolute;opacity:0;pointer-events:none;width:1px;height:1px;",
          },
        });

        // 播放进度 → 更新波形条颜色
        let playing = false;
        audio.addEventListener("timeupdate", () => {
          if (audio.duration) {
            const pct = audio.currentTime / audio.duration;
            const bars = waveContainer.querySelectorAll("div");
            const litCount = Math.round(pct * bars.length);
            bars.forEach((bar, i) => {
              (bar as HTMLElement).style.background =
                i < litCount ? "var(--text-accent)" : "var(--interactive-accent)";
              (bar as HTMLElement).style.opacity =
                i < litCount ? "1" : "0.5";
            });
          }
        });
        audio.addEventListener("ended", () => {
          playing = false;
          playBtn.textContent = "▶";
          const bars = waveContainer.querySelectorAll("div");
          bars.forEach((bar) => {
            (bar as HTMLElement).style.background = "var(--interactive-accent)";
            (bar as HTMLElement).style.opacity = "0.5";
          });
        });

        container.addEventListener("click", () => {
          if (playing) {
            audio.pause();
            playing = false;
            playBtn.textContent = "▶";
          } else {
            audio.play().catch(() => {});
            playing = true;
            playBtn.textContent = "⏸";
          }
        });
      },
    );

    // ==========================================================
    // 注册命令（可绑定快捷键）
    // ==========================================================
    // editorCallback 在用户触发命令时调用，传入当前编辑器实例

    /** 打开媒体播放器 — 解析选中的 URL 并打开 */
    this.addCommand({
      id: "trigger-player",
      name: "Open media player (copy url or path and use hotkey)",
      editorCallback: (editor: Editor) => {
        const selected = editor.getSelection().trim();
        const resolved = this.resolveMediaUrl(selected);
        if (resolved) {
          this.activateView(
            resolved.playableUrl, editor,
            resolved.isVaultFile ? resolved.vaultFile : null,
          );
          // 在笔记中插入 timestamp-url 代码块
          this.settings.noteTitle
            ? editor.replaceSelection(
                "\n" + this.settings.noteTitle +
                "\n```timestamp-url\n" + resolved.displayPath + "\n```\n",
              )
            : editor.replaceSelection(
                "```timestamp-url\n" + resolved.displayPath + "\n```\n",
              );
          this.editor = editor;
        } else if (this.isPodcastUrl(selected)) {
          this.editor = editor;
          new PodcastModal(this.app, this, selected, editor).open();
        } else {
          editor.replaceSelection(ERRORS["INVALID_URL"]);
        }
        // setCursor 把光标移到新内容之后
        editor.setCursor(editor.getCursor().line + 1);
      },
    });

    /** 插入当前播放时间的时间戳 */
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
        // 如果开启了"附字幕"选项，在时间戳后插入当前字幕文本
        if (this.settings.includeSubtitleWithTimestamp && this.currentSubtitle) {
          const subtitleLine = this.settings.timestampWithSubtitleTemplate
            .replace("{time}", time)
            .replace("{text}", this.currentSubtitle.text);
          insertion += subtitleLine.endsWith("\n") ? subtitleLine : subtitleLine + "\n";
        }
        editor.replaceSelection(insertion);
      },
    });

    /** 暂停/继续 */
    this.addCommand({
      id: "pause-player",
      name: "Pause player",
      editorCallback: () => {
        if (this.player && this.setPlaying)
          this.setPlaying(!this.player.props.playing);
      },
    });

    /** 快进 */
    this.addCommand({
      id: "seek-forward",
      name: "Seek Forward",
      editorCallback: () => {
        if (this.player)
          this.player.seekTo(
            this.player.getCurrentTime() + parseInt(this.settings.forwardSeek),
          );
      },
    });

    /** 快退 */
    this.addCommand({
      id: "seek-backward",
      name: "Seek Backward",
      editorCallback: () => {
        if (this.player)
          this.player.seekTo(
            this.player.getCurrentTime() - parseInt(this.settings.backwardsSeek),
          );
      },
    });

    /** 打开本地文件选择器 */
    this.addCommand({
      id: "open-sample-modal-complex",
      name: "Open local media file",
      editorCallback: (editor: Editor) => {
        this.editor = editor;
        new SampleModal(this.app, this.activateView.bind(this), editor).open();
        return true;  // 返回 true 表示命令已处理
      },
    });

    /** 从 vault 中搜索媒体文件 */
    this.addCommand({
      id: "open-vault-media",
      name: "Open media from vault",
      editorCallback: (editor: Editor) => {
        this.editor = editor;
        new VaultMediaModal(this.app, this).open();
        return true;
      },
    });

    /** 打开媒体库侧边栏 */
    this.addCommand({
      id: "open-media-library",
      name: "Open media library sidebar",
      callback: async () => {
        await this.activateLibraryView();
      },
    });

    /** 为当前媒体导入字幕文件 */
    this.addCommand({
      id: "import-subtitle-file",
      name: "Import subtitle file for current media",
      editorCallback: (editor: Editor) => {
        this.editor = editor;
        new SubtitleModal(this.app, this).open();
        return true;
      },
    });

    /** 插入当前字幕行（语言学习用） */
    this.addCommand({
      id: "insert-current-subtitle-note",
      name: "Insert current subtitle with timestamp",
      editorCallback: async (editor: Editor) => {
        this.editor = editor;
        if (!this.player) { editor.replaceSelection(ERRORS["NO_ACTIVE_VIDEO"]); return; }
        if (!this.currentSubtitle) { editor.replaceSelection(ERRORS["NO_ACTIVE_SUBTITLE"]); return; }
        const time = formatSecondsAsTimestamp(this.currentSubtitle.start);
        const note = this.settings.subtitleTemplate
          .replace("{time}", time)
          .replace("{text}", this.currentSubtitle.text);
        editor.replaceSelection(note.endsWith("\n") ? note : note + "\n");
      },
    });

    /** 开始录音 */
    this.addCommand({
      id: "start-voice-recording",
      name: "Start voice recording",
      editorCallback: async (editor: Editor) => {
        this.editor = editor;
        await this.startVoiceRecording();
      },
    });

    /** 停止录音并保存 */
    this.addCommand({
      id: "stop-voice-recording",
      name: "Stop voice recording and save note",
      editorCallback: async (editor: Editor) => {
        this.editor = editor;
        await this.stopVoiceRecording(editor);
      },
    });

    // ---- 注册设置面板 ----
    this.addSettingTab(new TimestampPluginSettingTab(this.app, this));
  }

  // ==========================================================
  // onunload() — 插件卸载时清理
  // ==========================================================
  // Obsidian 在用户禁用插件或关闭应用时调用。
  // 必须清理所有资源：播放器引用、录音、视图等。

  async onunload(): Promise<void> {
    this.player = null;
    this.editor = null;
    this.setPlaying = null;
    this.currentUrl = null;
    this.currentUrlKey = null;
    this.currentSubtitle = null;
    if (this.speechRecognition?.stop) this.speechRecognition.stop();
    if (this.mediaRecorder && this.mediaRecorder.state !== "inactive") {
      this.mediaRecorder.stop();
    }
    // detachLeavesOfType 移除所有该类型的面板
    this.app.workspace.detachLeavesOfType(VIDEO_VIEW);
    this.app.workspace.detachLeavesOfType(LIBRARY_VIEW);
  }

  // ==========================================================
  // 系统文件路径解析
  // ==========================================================
  // Obsidian 不能直接播放本地文件系统路径（如 D:\video.mp4），
  // 需要先读成 Blob，再创建 blob: URL 传给播放器。
  // 尝试两种方式：fetch file:// 协议，或 Node.js fs.readFileSync

  async resolveSystemFilePath(systemPath: string): Promise<string | null> {
    // 方式 1：用 file:// 协议 fetch
    try {
      const normalized = systemPath.replace(/\\/g, "/");
      const fileUrl = "file:///" + encodeURI(normalized).replace(/#/g, "%23");
      const response = await fetch(fileUrl);
      if (response.ok) {
        const blob = await response.blob();
        return URL.createObjectURL(blob);  // 创建临时 blob URL
      }
    } catch (_) { /* 失败则尝试下一种方式 */ }

    // 方式 2：用 Node.js fs 模块直接读文件
    try {
      const fs = require("fs");
      const path = require("path");
      const buffer = fs.readFileSync(systemPath);
      const ext = path.extname(systemPath).toLowerCase();
      const mimeMap: Record<string, string> = {
        ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".ogg": "audio/ogg",
        ".wav": "audio/wav", ".flac": "audio/flac", ".opus": "audio/ogg",
        ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime",
        ".avi": "video/x-msvideo", ".mkv": "video/x-matroska",
        ".flv": "video/x-flv", ".ogv": "video/ogg", ".wmv": "video/x-ms-wmv",
        ".m4b": "audio/mp4",
      };
      const mime = mimeMap[ext] || "application/octet-stream";
      const blob = new Blob([buffer], { type: mime });
      return URL.createObjectURL(blob);
    } catch (_) { /* 两种方式都失败 */ }

    return null;
  }

  // ==========================================================
  // 播客 URL 检测
  // ==========================================================
  // 判断一个 URL 是否应该被当作播客 RSS feed 处理（而非直接播放）
  // 检查顺序：文件名后缀 → URL 路径模式 → 域名

  isPodcastUrl(url: string): boolean {
    if (!url || !/^https?:\/\//i.test(url)) return false;
    if (isPlayableMedia(url)) return false;  // 能直接播放的不是播客
    if (/\.(xml|rss)(\?.*)?$/i.test(url)) return true;  // XML/RSS 文件
    if (/\/(feed|rss|podcast)\b/i.test(url)) return true;  // 路径模式
    try {
      const host = new URL(url).hostname;
      // 常见播客托管域名
      if (/\bfeeds?\b|\brss\b|podcast|anchor\.fm|buzzsprout|simplecast|libsyn|spreaker|transistor\.fm|captivate\.fm|megaphone/i.test(host))
        return true;
    } catch (_) { /* 不是合法 URL */ }
    return false;
  }

  // ==========================================================
  // 字幕管理
  // ==========================================================

  /**
   * 生成稳定的字幕存储 key
   *
   * 问题：Obsidian 给 vault 文件生成的资源 URL 是临时的 blob/app URL，
   * 每次启动都不同。如果直接用这些 URL 做 key，字幕数据会被重复存储。
   *
   * 解决：
   *   - vault 文件 → "vault://" + 文件路径（稳定）
   *   - 系统文件 → "__system__:" 前缀（已稳定）
   *   - 网络 URL → URL 本身（已稳定）
   */
  getStableSubtitleKey(url: string, vaultFile?: any): string {
    if (vaultFile?.path) {
      return "vault://" + vaultFile.path;
    }
    if (url.startsWith("__system__:")) {
      return url;
    }
    // blob/app URL 无法确定对应文件 → 回退到原始 URL
    if (url.startsWith("blob:") || url.startsWith("app://")) {
      return url;
    }
    return url;
  }

  /**
   * 获取指定 URL 的字幕
   *
   * 查找顺序：
   *   1. 字幕库缓存（subtitleLibrary）→ 最快
   *   2. 字幕文件映射（subtitleFileMap）→ 从磁盘读取
   *   3. 都没有 → 返回空数组
   */
  async getSubtitlesForUrl(url: string, vaultFile?: any): Promise<SubtitleCue[]> {
    const stableKey = this.getStableSubtitleKey(url, vaultFile);

    // 先用稳定 key 查
    const cached = this.settings.subtitleLibrary[stableKey];
    if (cached && cached.length) return cached;

    // 回退：用原始 URL 查（向后兼容旧数据）
    const legacyCached = this.settings.subtitleLibrary[url];
    if (legacyCached && legacyCached.length) {
      // 迁移到稳定 key
      this.settings.subtitleLibrary[stableKey] = legacyCached;
      await this.saveSettings();
      return legacyCached;
    }

    // 查字幕文件映射 → 从磁盘读取
    let mappedPath = this.settings.subtitleFileMap[stableKey]
      || this.settings.subtitleFileMap[url];
    if (mappedPath) {
      try {
        if (await this.app.vault.adapter.exists(mappedPath)) {
          const content = await this.app.vault.adapter.read(mappedPath);
          const cues = parseSubtitleFile(content, mappedPath);
          if (cues.length) {
            this.settings.subtitleLibrary[stableKey] = cues;
            await this.saveSettings();
            return cues;
          }
        }
      } catch (e) { /* 读取失败 → 返回空 */ }
    }
    return [];
  }

  setCurrentSubtitle(subtitle: SubtitleCue | null): void {
    this.currentSubtitle = subtitle;
  }

  /** 获取当前目标的 URL（优先选中的文本，其次当前播放的媒体） */
  getTargetUrl(editor?: Editor): string | null {
    const selected = editor?.getSelection().trim() || "";
    if (selected && isPlayableMedia(selected)) return selected;
    if (selected) {
      const resolved = this.resolveMediaUrl(selected);
      if (resolved) return resolved.playableUrl;
    }
    return this.currentUrlKey || this.currentUrl;
  }

  // ==========================================================
  // URL 解析 — 判断媒体来源
  // ==========================================================
  // 支持三种来源：
  //   1. Vault 文件（通过路径查找 TFile）
  //   2. 系统文件（Windows 绝对路径）
  //   3. 网络 URL（YouTube、播客等）

  resolveMediaUrl(text: string): ResolvedMedia | null {
    if (!text || typeof text !== "string") return null;
    let trimmed = normalizeMediaCandidate(text);
    if (!trimmed) return null;

    // 系统文件路径检测：以盘符或 / 或 \\ 开头 + 媒体扩展名
    if (
      /^([a-zA-Z]:\\|\/)/.test(trimmed) &&
      /\.(mp4|mov|avi|mkv|webm|flv|ogv|wmv|mp3|m4a|m4b|aac|ogg|oga|wav|flac|opus|wma)$/i.test(trimmed)
    ) {
      return {
        playableUrl: "__system__:" + trimmed,  // 前缀标记，激活时再解析
        displayPath: trimmed,
        isVaultFile: false,
        isSystemFile: true,
      };
    }

    // 可直接播放的网络 URL
    if (isPlayableMedia(trimmed)) {
      return { playableUrl: trimmed, displayPath: trimmed, isVaultFile: false };
    }

    // Vault 内文件：用路径查找 TFile
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
      } catch (_) { /* 获取资源路径失败 */ }
    }
    return null;
  }

  // ==========================================================
  // 播放列表 — 同目录媒体文件导航
  // ==========================================================

  buildPlaylist(vaultFile: any): { files: any[]; currentIndex: number } | null {
    if (!vaultFile?.parent) return null;
    // 筛选同目录下的媒体文件
    const siblings = vaultFile.parent.children
      .filter(
        (f: any) =>
          f.extension && MEDIA_EXTENSIONS.includes(f.extension.toLowerCase()),
      )
      .sort((a: any, b: any) =>
        a.name.localeCompare(b.name, undefined, { numeric: true }),
      );
    if (siblings.length <= 1) return null;  // 只有自己一个文件 → 不需要列表
    const index = siblings.findIndex((f: any) => f.path === vaultFile.path);
    return { files: siblings, currentIndex: index >= 0 ? index : 0 };
  }

  // ==========================================================
  // 字幕导入
  // ==========================================================

  async importSubtitlesForUrl(url: string, file: File): Promise<void> {
    const content = await file.text();
    const cues = parseSubtitleFile(content, file.name);
    if (!cues.length) {
      new Notice("No subtitle cues were detected in that file.");
      return;
    }
    const stableKey = this.getStableSubtitleKey(url);
    this.settings.subtitleLibrary[stableKey] = cues;

    // 保存字幕文件到 vault
    const folder = await this.ensureFolder(this.settings.subtitleStorageFolder);
    const safeName = urlToSafeName(stableKey);
    const ext = file.name.toLowerCase().endsWith(".vtt") ? ".vtt" : ".srt";
    const subtitlePath = normalizePath(`${folder}/${safeName}${ext}`);
    await this.app.vault.adapter.write(subtitlePath, content);
    this.settings.subtitleFileMap[stableKey] = subtitlePath;
    await this.saveSettings();

    // 更新所有打开的播放器视图
    const leaves = this.app.workspace.getLeavesOfType(VIDEO_VIEW);
    leaves.forEach((leaf) => {
      if (leaf.view instanceof VideoView && leaf.view.currentEphemeralState) {
        leaf.setEphemeralState({
          ...leaf.view.currentEphemeralState,
          subtitles: cues,
        });
      }
    });
    new Notice(`Imported ${cues.length} subtitle lines. Saved to ${subtitlePath}`);
  }

  // ==========================================================
  // RSS 订阅解析
  // ==========================================================

  /** 解析 RSS 订阅输入 → 结构化数组 */
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

  /** RSS 订阅数组 → 文本（用于设置面板显示） */
  stringifyRssSubscriptions(): string {
    return (this.settings.rssSubscriptions || [])
      .map((feed: any) => {
        if (typeof feed === "string") return feed;
        return feed.title ? `${feed.title} | ${feed.url}` : feed.url;
      })
      .join("\n");
  }

  /**
   * 获取 RSS feed 的播客列表
   *
   * 手动解析 RSS XML（不用 XML 解析库以减少依赖）。
   * 提取每集的标题、音频 URL、日期、时长、简介。
   */
  async fetchPodcastEpisodes(
    feedUrl: string,
  ): Promise<{ feedTitle: string; episodes: any[]; error: string | null }> {
    try {
      const response = await fetch(feedUrl);
      const text = await response.text();

      // 提取 feed 标题
      const feedTitleMatch = text.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      const feedTitle = feedTitleMatch
        ? feedTitleMatch[1].replace(/<[^>]+>/g, "").trim()
        : "Podcast";

      const episodes: any[] = [];
      let idx = 0;

      // 逐个解析 <item> 块
      while (idx < text.length) {
        const itemStart = text.indexOf("<item", idx);
        if (itemStart === -1) break;
        const itemEnd = text.indexOf("</item>", itemStart);
        if (itemEnd === -1) break;
        const itemText = text.slice(itemStart, itemEnd + 7);

        const titleMatch = itemText.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
        const encMatch = itemText.match(/<enclosure[^>]*url="([^"]+)"/i);
        const dateMatch = itemText.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i);
        const durMatch =
          itemText.match(/<itunes:duration[^>]*>([^<]+)<\/itunes:duration>/i) ||
          itemText.match(/<duration[^>]*>([^<]+)<\/duration>/i);
        const descMatch = itemText.match(/<description[^>]*>([\s\S]*?)<\/description>/i);

        if (encMatch) {
          // 解析时长
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
            title: titleMatch ? titleMatch[1].replace(/<[^>]+>/g, "").trim() : "Untitled",
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

      // 如果没有解析到 <item>，尝试直接匹配 <enclosure> 标签
      if (!episodes.length) {
        const encMatches = [...text.matchAll(/<enclosure[^>]*url="([^"]+)"/gi)];
        encMatches.forEach((m, i) => {
          episodes.push({
            title: "Episode " + (i + 1), url: m[1],
            date: "", duration: "", description: "",
          });
        });
      }

      if (!episodes.length) {
        return { feedTitle, episodes: [], error: "No playable episodes found in this feed." };
      }
      return { feedTitle, episodes, error: null };
    } catch (e) {
      return {
        feedTitle: "Podcast", episodes: [],
        error: "Failed to load podcast feed. The server may block cross-origin requests.",
      };
    }
  }

  // ==========================================================
  // 文件系统辅助
  // ==========================================================

  /**
   * 确保目录存在（递归创建）
   * Obsidian 的 createFolder() 只能逐层创建，不能 mkdir -p
   */
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

  /**
   * 获取文件夹内的所有媒体文件
   * 支持 vault 路径和系统路径两种
   */
  getMediaFilesInFolder(folderPath: string): any[] {
    // 系统路径：用 Node.js fs 递归扫描
    if (this.isSystemFolderPath(folderPath)) {
      try {
        const fs = require("fs");
        const path = require("path");
        const found: any[] = [];
        const walk = (dir: string) => {
          let entries: any[];
          try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
          catch (_) { return; }
          for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) { walk(fullPath); continue; }
            const ext = path.extname(entry.name).replace(".", "").toLowerCase();
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
        return found.sort((a: any, b: any) =>
          a.path.localeCompare(b.path, undefined, { numeric: true }),
        );
      } catch (_) { return []; }
    }

    // Vault 路径：用 Obsidian API 获取文件列表
    const normalized = normalizePath(folderPath);
    return this.app.vault
      .getFiles()
      .filter((file) => {
        const ext = file.extension.toLowerCase();
        return (
          MEDIA_EXTENSIONS.includes(ext) &&
          (file.path === normalized || file.path.startsWith(normalized + "/"))
        );
      })
      .map((file) => ({
        basename: file.basename,
        path: file.path,
        playableUrl: this.app.vault.getResourcePath(file),
        vaultFile: file,
      }))
      .sort((a: any, b: any) =>
        a.path.localeCompare(b.path, undefined, { numeric: true }),
      );
  }

  isSystemFolderPath(folderPath: string): boolean {
    return /^([a-zA-Z]:\\|\\\\|\/)/.test(folderPath);
  }

  // ==========================================================
  // 编辑器辅助
  // ==========================================================

  /** 获取当前活动编辑器（优先 MarkdownView，其次遍历找） */
  getActiveEditor(): Editor | null {
    const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (markdownView?.editor) return markdownView.editor;
    const leaves = this.app.workspace.getLeavesOfType("markdown");
    for (const leaf of leaves) {
      const view = leaf.view as any;
      if (view?.editor) return view.editor;
    }
    return this.editor;
  }

  /** 构建媒体库插入的笔记内容 */
  buildLibraryNote(
    url: string,
    meta: { displayPath?: string; sourceLabel?: string; title?: string; description?: string },
  ): string {
    const lines: string[] = [];
    if (this.settings.noteTitle) lines.push("", this.settings.noteTitle);
    lines.push("```timestamp-url", meta.displayPath || url, "```");
    if (meta.sourceLabel || meta.title) {
      const label = [meta.sourceLabel, meta.title].filter(Boolean).join(": ");
      lines.push("> 🎙 " + label);
    }
    if (meta.description) lines.push("> " + meta.description);
    return lines.join("\n") + "\n";
  }

  /** 从媒体库打开媒体文件 */
  async openLibraryMedia(
    url: string, vaultFile: any,
    meta: { title?: string; description?: string; sourceLabel?: string; displayPath?: string },
  ): Promise<void> {
    const editor = this.getActiveEditor();
    if (editor && this.settings.autoInsertLibraryNote) {
      this.editor = editor;
      editor.replaceSelection(this.buildLibraryNote(url, meta || {}));
    }
    await this.activateView(
      vaultFile ? this.app.vault.getResourcePath(vaultFile) : url,
      editor!,
      vaultFile || null,
    );
  }

  // ==========================================================
  // 视图管理
  // ==========================================================

  /** 打开或聚焦媒体库侧边栏 */
  async activateLibraryView(): Promise<void> {
    let leaf = this.app.workspace.getLeavesOfType(LIBRARY_VIEW)[0];
    if (!leaf) {
      // getRightLeaf(false) 取右侧分栏（不拆分）
      leaf = this.app.workspace.getRightLeaf(false)!;
      await leaf.setViewState({ type: LIBRARY_VIEW, active: true });
    }
    this.app.workspace.revealLeaf(leaf);  // 聚焦到该面板
    if (leaf.view instanceof MediaLibraryView) {
      await leaf.view.render();
    }
  }

  /** 刷新媒体库视图内容 */
  async refreshLibraryView(): Promise<void> {
    const leaves = this.app.workspace.getLeavesOfType(LIBRARY_VIEW);
    for (const leaf of leaves) {
      if (leaf.view instanceof MediaLibraryView) {
        await leaf.view.render();
      }
    }
  }

  /** 获取或创建播放器视图 */
  async getOrCreateVideoLeaf(): Promise<WorkspaceLeaf> {
    let leaf = this.app.workspace.getLeavesOfType(VIDEO_VIEW)[0];
    if (leaf) return leaf;
    const libraryLeaf = this.app.workspace.getLeavesOfType(LIBRARY_VIEW)[0];
    if (libraryLeaf) {
      // 如果媒体库已打开，在它旁边创建播放器
      leaf = this.app.workspace.createLeafBySplit(libraryLeaf, "vertical");
    } else {
      leaf = this.app.workspace.getRightLeaf(false)!;
    }
    await leaf.setViewState({ type: VIDEO_VIEW, active: true });
    return leaf;
  }

  // ==========================================================
  // 语音识别（Web Speech API）
  // ==========================================================

  startSpeechRecognition(): void {
    if (!this.settings.enableLiveTranscription) return;
    // Web Speech API — 浏览器内置语音识别
    // @ts-ignore
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    this.liveTranscript = "";
    this.speechRecognition = new SpeechRecognition();
    this.speechRecognition.continuous = true;     // 持续识别
    this.speechRecognition.interimResults = true;  // 显示临时结果
    this.speechRecognition.lang = "zh-CN";         // 中文识别

    this.speechRecognition.onresult = (event: any) => {
      const transcript = Array.from(event.results)
        .map((result: any) => (result[0] ? result[0].transcript : ""))
        .join(" ")
        .trim();
      this.liveTranscript = transcript;
    };
    this.speechRecognition.start();
  }

  // ==========================================================
  // 录音功能（MediaRecorder API）
  // ==========================================================

  async startVoiceRecording(): Promise<void> {
    if (this.mediaRecorder && this.mediaRecorder.state !== "inactive") {
      new Notice("Voice recording is already running.");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      if (this.editor) this.editor.replaceSelection(ERRORS["VOICE_RECORDING_UNAVAILABLE"]);
      return;
    }

    // getUserMedia 请求麦克风权限
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.recordedChunks = [];

    this.mediaRecorder = new MediaRecorder(stream);
    this.mediaRecorder.ondataavailable = (event: BlobEvent) => {
      if (event.data && event.data.size > 0) {
        this.recordedChunks.push(event.data);
      }
    };
    this.mediaRecorder.onstop = () => {
      stream.getTracks().forEach((track) => track.stop());  // 释放麦克风
    };

    this.startSpeechRecognition();
    this.mediaRecorder.start();
    new Notice("Voice recording started.");
  }

  /** 停止录音 → 保存文件 + 插入 voice-bar 代码块 */
  async stopVoiceRecording(editor: Editor): Promise<void> {
    if (!this.mediaRecorder || this.mediaRecorder.state === "inactive") {
      new Notice("No voice recording is currently running.");
      return;
    }
    const recorder = this.mediaRecorder;

    // 用 Promise 包装 stop 事件 — 等待录音真正停止
    await new Promise<void>((resolve) => {
      recorder.addEventListener("stop", () => resolve(), { once: true });
      recorder.stop();
    });

    if (this.speechRecognition?.stop) {
      this.speechRecognition.stop();
      this.speechRecognition = null;
    }

    const mimeType = recorder.mimeType || "audio/webm";
    const blob = new Blob(this.recordedChunks, { type: mimeType });
    const transcript = this.liveTranscript ? this.liveTranscript.trim() : "";

    // 清空录音状态
    this.mediaRecorder = null;
    this.recordedChunks = [];
    this.liveTranscript = "";

    // 保存到 vault
    const folder = await this.ensureFolder(this.settings.recordingsFolder);
    const extension = mimeType.includes("ogg") ? "ogg" : "webm";
    const filename = `voice-note-${Date.now()}.${extension}`;
    const path = normalizePath(`${folder}/${filename}`);
    const arrayBuffer = await blob.arrayBuffer();
    await this.app.vault.createBinary(path, arrayBuffer);

    // 在笔记中插入 voice-bar 代码块 + 转录文本
    const transcriptBlock = transcript ? `\n> ${transcript}\n` : "";
    editor.replaceSelection(
      `\`\`\`voice-bar\n${path}\n\`\`\`\n${transcriptBlock}`,
    );
    new Notice(`Voice recording saved to ${path}.`);
  }

  // ==========================================================
  // 核心：打开媒体并激活播放器视图
  // ==========================================================
  // 这是插件的核心流程，被各种入口调用（命令、代码块点击、媒体库点击等）

  async activateView(
    url: string,
    editor: Editor | null,
    vaultFile: any = null,
  ): Promise<void> {
    let resolvedUrl = url;
    let systemPath: string | null = null;

    // 系统文件路径 → 需要先解析为 blob URL
    if (url.startsWith("__system__:")) {
      systemPath = url.slice(11);
      resolvedUrl = (await this.resolveSystemFilePath(systemPath))!;
      if (!resolvedUrl) {
        new Notice("Cannot access system file. It may be outside the vault or inaccessible.");
        return;
      }
    }

    this.currentUrl = resolvedUrl;
    this.currentUrlKey = systemPath ? url : resolvedUrl;
    this.editor = editor;

    // 获取或创建播放器视图
    const videoLeaf = await this.getOrCreateVideoLeaf();
    this.app.workspace.revealLeaf(videoLeaf);

    const _plugin = this;
    const leaves = this.app.workspace.getLeavesOfType(VIDEO_VIEW);

    for (const leaf of leaves) {
      if (leaf.view instanceof VideoView) {
        // 加载字幕（传入 vaultFile 以使用稳定 key）
        const subs = await _plugin.getSubtitlesForUrl(url, vaultFile);

        // setEphemeralState 触发 VideoView 的 React 渲染
        leaf.setEphemeralState({
          url: resolvedUrl,

          // 把播放器实例和控制器传回给插件
          setupPlayer: (player: any, setPlaying: (p: boolean) => void) => {
            _plugin.player = player;
            _plugin.setPlaying = setPlaying;
          },

          setupError: (err: string) => {
            if (editor) {
              editor.replaceSelection(
                editor.getSelection() + `\n> [!error] Streaming Error \n> ${err}\n`,
              );
            }
          },

          // 关闭播放器时保存进度
          saveTimeOnUnload: async () => {
            if (_plugin.player) {
              _plugin.settings.urlStartTimeMap.set(
                url,
                Number(_plugin.player.getCurrentTime().toFixed(0)),
              );
            }
            await _plugin.saveSettings();
          },

          start: ~~(_plugin.settings.urlStartTimeMap.get(url) || 0),
          subtitles: subs,
          onSubtitleChange: _plugin.setCurrentSubtitle.bind(_plugin),
          showSubtitleOverlay: _plugin.settings.showSubtitleOverlay !== false,
          showSubtitleBrowser: _plugin.settings.showSubtitleBrowser !== false,

          // 如果是 vault 文件，构建同目录播放列表
          playlist: vaultFile ? _plugin.buildPlaylist(vaultFile) : null,

          // 播放列表导航
          onNavigatePlaylist: async (file: any) => {
            const newUrl = _plugin.app.vault.getResourcePath(file);
            await _plugin.activateView(newUrl, _plugin.editor, file);
          },
        });

        await _plugin.saveSettings();
      }
    }
  }

  // ==========================================================
  // 数据迁移 — 清理旧 blob URL 产生的重复字幕数据
  // ==========================================================

  /**
   * 迁移 subtitleLibrary
   *
   * 问题：旧版本用临时的 blob URL 做 key，同一视频多次打开产生多条重复数据。
   * 解决：按"字幕数+首句文本"哈希去重，保留一条。
   */
  private migrateSubtitleLibrary(
    library: Record<string, any[]>,
    fileMap: Record<string, string>,
  ): Record<string, any[]> {
    const result: Record<string, any[]> = {};
    const seenHashes = new Set<string>();

    for (const [key, cues] of Object.entries(library)) {
      if (!cues || !cues.length) continue;

      // 稳定 key（vault:// 或 https://）→ 直接保留
      if (key.startsWith("vault://") || key.startsWith("https://")) {
        result[key] = cues;
        const hash = `${cues.length}:${cues[0]?.text?.slice(0, 40) || ""}`;
        seenHashes.add(hash);
        continue;
      }

      // blob/app URL → 用哈希检测重复
      const hash = `${cues.length}:${cues[0]?.text?.slice(0, 40) || ""}`;
      if (seenHashes.has(hash)) {
        continue;  // 重复 → 跳过
      }
      seenHashes.add(hash);

      // 尝试找到对应的字幕文件路径做 key
      const mappedPath = fileMap[key];
      if (mappedPath) {
        const fileKey = "file://" + mappedPath.replace(/\.(srt|vtt)$/i, "");
        result[fileKey] = cues;
      } else {
        result[key] = cues;  // 没有映射 → 保留原始 key
      }
    }

    return result;
  }

  private migrateSubtitleFileMap(
    fileMap: Record<string, string>,
  ): Record<string, string> {
    const result: Record<string, string> = {};
    const seenPaths = new Set<string>();

    for (const [key, path] of Object.entries(fileMap)) {
      if (seenPaths.has(path)) continue;  // 重复路径 → 跳过
      seenPaths.add(path);

      if (key.startsWith("vault://") || key.startsWith("https://")) {
        result[key] = path;
      } else if (key.startsWith("blob:") || key.startsWith("app://")) {
        const fileKey = "file://" + path.replace(/\.(srt|vtt)$/i, "");
        result[fileKey] = path;
      } else {
        result[key] = path;
      }
    }

    return result;
  }

  // ==========================================================
  // 设置持久化
  // ==========================================================
  // Obsidian 的 loadData/saveData 自动读写 data.json
  // 注意：Map 类型不能直接序列化为 JSON，需要转换

  async loadSettings(): Promise<void> {
    const data = await this.loadData();  // Obsidian API：读取 data.json
    if (data) {
      // Map 不能存在 JSON 里，需要从普通对象重建
      const map = new Map<string, number>(
        Object.keys(data.urlStartTimeMap || {}).map((k) => [
          k, data.urlStartTimeMap[k],
        ]),
      );

      // 执行迁移：清理重复的 blob URL 字幕数据
      const migratedLibrary = this.migrateSubtitleLibrary(
        data.subtitleLibrary || {},
        data.subtitleFileMap || {},
      );
      const migratedFileMap = this.migrateSubtitleFileMap(
        data.subtitleFileMap || {},
      );

      // 合并：默认值 → 用户数据 → 迁移后的数据
      this.settings = {
        ...(DEFAULT_SETTINGS as SmartMediaNotesSettings),
        ...data,
        urlStartTimeMap: map,
        subtitleLibrary: migratedLibrary,
        subtitleFileMap: migratedFileMap,
        rssSubscriptions: data.rssSubscriptions || [],
        mediaFolders: data.mediaFolders || [],
      };

      // 如果迁移改变了数据，立即保存
      const oldLibKeys = Object.keys(data.subtitleLibrary || {}).length;
      const oldMapKeys = Object.keys(data.subtitleFileMap || {}).length;
      if (
        Object.keys(migratedLibrary).length !== oldLibKeys ||
        Object.keys(migratedFileMap).length !== oldMapKeys
      ) {
        await this.saveSettings();
      }
    } else {
      // 首次安装，无 data.json
      this.settings = Object.assign(
        {}, DEFAULT_SETTINGS, await this.loadData(),
      ) as SmartMediaNotesSettings;
    }
  }

  async saveSettings(): Promise<void> {
    // Map → 普通对象才能序列化为 JSON
    await this.saveData({
      ...this.settings,
      urlStartTimeMap: Object.fromEntries(this.settings.urlStartTimeMap),
    });
  }
}

// ============================================================
// 模态框类
// ============================================================
// Obsidian 的 Modal 基类提供 open()/close()/onOpen()/onClose() 生命周期

/**
 * VaultMediaModal — 模糊搜索 vault 中的媒体文件
 *
 * 继承 FuzzySuggestModal<TFile>：
 *   - getItems() 返回所有可选文件
 *   - getItemText() 定义每个文件的显示文本
 *   - onChooseItem() 处理用户选择
 */
class VaultMediaModal extends FuzzySuggestModal<TFile> {
  plugin: SmartMediaNotesPlugin;

  constructor(app: App, plugin: SmartMediaNotesPlugin) {
    super(app);
    this.plugin = plugin;
  }

  getItems(): TFile[] {
    // 筛选 vault 中所有媒体文件
    return this.app.vault.getFiles().filter((file) => {
      const ext = file.extension.toLowerCase();
      return MEDIA_EXTENSIONS.includes(ext);
    });
  }

  getItemText(file: TFile): string {
    return file.path;  // 显示完整路径
  }

  onChooseItem(file: TFile): void {
    const resourceUrl = this.app.vault.getResourcePath(file);
    this.plugin.activateView(resourceUrl, this.plugin.editor, file);
  }
}

/**
 * PodcastModal — 播客浏览器（RSS feed）
 *
 * 打开后显示加载动画 → fetch RSS → 渲染集数列表。
 * 点击某一集会关闭弹窗、插入笔记、打开播放器。
 */
class PodcastModal extends Modal {
  plugin: SmartMediaNotesPlugin;
  feedUrl: string;
  editor: Editor | null;
  episodes: any[] = [];
  feedTitle: string = "";
  error: string | null = null;

  constructor(app: App, plugin: SmartMediaNotesPlugin, feedUrl: string, editor: Editor | null) {
    super(app);
    this.plugin = plugin;
    this.feedUrl = feedUrl;
    this.editor = editor;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.style.cssText =
      "padding:0;min-width:400px;max-height:520px;display:flex;flex-direction:column;";

    // 加载动画
    const loadingDiv = contentEl.createEl("div", {
      style: { padding: "24px", textAlign: "center" },
    });
    loadingDiv.createEl("div", {
      text: "🎙", style: { fontSize: "32px", marginBottom: "12px" },
    });
    loadingDiv.createEl("div", {
      text: "Loading podcast feed...",
      style: { color: "var(--text-muted)", fontSize: "14px" },
    });
    loadingDiv.createEl("div", {
      text: this.feedUrl,
      style: { color: "var(--text-faint)", fontSize: "11px", marginTop: "4px", wordBreak: "break-all" },
    });

    this.loadFeed();
  }

  async loadFeed(): Promise<void> {
    const { contentEl } = this;
    try {
      const response = await fetch(this.feedUrl);
      const text = await response.text();
      const feedTitleMatch = text.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      this.feedTitle = feedTitleMatch
        ? feedTitleMatch[1].replace(/<[^>]+>/g, "").trim()
        : "Podcast";
      const episodes: any[] = [];
      let idx = 0;
      while (idx < text.length) {
        const itemStart = text.indexOf("<item", idx);
        if (itemStart === -1) break;
        const itemEnd = text.indexOf("</item>", itemStart);
        if (itemEnd === -1) break;
        const itemText = text.slice(itemStart, itemEnd + 7);
        const titleMatch = itemText.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
        const encMatch = itemText.match(/<enclosure[^>]*url="([^"]+)"/i);
        const dateMatch = itemText.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i);
        const durMatch =
          itemText.match(/<itunes:duration[^>]*>([^<]+)<\/itunes:duration>/i) ||
          itemText.match(/<duration[^>]*>([^<]+)<\/duration>/i);
        const descMatch = itemText.match(/<description[^>]*>([\s\S]*?)<\/description>/i);
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
              duration = `${m}:${s < 10 ? "0" : ""}${s}`;
            }
          }
          episodes.push({
            title: titleMatch ? titleMatch[1].replace(/<[^>]+>/g, "").trim() : "Untitled",
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
      this.episodes = episodes;
      if (!episodes.length) {
        const encMatches = [...text.matchAll(/<enclosure[^>]*url="([^"]+)"/gi)];
        encMatches.forEach((m: any, i: number) => {
          episodes.push({
            title: `Episode ${i + 1}`, url: m[1],
            date: "", duration: "", description: "",
          });
        });
        this.episodes = episodes;
      }
      if (!this.episodes.length) {
        this.error = "No playable episodes found in this feed.";
      }
    } catch (e) {
      this.error = "Failed to load podcast feed. The server may block cross-origin requests.";
    }

    // 渲染结果
    if (this.error) {
      contentEl.empty();
      const errDiv = contentEl.createEl("div", {
        style: { padding: "24px", textAlign: "center" },
      });
      errDiv.createEl("div", { text: "⚠️", style: { fontSize: "32px", marginBottom: "12px" } });
      errDiv.createEl("p", {
        text: this.error,
        style: { color: "var(--text-error)", fontSize: "13px", marginBottom: "12px" },
      });
      const retryBtn = errDiv.createEl("button", { text: "Retry" });
      retryBtn.style.cssText =
        "padding:6px 16px;border-radius:6px;cursor:pointer;" +
        "background:var(--interactive-accent);color:var(--text-on-accent);border:none;";
      retryBtn.addEventListener("click", () => { this.error = null; this.onOpen(); });
      return;
    }

    contentEl.empty();
    // 标题栏
    const titleBar = contentEl.createEl("div", {
      style: {
        padding: "14px 16px 10px",
        borderBottom: "1px solid var(--background-modifier-border)",
        flexShrink: 0,
      },
    });
    titleBar.createEl("div", {
      text: `🎙 ${this.feedTitle}`,
      style: { fontWeight: 700, fontSize: "15px" },
    });
    titleBar.createEl("div", {
      text: `${this.episodes.length} episodes`,
      style: { fontSize: "11px", color: "var(--text-muted)", marginTop: "2px" },
    });

    // 集数列表
    const list = contentEl.createEl("div", { style: { overflowY: "auto", flex: 1 } });
    this.episodes.forEach((ep: any, i: number) => {
      const num = this.episodes.length - i;
      const row = list.createEl("div", {
        style: {
          display: "flex", alignItems: "flex-start", gap: "10px",
          padding: "10px 16px", cursor: "pointer",
          borderBottom: "1px solid var(--background-modifier-border)",
          transition: "background 0.1s",
        },
      });
      row.addEventListener("mouseenter", () => {
        row.style.backgroundColor = "var(--background-modifier-hover)";
      });
      row.addEventListener("mouseleave", () => { row.style.backgroundColor = ""; });

      // 编号徽章
      const badge = row.createEl("div", {
        text: String(num),
        style: {
          width: "26px", height: "26px", borderRadius: "50%",
          background: "var(--interactive-accent)", color: "var(--text-on-accent)",
          fontSize: "11px", fontWeight: 700,
          display: "flex", alignItems: "center", justifyContent: "center",
          flexShrink: 0, marginTop: "1px",
        },
      });

      const body = row.createEl("div", { style: { flex: 1, minWidth: 0 } });
      body.createEl("div", {
        text: ep.title,
        style: { fontWeight: 600, fontSize: "13px", lineHeight: "1.3", wordBreak: "break-word" },
      });
      const meta = body.createEl("div", {
        style: { display: "flex", gap: "12px", marginTop: "3px", fontSize: "11px", color: "var(--text-muted)" },
      });
      if (ep.date) {
        try {
          const d = new Date(ep.date);
          meta.createEl("span", {
            text: d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }),
          });
        } catch (_) { meta.createEl("span", { text: ep.date }); }
      }
      if (ep.duration) meta.createEl("span", { text: `⏱ ${ep.duration}` });
      if (ep.description) {
        body.createEl("div", {
          text: ep.description,
          style: {
            fontSize: "11px", color: "var(--text-faint)", marginTop: "3px",
            lineHeight: "1.3", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          },
        });
      }

      row.addEventListener("click", async () => {
        this.close();
        const note = `\`\`\`timestamp-url\n${ep.url}\n\`\`\`\n> 🎙 ${this.feedTitle}: ${ep.title}\n`;
        this.editor?.replaceSelection(note);
        await this.plugin.activateView(ep.url, this.editor);
      });
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

/**
 * SampleModal — 本地文件选择器
 *
 * 创建一个隐藏的 <input type="file"> 元素，触发系统文件选择对话框。
 * 选中文件后创建 blob URL 传给播放器。
 */
class SampleModal extends Modal {
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
    // accept 属性限制可选文件类型
    input.setAttribute(
      "accept",
      "video/*,audio/*,.mp3,.m4a,.m4b,.aac,.ogg,.wav,.flac,.opus,.mp4,.mov,.avi,.mkv,.webm,.flv,.ogv",
    );
    input.onchange = (e: Event) => {
      const target = e.target as HTMLInputElement;
      if (target.files?.[0]) {
        const url = URL.createObjectURL(target.files[0]);
        this.activateView(url, this.editor);
        this.close();
      }
    };
    // 自动触发文件选择对话框（不需要用户点 input）
    input.click();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

/**
 * SubtitleModal — 字幕文件导入
 *
 * 类似的 <input type="file"> 模式，但只接受 .srt 和 .vtt 文件。
 */
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

    contentEl.createEl("p", { text: `Bind subtitles to: ${targetUrl}` });

    const input = contentEl.createEl("input");
    input.setAttribute("type", "file");
    input.setAttribute("accept", ".srt,.vtt,text/vtt,application/x-subrip");
    input.onchange = async (e: Event) => {
      const target = e.target as HTMLInputElement;
      const file = target.files?.[0];
      if (!file) return;
      await this.plugin.importSubtitlesForUrl(targetUrl, file);
      this.close();
    };
    input.click();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
