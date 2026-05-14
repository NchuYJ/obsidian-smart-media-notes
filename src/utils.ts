export interface SubtitleCue {
  start: number;
  end: number;
  text: string;
}

export interface MediaFileEntry {
  basename: string;
  path: string;
  playableUrl: string;
  vaultFile: any | null;
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
  vaultFile?: any;
}

export const MEDIA_EXTENSIONS = [
  "mp4", "mov", "avi", "mkv", "webm", "flv", "ogv", "wmv",
  "mp3", "m4a", "m4b", "aac", "ogg", "oga", "wav", "flac", "opus", "wma",
];

export const MEDIA_URL_EXTENSION_RE =
  /\.(mp3|m4a|m4b|aac|ogg|oga|wav|wma|flac|opus|webm|mp4|mov|avi|mkv|wmv|flv|ogv|m3u8|mpd)$/i;

/** 音频扩展名列表 — 用于判断文件是否为纯音频 */
export const AUDIO_EXTENSIONS_RE =
  /\.(mp3|m4a|m4b|aac|ogg|oga|wav|wma|flac|opus)(\?.*)?$/i;

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

export function normalizeMediaCandidate(value: any): string {
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
