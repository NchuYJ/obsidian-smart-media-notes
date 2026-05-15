export interface SubtitleCue {
  start: number;
  end: number;
  text: string;
}

import type { TFile } from "obsidian";

export interface MediaFileEntry {
  basename: string;
  path: string;
  playableUrl: string;
  vaultFile: TFile | null;
}

export interface PodcastEpisode {
  title: string;
  url: string;
  date: string;
  duration: string;
  description: string;
}

export interface ResolvedMedia {
  playableUrl: string;
  displayPath: string;
  isVaultFile: boolean;
  isSystemFile?: boolean;
  vaultFile?: TFile;
}

// Default media format lists (user can override via plugin settings)
export const DEFAULT_VIDEO_FORMATS = "mp4,m4v,mov,avi,mkv,webm,flv,ogv,wmv";
export const DEFAULT_AUDIO_FORMATS = "mp3,m4a,m4b,aac,ogg,oga,wav,flac,opus,wma";

// Mutable shared media extension lists — updated from plugin settings
// Start with the full default combined list
let _currentVideoFormats = DEFAULT_VIDEO_FORMATS;
let _currentAudioFormats = DEFAULT_AUDIO_FORMATS;

function buildCombined(): string[] {
  return [...new Set([
    ..._currentVideoFormats.split(","),
    ..._currentAudioFormats.split(","),
  ])];
}

export let MEDIA_EXTENSIONS: string[] = buildCombined();
export let MEDIA_URL_EXTENSION_RE: RegExp = new RegExp(
  "\\.(" + buildCombined().join("|") + ")$", "i"
);
export let AUDIO_EXTENSIONS_RE: RegExp = new RegExp(
  "\\.(" + DEFAULT_AUDIO_FORMATS.split(",").join("|") + ")(\\?.*)?$", "i"
);

/** Update media extension lists from settings (called from plugin.loadSettings) */
export function setMediaFormats(videoFormats: string, audioFormats: string): void {
  _currentVideoFormats = videoFormats || DEFAULT_VIDEO_FORMATS;
  _currentAudioFormats = audioFormats || DEFAULT_AUDIO_FORMATS;
  MEDIA_EXTENSIONS = buildCombined();
  const all = buildCombined();
  MEDIA_URL_EXTENSION_RE = new RegExp("\\.(" + all.join("|") + ")$", "i");
  AUDIO_EXTENSIONS_RE = new RegExp(
    "\\.(" + _currentAudioFormats.split(",").join("|") + ")(\\?.*)?$", "i"
  );
}

/** Get the current video format list as a string array */
export function getVideoFormats(): string[] {
  return _currentVideoFormats.split(",");
}

/** Get the current audio format list as a string array */
export function getAudioFormats(): string[] {
  return _currentAudioFormats.split(",");
}

/** 判断 URL/路径是否为音频文件 */
export function isAudioFile(url: string): boolean {
  return AUDIO_EXTENSIONS_RE.test(url);
}

export function formatSecondsAsTimestamp(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Number(totalSeconds || 0));
  const leadingZero = (num: number) =>
    num < 10 ? "0" + Math.floor(num) : Math.floor(num).toString();
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds - hours * 3600) / 60);
  const seconds = Math.floor(safeSeconds - hours * 3600 - minutes * 60);
  return (hours > 0 ? leadingZero(hours) + ":" : "") +
    leadingZero(minutes) + ":" + leadingZero(seconds);
}

export function parseTimestampToSeconds(value: string): number | null {
  const parts = value.trim().replace(",", ".").split(":").map((v) => Number(v));
  if (parts.some((part) => Number.isNaN(part))) return null;
  const [hh, mm, ss] = parts.length === 3 ? parts : [0, parts[0], parts[1]];
  return hh * 3600 + mm * 60 + ss;
}

export function parseSubtitleFile(content: string, fileName?: string): SubtitleCue[] {
  const normalized = content.replace(/\r/g, "").trim();
  if (!normalized) return [];

  if (fileName?.toLowerCase().endsWith(".vtt") || normalized.startsWith("WEBVTT")) {
    return normalized.split(/\n\s*\n/).map((block) => block.trim())
      .filter(Boolean).map((block) => {
        const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
        const cueLines = lines[0] === "WEBVTT" ? lines.slice(1) : lines;
        const timeLine = cueLines.find((line) => line.includes("-->"));
        if (!timeLine) return null;
        const [startRaw, endRaw] = timeLine.split("-->").map((item) => item.trim().split(" ")[0]);
        const text = cueLines.slice(cueLines.indexOf(timeLine) + 1).join(" ").trim();
        const start = parseTimestampToSeconds(startRaw);
        const end = parseTimestampToSeconds(endRaw);
        if (start == null || end == null || !text) return null;
        return { start, end, text };
      }).filter(Boolean) as SubtitleCue[];
  }

  return normalized.split(/\n\s*\n/).map((block) => block.trim())
    .filter(Boolean).map((block) => {
      const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
      const timeLine = lines.find((line) => line.includes("-->"));
      if (!timeLine) return null;
      const [startRaw, endRaw] = timeLine.split("-->").map((item) => item.trim());
      const text = lines.slice(lines.indexOf(timeLine) + 1).join(" ").trim();
      const start = parseTimestampToSeconds(startRaw);
      const end = parseTimestampToSeconds(endRaw);
      if (start == null || end == null || !text) return null;
      return { start, end, text };
    }).filter(Boolean) as SubtitleCue[];
}

export function findCueAtTime(subtitles: SubtitleCue[], currentTime: number): SubtitleCue | null {
  return subtitles.find(
    (cue) => currentTime >= cue.start && currentTime <= cue.end,
  ) || null;
}

export function urlToSafeName(url: string): string {
  let hash = 0;
  for (let i = 0; i < url.length; i++) {
    hash = (hash << 5) - hash + url.charCodeAt(i);
    hash |= 0;
  }
  const absHash = Math.abs(hash).toString(36);
  let name = url.replace(/^https?:\/\//i, "")
    .replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 60);
  if (name.length < 3) name = absHash;
  return name + "_" + absHash.slice(0, 6);
}

export function normalizeMediaCandidate(value: unknown): string {
  if (!value || typeof value !== "string") return "";
  let normalized = value.trim();
  const markdownMatch = normalized.match(/^\[[^\]]*\]\((https?:\/\/[^\s)]+)\)$/i);
  if (markdownMatch) normalized = markdownMatch[1].trim();
  if (normalized.startsWith("<") && normalized.endsWith(">")) {
    normalized = normalized.slice(1, -1).trim();
  }
  if ((normalized.startsWith('"') && normalized.endsWith('"')) ||
      (normalized.startsWith("'") && normalized.endsWith("'"))) {
    normalized = normalized.slice(1, -1).trim();
  }
  return normalized;
}

export function isPlayableMedia(url: string): boolean {
  if (!url || typeof url !== "string") return false;
  const trimmed = normalizeMediaCandidate(url);
  if (!trimmed) return false;
  if (/^blob:/i.test(trimmed) || /^app:\/\//i.test(trimmed) || /^file:\/\//i.test(trimmed)) {
    return true;
  }
  if (/\.(mp3|m4a|m4b|aac|ogg|oga|wav|wma|flac|opus|webm|mp4|mov|avi|mkv|wmv|flv|ogv|webm|m3u8|mpd)(\?.*)?$/i.test(trimmed)) {
    return true;
  }
  try {
    const parsed = new URL(trimmed);
    if (MEDIA_URL_EXTENSION_RE.test(parsed.pathname)) return true;
  } catch (_) { /* not a URL */ }
  return /^(https?:\/\/)?[^\s]+\.(mp3|m4a|aac|ogg)(\?.*)?$/i.test(trimmed);
}

// ============================================================

/** Parse a timestamp-url block source into alias and URL.
 *  Two-line format:  alias\nhttps://...  → { alias, url }
 *  Single-line:      https://...         → { url }
 */
/** Parse a timestamp-url block source into alias and URL.
 *  Supported formats:
 *    name | https://...        — single-line pipe (preferred)
 *    [title](link)             — markdown link (YouTube paste, etc.)
 *    name\nhttps://...         — two-line (legacy)
 *    https://...               — URL only
 *    /path/to/file.mp4         — file path
 */
export function parseTimestampUrlBlock(source: string): { alias?: string; url: string } {
  const s = source.trim();
  // Format 1: markdown link [title](url)
  const mdMatch = s.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/);
  if (mdMatch) {
    return { alias: mdMatch[1].trim(), url: mdMatch[2].trim() };
  }
  // Format 2: name | link  (pipe-separated single line)
  const pipeIdx = s.indexOf("|");
  if (pipeIdx > 0) {
    const alias = s.substring(0, pipeIdx).trim();
    const link = s.substring(pipeIdx + 1).trim();
    if (link) return { alias: alias || undefined, url: link };
  }
  // Format 3: name\nlink (two-line legacy)
  const lines = s.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length >= 2) {
    const last = lines[lines.length - 1];
    const isUrl = /^https?:\/\//i.test(last);
    const isPath = /^(\/|[A-Za-z]:\\)/.test(last);  // Unix / Windows path
    if (isUrl || isPath) {
      return { alias: lines[0], url: last };
    }
    // If last line isn't a URL/path, treat entire source as URL
  }
  // Format 4: URL / path only
  return { url: s };
}

// 听写模式 — 文本对比
// ============================================================

/** 单词对比结果 */
export interface WordDiff {
  word: string;
  correct: boolean; // true=绿色(正确), false=红色(错误)
}

/**
 * 对比用户输入与字幕原文，逐词标记正误
 *
 * 算法：
 *   1. 归一化（去标点、小写）
 *   2. 用 LCS 思想做贪心对齐
 *   3. 匹配到的词标绿，用户多出的词标红，字幕多出的词标红（缺失）
 */
export function compareDictation(
  userText: string,
  referenceText: string,
): { userWords: WordDiff[]; refWords: string[]; allCorrect: boolean } {
  // 分词：按空格/标点分割，保留原始大小写
  const tokenize = (s: string) =>
    s.trim().split(/\s+/).filter((w) => w.length > 0);
  const normalize = (s: string) =>
    s.toLowerCase().replace(/[^\w\s'-]/g, "").trim();

  const userRaw = tokenize(userText);
  const refRaw = tokenize(referenceText);
  const userNorm = userRaw.map(normalize);
  const refNorm = refRaw.map(normalize);

  // 贪心对齐：对每个用户词，在参考词中找最近未匹配的相同词
  const used = new Array(refNorm.length).fill(false);
  const userWords: WordDiff[] = [];

  for (const [wi, uw] of userNorm.entries()) {
    let matched = false;
    // 先在参考词中查找
    for (let ri = 0; ri < refNorm.length; ri++) {
      if (!used[ri] && refNorm[ri] === uw) {
        used[ri] = true;
        matched = true;
        break;
      }
    }
    userWords.push({ word: userRaw[wi], correct: matched });
  }

  // 参考词中未匹配的 = 用户漏掉的
  const missedWords: string[] = [];
  for (let ri = 0; ri < refNorm.length; ri++) {
    if (!used[ri]) missedWords.push(refRaw[ri]);
  }

  const allCorrect = missedWords.length === 0 &&
    userWords.every((w) => w.correct);

  return { userWords, refWords: missedWords, allCorrect };
}

/**
 * 把对比结果格式化为带颜色的 HTML 字符串
 * 用于插入 Obsidian 笔记（Obsidian 支持内联 HTML）
 */
export function formatDictationResult(
  diff: { userWords: WordDiff[]; refWords: string[] },
  subtitleText: string,
): string {
  const parts: string[] = [];

  // 用户输入行
  parts.push('<p><b>Your input:</b><br>');
  for (const w of diff.userWords) {
    if (w.correct) {
      parts.push(`<span style="color:green;font-weight:600">${w.word}</span> `);
    } else {
      parts.push(`<span style="color:red;font-weight:600">${w.word}</span> `);
    }
  }
  parts.push('</p>');

  // 字幕原文行
  parts.push('<p><b>Original:</b><br>');
  parts.push(`<span style="color:var(--text-normal)">${subtitleText}</span>`);
  parts.push('</p>');

  // 漏掉的词
  if (diff.refWords.length > 0) {
    parts.push(
      `<p><b>Missed:</b> <span style="color:orange">${diff.refWords.join(", ")}</span></p>`,
    );
  }

  return parts.join("\n");
}
