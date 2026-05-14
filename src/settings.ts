/**
 * settings.ts — 设置面板 + 默认配置
 *
 * Obsidian 插件的设置系统由三部分组成：
 *   1. DEFAULT_SETTINGS — 所有配置项的默认值
 *   2. SmartMediaNotesSettings 接口 — TypeScript 类型定义
 *   3. TimestampPluginSettingTab — 设置面板 UI（用 Obsidian 的 Setting API 构建）
 *
 * 数据流：
 *   用户修改设置 → PluginSettingTab.onChange() → plugin.saveSettings() → data.json
 *   插件启动 → plugin.loadSettings() → data.json → plugin.settings
 */

import { App, PluginSettingTab, Setting } from "obsidian";
import type SmartMediaNotesPlugin from "./main";

// ============================================================
// 设置接口 — 定义所有配置项的类型
// ============================================================

export interface SmartMediaNotesSettings {
  noteTitle: string;              // 打开媒体时自动插入的标题模板
  urlStartTimeMap: Map<string, number>;  // URL → 上次播放位置的映射
  urlColor: string;               // URL 按钮颜色
  timestampColor: string;         // 时间戳按钮颜色
  urlTextColor: string;           // URL 按钮文字颜色
  timestampTextColor: string;     // 时间戳按钮文字颜色
  forwardSeek: string;            // 快进秒数（字符串存储，取值时 parseInt）
  backwardsSeek: string;          // 快退秒数
  recordingsFolder: string;       // 录音保存目录
  subtitleTemplate: string;       // 字幕笔记模板（{time} 和 {text} 占位符）
  enableLiveTranscription: boolean; // 是否启用实时语音转文字
  showSubtitleOverlay: boolean;   // 字幕叠加层开关
  showSubtitleBrowser: boolean;   // 字幕列表开关
  includeSubtitleWithTimestamp: boolean; // 插入时间戳时是否附上字幕文本
  timestampWithSubtitleTemplate: string; // 附字幕时的模板
  subtitleStorageFolder: string;  // 字幕文件保存目录
  rssSubscriptions: Array<{ title: string; url: string } | string>; // RSS 订阅列表
  mediaFolders: string[];         // 媒体文件夹列表
  autoInsertLibraryNote: boolean; // 从媒体库点击时是否自动插入笔记
  subtitleFileMap: Record<string, string>;   // URL → 字幕文件路径
  subtitleLibrary: Record<string, any[]>;     // URL → 字幕数据缓存
}

// ============================================================
// 默认设置 — 插件首次安装时的初始值
// ============================================================

export const DEFAULT_SETTINGS: Partial<SmartMediaNotesSettings> = {
  noteTitle: "",
  urlColor: "blue",
  timestampColor: "green",
  urlTextColor: "white",
  timestampTextColor: "white",
  forwardSeek: "10",
  backwardsSeek: "10",
  recordingsFolder: "Attachments/voice-notes",
  subtitleTemplate: "> [!quote] {time}\n> {text}\n",
  enableLiveTranscription: true,
  showSubtitleOverlay: true,
  showSubtitleBrowser: true,
  includeSubtitleWithTimestamp: false,
  timestampWithSubtitleTemplate: "> {time} {text}\n",
  subtitleStorageFolder: "Subtitles",
  rssSubscriptions: [],
  mediaFolders: [],
  autoInsertLibraryNote: false,
  subtitleFileMap: {},
  subtitleLibrary: {},
};

// ============================================================
// 颜色和时间选项 — 下拉菜单的可选值
// ============================================================

const COLORS: Record<string, string> = {
  blue: "blue", red: "red", green: "green", yellow: "yellow",
  orange: "orange", purple: "purple", pink: "pink", grey: "grey",
  black: "black", white: "white",
};

const TIMES: Record<string, string> = {
  "5": "5", "10": "10", "15": "15", "20": "20", "25": "25",
  "30": "30", "35": "35", "40": "40", "45": "45", "50": "50",
  "55": "55", "60": "60", "65": "65", "70": "70", "75": "75",
  "80": "80", "85": "85", "90": "90", "95": "95", "100": "100",
  "105": "105", "110": "110", "115": "115", "120": "120",
};

// ============================================================
// 设置面板 UI
// ============================================================

export class TimestampPluginSettingTab extends PluginSettingTab {
  plugin: SmartMediaNotesPlugin;

  constructor(app: App, plugin: SmartMediaNotesPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  /**
   * display() 是 PluginSettingTab 的核心方法
   * Obsidian 在用户打开设置面板时调用它来渲染 UI
   *
   * Obsidian Setting API 的链式调用模式：
   *   new Setting(containerEl)  // 创建一个设置项
   *     .setName("标题")         // 设置项名称
   *     .setDesc("描述")         // 设置项描述（灰色小字）
   *     .addText(text => ...)   // 添加输入控件（text/dropdown/toggle/textarea）
   *     .onChange(async val => { // 值变化时保存
   *       plugin.settings.xxx = val;
   *       await plugin.saveSettings();
   *     })
   */
  display(): void {
    const { containerEl } = this;
    containerEl.empty(); // 清空旧内容（每次打开设置面板都会调用 display）

    containerEl.createEl("h2", { text: "Timestamp Notes Plugin" });

    // ---- 标题模板 ----
    new Setting(containerEl)
      .setName("Title")
      .setDesc("This title will be printed after opening a video with the hotkey. Use <br> for new lines.")
      .addText((text) =>
        text
          .setPlaceholder("Enter title template.")
          .setValue(this.plugin.settings.noteTitle)
          .onChange(async (value) => {
            this.plugin.settings.noteTitle = value;
            await this.plugin.saveSettings();
            // saveSettings() 调用 Obsidian 的 saveData() 写入 data.json
          }),
      );

    // ---- 颜色设置 ----
    // addDropdown() 创建下拉菜单
    new Setting(containerEl)
      .setName("URL Button Color")
      .setDesc("Pick a color for the url button.")
      .addDropdown((dropdown) =>
        dropdown
          .addOptions(COLORS)  // addOptions 接受 Record<string, string>
          .setValue(this.plugin.settings.urlColor)
          .onChange(async (value) => {
            this.plugin.settings.urlColor = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("URL Text Color")
      .setDesc("Pick a color for the URL text button.")
      .addDropdown((dropdown) =>
        dropdown
          .addOptions(COLORS)
          .setValue(this.plugin.settings.urlTextColor)
          .onChange(async (value) => {
            this.plugin.settings.urlTextColor = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Timestamp Button Color")
      .setDesc("Pick a color for the timestamp button.")
      .addDropdown((dropdown) =>
        dropdown
          .addOptions(COLORS)
          .setValue(this.plugin.settings.timestampColor)
          .onChange(async (value) => {
            this.plugin.settings.timestampColor = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Timestamp Text Color")
      .setDesc("Pick a color for the timestamp text.")
      .addDropdown((dropdown) =>
        dropdown
          .addOptions(COLORS)
          .setValue(this.plugin.settings.timestampTextColor)
          .onChange(async (value) => {
            this.plugin.settings.timestampTextColor = value;
            await this.plugin.saveSettings();
          }),
      );

    // ---- 跳转时间 ----
    new Setting(containerEl)
      .setName("Forward time seek")
      .setDesc("This is the amount of seconds the video will seek forward when pressing the seek forward command.")
      .addDropdown((dropdown) =>
        dropdown
          .addOptions(TIMES)
          .setValue(this.plugin.settings.forwardSeek)
          .onChange(async (value) => {
            this.plugin.settings.forwardSeek = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Backwards time seek")
      .setDesc("This is the amount of seconds the video will seek backwards when pressing the seek backwards command.")
      .addDropdown((dropdown) =>
        dropdown
          .addOptions(TIMES)
          .setValue(this.plugin.settings.backwardsSeek)
          .onChange(async (value) => {
            this.plugin.settings.backwardsSeek = value;
            await this.plugin.saveSettings();
          }),
      );

    // ---- 录音设置 ----
    new Setting(containerEl)
      .setName("Voice recordings folder")
      .setDesc("Saved audio recordings will be written to this vault folder.")
      .addText((text) =>
        text
          .setPlaceholder("Attachments/voice-notes")
          .setValue(this.plugin.settings.recordingsFolder)
          .onChange(async (value) => {
            // trim() 并回退到默认值 — 防止空字符串
            this.plugin.settings.recordingsFolder =
              value.trim() || DEFAULT_SETTINGS.recordingsFolder!;
            await this.plugin.saveSettings();
          }),
      );

    // ---- 字幕模板 ----
    // addTextArea() 创建多行文本框
    new Setting(containerEl)
      .setName("Subtitle note template")
      .setDesc("Use {time} and {text} placeholders when inserting the active subtitle into your note.")
      .addTextArea((text) =>
        text
          .setPlaceholder("> [!quote] {time}\n> {text}")
          .setValue(this.plugin.settings.subtitleTemplate)
          .onChange(async (value) => {
            this.plugin.settings.subtitleTemplate =
              value || DEFAULT_SETTINGS.subtitleTemplate!;
            await this.plugin.saveSettings();
          }),
      );

    // ---- 开关设置 ----
    // addToggle() 创建开关控件
    new Setting(containerEl)
      .setName("Live transcription")
      .setDesc("When supported by the embedded browser engine, record voice notes with realtime speech recognition.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableLiveTranscription)
          .onChange(async (value) => {
            this.plugin.settings.enableLiveTranscription = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Subtitle overlay")
      .setDesc("Show the current subtitle as an overlay on the video during playback.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showSubtitleOverlay)
          .onChange(async (value) => {
            this.plugin.settings.showSubtitleOverlay = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Subtitle browser")
      .setDesc("Show the scrollable subtitle list panel below the video.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showSubtitleBrowser)
          .onChange(async (value) => {
            this.plugin.settings.showSubtitleBrowser = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Subtitle storage folder")
      .setDesc("Imported subtitle files are saved to this vault folder so they sync across devices.")
      .addText((text) =>
        text
          .setPlaceholder("Subtitles")
          .setValue(this.plugin.settings.subtitleStorageFolder)
          .onChange(async (value) => {
            this.plugin.settings.subtitleStorageFolder =
              value.trim() || DEFAULT_SETTINGS.subtitleStorageFolder!;
            await this.plugin.saveSettings();
          }),
      );

    // ---- RSS 订阅 ----
    // addTextArea 用于多行输入 — 每行一个 feed
    new Setting(containerEl)
      .setName("RSS subscriptions")
      .setDesc("One per line. Use `Title | URL` or just the RSS URL. These feeds appear in the right sidebar library.")
      .addTextArea((text) =>
        text
          .setPlaceholder("Office Ladies | https://feeds.megaphone.fm/office-ladies")
          .setValue(this.plugin.stringifyRssSubscriptions())
          .onChange(async (value) => {
            // 解析输入 → 同时更新设置和刷新侧边栏
            this.plugin.settings.rssSubscriptions =
              this.plugin.parseRssSubscriptions(value);
            await this.plugin.saveSettings();
            await this.plugin.refreshLibraryView();
          }),
      );

    // ---- 媒体文件夹 ----
    new Setting(containerEl)
      .setName("Media folders")
      .setDesc("One path per line. Supports vault folders and Windows folder paths. These folders appear in the right sidebar library.")
      .addTextArea((text) =>
        text
          .setPlaceholder(
            "Attachments/audio\nEnglish/listening and saying\nC:\\Users\\YourName\\Music",
          )
          .setValue((this.plugin.settings.mediaFolders || []).join("\n"))
          .onChange(async (value) => {
            this.plugin.settings.mediaFolders = value
              .split("\n")
              .map((line) => line.trim())
              .filter((line) => line.length > 0);
            await this.plugin.saveSettings();
            await this.plugin.refreshLibraryView();
          }),
      );

    new Setting(containerEl)
      .setName("Auto insert library note")
      .setDesc("When enabled, clicking a Smart Media Library item also inserts the timestamp-url block and source line into the active markdown editor.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoInsertLibraryNote)
          .onChange(async (value) => {
            this.plugin.settings.autoInsertLibraryNote = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Include subtitle with timestamp")
      .setDesc("When inserting a timestamp, also insert the corresponding subtitle text (useful for language learning).")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.includeSubtitleWithTimestamp)
          .onChange(async (value) => {
            this.plugin.settings.includeSubtitleWithTimestamp = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Timestamp + subtitle template")
      .setDesc("Template for the subtitle line appended after the timestamp code block. Use {time} and {text} placeholders.")
      .addTextArea((text) =>
        text
          .setPlaceholder("> {time} {text}")
          .setValue(this.plugin.settings.timestampWithSubtitleTemplate)
          .onChange(async (value) => {
            this.plugin.settings.timestampWithSubtitleTemplate =
              value || DEFAULT_SETTINGS.timestampWithSubtitleTemplate!;
            await this.plugin.saveSettings();
          }),
      );
  }
}
