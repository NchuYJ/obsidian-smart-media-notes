/**
 * utils.ts — 纯函数工具库
 *
 * 这个文件里的所有函数都是"纯函数"（给定相同输入，永远返回相同输出），
 * 不依赖 Obsidian API，不访问文件系统，不修改外部状态。
 * 这种设计让它们容易测试，也能在插件外部复用。
 */

// ============================================================
// 类型定义 — TypeScript 的核心优势
// ============================================================

/** 一条字幕：有开始时间、结束时间、文本内容 */
export interface SubtitleCue {
  start: number;  // 开始秒数，如 4.096
  end: number;    // 结束秒数，如 9.519
  text: string;   // 字幕文本
}

/** 媒体文件条目，用于在侧边栏列表中展示 */
export interface MediaFileEntry {
  basename: string;      // 文件名（不含扩展名）
  path: string;          // 完整路径
  playableUrl: string;   // 可播放的 URL（blob URL 或资源路径）
  vaultFile: any | null; // Obsidian TFile 对象，系统文件时为 null
}

/** RSS 播客的单集信息 */
export interface PodcastEpisode {
  title: string;
  url: string;
  date: string;
  duration: string;
  description: string;
}

/** 解析后的媒体地址：统一了 vault 文件、系统文件、网络 URL 三种来源 */
export interface ResolvedMedia {
  playableUrl: string;   // 最终传给播放器的 URL
  displayPath: string;   // 在 UI 中显示的路径
  isVaultFile: boolean;  // 是否是 vault 内的文件
  isSystemFile?: boolean; // 是否是系统本地文件
  vaultFile?: any;       // 原始 Obsidian TFile（vault 文件时）
}

// ============================================================
// 常量 — 放在文件顶部方便修改
// ============================================================

/** 支持的媒体文件扩展名 — 用于筛选 vault 中的媒体文件 */
export const MEDIA_EXTENSIONS = [
  "mp4", "mov", "avi", "mkv", "webm", "flv", "ogv", "wmv",
  "mp3", "m4a", "m4b", "aac", "ogg", "oga", "wav", "flac", "opus", "wma",
];

/**
 * 匹配 URL 路径中的媒体扩展名
 * 用正则而非遍历数组，因为要匹配 URL 里的文件名（如 ?t=123 之后的扩展名）
 */
export const MEDIA_URL_EXTENSION_RE =
  /\.(mp3|m4a|m4b|aac|ogg|oga|wav|wma|flac|opus|webm|mp4|mov|avi|mkv|wmv|flv|ogv|m3u8|mpd)$/i;

// ============================================================
// 时间格式转换
// ============================================================

/**
 * 秒数 → 时间戳字符串
 * 例如：3661 秒 → "1:01:01"，65 秒 → "1:05"
 *
 * @param totalSeconds 总秒数（支持浮点数，会自动取整）
 * @returns 格式为 H:MM:SS 或 M:SS 的字符串
 */
export function formatSecondsAsTimestamp(totalSeconds: number): string {
  // Math.max 确保不会出现负数（player 刚初始化时 currentTime 可能为负）
  const safeSeconds = Math.max(0, Number(totalSeconds || 0));
  // 补零工具：个位数前加 0
  const leadingZero = (num: number) =>
    num < 10 ? "0" + Math.floor(num) : Math.floor(num).toString();
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds - hours * 3600) / 60);
  const seconds = Math.floor(safeSeconds - hours * 3600 - minutes * 60);
  // 只有超过 1 小时才显示小时位
  return (hours > 0 ? leadingZero(hours) + ":" : "") +
    leadingZero(minutes) + ":" + leadingZero(seconds);
}

/**
 * 时间戳字符串 → 秒数
 * 支持 "1:23:45"、"23:45"、"23,45"（逗号做小数点）等格式
 *
 * @returns 秒数，无法解析时返回 null
 */
export function parseTimestampToSeconds(value: string): number | null {
  // 处理逗号小数点（某些地区格式）→ 替换为点号
  const parts = value.trim().replace(",", ".").split(":").map((v) => Number(v));
  // 任一部分不是数字 → 解析失败
  if (parts.some((part) => Number.isNaN(part))) return null;
  // 3 段 = 时:分:秒，2 段 = 分:秒
  const [hh, mm, ss] = parts.length === 3 ? parts : [0, parts[0], parts[1]];
  return hh * 3600 + mm * 60 + ss;
}

// ============================================================
// 字幕文件解析
// ============================================================

/**
 * 解析 SRT 或 VTT 字幕文件内容
 *
 * SRT 格式示例：
 *   1
 *   00:00:00,080 --> 00:00:04,096
 *   This was Trump's net worth...
 *
 * VTT 格式示例：
 *   WEBVTT
 *
 *   00:00:00.080 --> 00:00:04.096
 *   This was Trump's net worth...
 *
 * @param content 字幕文件的原始文本
 * @param fileName 可选的文件名，用于判断是 SRT 还是 VTT
 */
export function parseSubtitleFile(content: string, fileName?: string): SubtitleCue[] {
  // 统一换行符：\r\n → \n
  const normalized = content.replace(/\r/g, "").trim();
  if (!normalized) return [];

  // VTT 处理分支：文件名以 .vtt 结尾，或内容以 WEBVTT 开头
  if (fileName?.toLowerCase().endsWith(".vtt") || normalized.startsWith("WEBVTT")) {
    // 按空行分割每个字幕块
    return normalized.split(/\n\s*\n/).map((block) => block.trim())
      .filter(Boolean).map((block) => {
        const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
        // 跳过 WEBVTT 头部行
        const cueLines = lines[0] === "WEBVTT" ? lines.slice(1) : lines;
        // 找包含 "-->" 的时间行
        const timeLine = cueLines.find((line) => line.includes("-->"));
        if (!timeLine) return null;
        // "00:00:00.080 --> 00:00:04.096 align:start" → split(" ") → 取第一部分
        const [startRaw, endRaw] = timeLine.split("-->").map((item) => item.trim().split(" ")[0]);
        // 时间行之后的所有行拼成字幕文本
        const text = cueLines.slice(cueLines.indexOf(timeLine) + 1).join(" ").trim();
        const start = parseTimestampToSeconds(startRaw);
        const end = parseTimestampToSeconds(endRaw);
        if (start == null || end == null || !text) return null;
        return { start, end, text };
      }).filter(Boolean) as SubtitleCue[];
  }

  // SRT 处理分支：格式类似 VTT 但没有 WEBVTT 头部
  return normalized.split(/\n\s*\n/).map((block) => block.trim())
    .filter(Boolean).map((block) => {
      const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
      const timeLine = lines.find((line) => line.includes("-->"));
      if (!timeLine) return null;
      // SRT 时间戳：00:00:00,080 --> 00:00:04,096
      const [startRaw, endRaw] = timeLine.split("-->").map((item) => item.trim());
      const text = lines.slice(lines.indexOf(timeLine) + 1).join(" ").trim();
      const start = parseTimestampToSeconds(startRaw);
      const end = parseTimestampToSeconds(endRaw);
      if (start == null || end == null || !text) return null;
      return { start, end, text };
    }).filter(Boolean) as SubtitleCue[];
}

/**
 * 在当前字幕列表中查找包含 currentTime 的字幕条目
 * 例如：currentTime=5.0 时，找到 start≤5≤end 的那条字幕
 */
export function findCueAtTime(subtitles: SubtitleCue[], currentTime: number): SubtitleCue | null {
  return subtitles.find(
    (cue) => currentTime >= cue.start && currentTime <= cue.end,
  ) || null;
}

// ============================================================
// URL / 路径处理
// ============================================================

/**
 * 将 URL 转换为安全的文件名
 * 用于把 YouTube URL 等变成合法的字幕文件名
 *
 * 例如：https://www.youtube.com/watch?v=kwEtOyaFhCA
 *    → www_youtube_com_watch_v_kwEtOyaFhCA_4w3yze.srt
 */
export function urlToSafeName(url: string): string {
  // Java 风格的字符串哈希 → 用于去重（不同 URL 产生不同哈希）
  let hash = 0;
  for (let i = 0; i < url.length; i++) {
    hash = (hash << 5) - hash + url.charCodeAt(i);
    hash |= 0; // 转为 32 位整数
  }
  const absHash = Math.abs(hash).toString(36); // 36 进制 = 短哈希
  // 取 URL 的可读部分：去掉协议，替换特殊字符为下划线
  let name = url.replace(/^https?:\/\//i, "")
    .replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, "_")  // 保留字母数字和中文
    .replace(/_+/g, "_")                            // 合并连续下划线
    .replace(/^_|_$/g, "")                          // 去掉首尾下划线
    .slice(0, 60);                                   // 限制长度
  if (name.length < 3) name = absHash;
  // 可读名 + 短哈希后缀 → 既可读又唯一
  return name + "_" + absHash.slice(0, 6);
}

/**
 * 清洗各种格式的媒体地址 → 纯 URL 字符串
 *
 * 支持的输入格式：
 *   - 纯 URL: https://example.com/video.mp4
 *   - Markdown 链接: [text](https://example.com/video.mp4)
 *   - 尖括号包裹: <https://example.com/video.mp4>
 *   - 引号包裹: "https://example.com/video.mp4"
 */
export function normalizeMediaCandidate(value: any): string {
  if (!value || typeof value !== "string") return "";
  let normalized = value.trim();
  // 提取 Markdown 链接 [text](url) 中的 url
  const markdownMatch = normalized.match(/^\[[^\]]*\]\((https?:\/\/[^\s)]+)\)$/i);
  if (markdownMatch) normalized = markdownMatch[1].trim();
  // 去掉尖括号 <url>
  if (normalized.startsWith("<") && normalized.endsWith(">")) {
    normalized = normalized.slice(1, -1).trim();
  }
  // 去掉引号
  if ((normalized.startsWith('"') && normalized.endsWith('"')) ||
      (normalized.startsWith("'") && normalized.endsWith("'"))) {
    normalized = normalized.slice(1, -1).trim();
  }
  return normalized;
}

/**
 * 判断一个字符串是否是可以直接播放的媒体 URL
 *
 * 检查顺序（从快到慢）：
 *   1. blob: / app:// / file:// 协议
 *   2. 路径以媒体扩展名结尾
 *   3. 标准 URL 解析后扩展名匹配
 *   4. 宽松的 URL 模式匹配
 */
export function isPlayableMedia(url: string): boolean {
  if (!url || typeof url !== "string") return false;
  const trimmed = normalizeMediaCandidate(url);
  if (!trimmed) return false;
  // Obsidian 内部协议：blob URL 和 app URL 都可以播放
  if (/^blob:/i.test(trimmed) || /^app:\/\//i.test(trimmed) || /^file:\/\//i.test(trimmed)) {
    return true;
  }
  // 直接匹配扩展名（包括 ?query=string 之后）
  if (/\.(mp3|m4a|m4b|aac|ogg|oga|wav|wma|flac|opus|webm|mp4|mov|avi|mkv|wmv|flv|ogv|webm|m3u8|mpd)(\?.*)?$/i.test(trimmed)) {
    return true;
  }
  // 标准 URL 解析 → 检查路径名中的扩展名
  try {
    const parsed = new URL(trimmed);
    if (MEDIA_URL_EXTENSION_RE.test(parsed.pathname)) return true;
  } catch (_) { /* 不是有效 URL，继续尝试 */ }
  // 最后尝试：宽松匹配（捕获没有协议前缀的 URL）
  return /^(https?:\/\/)?[^\s]+\.(mp3|m4a|aac|ogg)(\?.*)?$/i.test(trimmed);
}
