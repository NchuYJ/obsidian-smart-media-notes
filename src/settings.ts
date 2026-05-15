import { App, PluginSettingTab, Setting } from "obsidian";
import type SmartMediaNotesPlugin from "./main";
import { DEFAULT_VIDEO_FORMATS, DEFAULT_AUDIO_FORMATS } from "./utils";

export interface SmartMediaNotesSettings {
  noteTitle: string;
  urlStartTimeMap: Map<string, number>;
  urlColor: string;
  timestampColor: string;
  urlTextColor: string;
  timestampTextColor: string;
  forwardSeek: string;
  backwardsSeek: string;
  recordingsFolder: string;
  subtitleTemplate: string;
  showSubtitleOverlay: boolean;
  showSubtitleBrowser: boolean;
  subtitleOverlayFontSize: string; // small / medium / large / xlarge
  dictationLoopCount: string;     // 听写重复次数: "0"=无限, 或 1/2/3/5
  dictationLoopGap: string;       // 重复间隔(秒): "0.5" / "1" / "1.5" / "2"
  includeSubtitleWithTimestamp: boolean;
  timestampWithSubtitleTemplate: string;
  subtitleStorageFolder: string;
  rssSubscriptions: Array<{ title: string; url: string } | string>;
  mediaFolders: string[];
  videoFormats: string;
  audioFormats: string;
  autoInsertLibraryNote: boolean;
  subtitleFileMap: Record<string, string>;
  subtitleLibrary: Record<string, any[]>;
}

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
  showSubtitleOverlay: true,
  showSubtitleBrowser: true,
  subtitleOverlayFontSize: "large",
  dictationLoopCount: "0",
  dictationLoopGap: "0.5",
  includeSubtitleWithTimestamp: false,
  timestampWithSubtitleTemplate: "> {time} {text}\n",
  subtitleStorageFolder: "Subtitles",
  rssSubscriptions: [],
  mediaFolders: [],
  videoFormats: DEFAULT_VIDEO_FORMATS,
  audioFormats: DEFAULT_AUDIO_FORMATS,
  autoInsertLibraryNote: false,
  subtitleFileMap: {},
  subtitleLibrary: {},
};

const COLORS: Record<string, string> = {
  blue: "blue",
  red: "red",
  green: "green",
  yellow: "yellow",
  orange: "orange",
  purple: "purple",
  pink: "pink",
  grey: "grey",
  black: "black",
  white: "white",
};

const TIMES: Record<string, string> = {
  "5": "5", "10": "10", "15": "15", "20": "20", "25": "25",
  "30": "30", "35": "35", "40": "40", "45": "45", "50": "50",
  "55": "55", "60": "60", "65": "65", "70": "70", "75": "75",
  "80": "80", "85": "85", "90": "90", "95": "95", "100": "100",
  "105": "105", "110": "110", "115": "115", "120": "120",
};

const FONT_SIZES: Record<string, string> = {
  small: "Small (13px)",
  medium: "Medium (15px)",
  large: "Large (18px)",
  xlarge: "Extra Large (22px)",
};

const LOOP_COUNTS: Record<string, string> = {
  "0": "Infinite",
  "1": "1 time",
  "2": "2 times",
  "3": "3 times",
  "5": "5 times",
};

const LOOP_GAPS: Record<string, string> = {
  "0": "No gap",
  "0.5": "0.5 sec",
  "1": "1 sec",
  "1.5": "1.5 sec",
  "2": "2 sec",
};

export class TimestampPluginSettingTab extends PluginSettingTab {
  plugin: SmartMediaNotesPlugin;

  constructor(app: App, plugin: SmartMediaNotesPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Timestamp Notes Plugin" });

    new Setting(containerEl)
      .setName("Title")
      .setDesc(
        "This title will be printed after opening a video with the hotkey. Use <br> for new lines.",
      )
      .addText((text) =>
        text
          .setPlaceholder("Enter title template.")
          .setValue(this.plugin.settings.noteTitle)
          .onChange(async (value) => {
            this.plugin.settings.noteTitle = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("URL Button Color")
      .setDesc("Pick a color for the url button.")
      .addDropdown((dropdown) =>
        dropdown
          .addOptions(COLORS)
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

    new Setting(containerEl)
      .setName("Forward time seek")
      .setDesc(
        "This is the amount of seconds the video will seek forward when pressing the seek forward command.",
      )
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
      .setDesc(
        "This is the amount of seconds the video will seek backwards when pressing the seek backwards command.",
      )
      .addDropdown((dropdown) =>
        dropdown
          .addOptions(TIMES)
          .setValue(this.plugin.settings.backwardsSeek)
          .onChange(async (value) => {
            this.plugin.settings.backwardsSeek = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Voice recordings folder")
      .setDesc(
        "Saved audio recordings will be written to this vault folder.",
      )
      .addText((text) =>
        text
          .setPlaceholder("Attachments/voice-notes")
          .setValue(this.plugin.settings.recordingsFolder)
          .onChange(async (value) => {
            this.plugin.settings.recordingsFolder =
              value.trim() || DEFAULT_SETTINGS.recordingsFolder!;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Subtitle note template")
      .setDesc(
        "Use {time} and {text} placeholders when inserting the active subtitle into your note.",
      )
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

    new Setting(containerEl)
      .setName("Subtitle overlay")
      .setDesc(
        "Show the current subtitle as an overlay on the video during playback.",
      )
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
      .setDesc(
        "Show the scrollable subtitle list panel below the video.",
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showSubtitleBrowser)
          .onChange(async (value) => {
            this.plugin.settings.showSubtitleBrowser = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Subtitle overlay font size")
      .setDesc("Controls text size for both video subtitle overlay and audio subtitle banner.")
      .addDropdown((dropdown) =>
        dropdown
          .addOptions(FONT_SIZES)
          .setValue(this.plugin.settings.subtitleOverlayFontSize || "large")
          .onChange(async (value) => {
            this.plugin.settings.subtitleOverlayFontSize = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Dictation loop count")
      .setDesc("How many times to repeat each subtitle segment. 'Infinite' loops until you move to another sentence.")
      .addDropdown((dropdown) =>
        dropdown
          .addOptions(LOOP_COUNTS)
          .setValue(this.plugin.settings.dictationLoopCount || "0")
          .onChange(async (value) => {
            this.plugin.settings.dictationLoopCount = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Dictation gap between repeats")
      .setDesc("Pause between each repeat of a subtitle segment.")
      .addDropdown((dropdown) =>
        dropdown
          .addOptions(LOOP_GAPS)
          .setValue(this.plugin.settings.dictationLoopGap || "0.5")
          .onChange(async (value) => {
            this.plugin.settings.dictationLoopGap = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Subtitle storage folder")
      .setDesc(
        "Imported subtitle files are saved to this vault folder so they sync across devices.",
      )
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

    new Setting(containerEl)
      .setName("RSS subscriptions")
      .setDesc(
        "One per line. Use `Title | URL` or just the RSS URL. These feeds appear in the right sidebar library.",
      )
      .addTextArea((text) =>
        text
          .setPlaceholder(
            "Office Ladies | https://feeds.megaphone.fm/office-ladies",
          )
          .setValue(this.plugin.stringifyRssSubscriptions())
          .onChange(async (value) => {
            this.plugin.settings.rssSubscriptions =
              this.plugin.parseRssSubscriptions(value);
            await this.plugin.saveSettings();
            await this.plugin.refreshLibraryView();
          }),
      );

    new Setting(containerEl)
      .setName("Video formats")
      .setDesc(
        "Comma-separated video file extensions (no dots).",
      )
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_VIDEO_FORMATS)
          .setValue(this.plugin.settings.videoFormats || DEFAULT_VIDEO_FORMATS)
          .onChange(async (value) => {
            this.plugin.settings.videoFormats = value || DEFAULT_VIDEO_FORMATS;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Audio formats")
      .setDesc(
        "Comma-separated audio file extensions (no dots).",
      )
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_AUDIO_FORMATS)
          .setValue(this.plugin.settings.audioFormats || DEFAULT_AUDIO_FORMATS)
          .onChange(async (value) => {
            this.plugin.settings.audioFormats = value || DEFAULT_AUDIO_FORMATS;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Media folders")
      .setDesc(
        "One path per line. Supports vault folders and Windows folder paths. These folders appear in the right sidebar library.",
      )
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
      .setDesc(
        "When enabled, clicking a Smart Media Library item also inserts the timestamp-url block and source line into the active markdown editor.",
      )
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
      .setDesc(
        "When inserting a timestamp, also insert the corresponding subtitle text (useful for language learning).",
      )
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
      .setDesc(
        "Template for the subtitle line appended after the timestamp code block. Use {time} and {text} placeholders.",
      )
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
