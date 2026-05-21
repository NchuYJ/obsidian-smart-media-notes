import { requestUrl } from "obsidian";
import { normalizeMediaCandidate, toBilibiliEmbedUrl } from "../utils";

interface BilibiliPageInfo {
  cid: number;
  page: number;
}

interface BilibiliPlayUrl {
  url?: string;
  durl?: Array<{ url?: string; backup_url?: string[] }>;
}

export interface BilibiliDirectResult {
  type: "direct";
  url: string;
  displayUrl: string;
}

export interface BilibiliEmbedResult {
  type: "embed";
  url: string;
}

export type BilibiliResolveResult = BilibiliDirectResult | BilibiliEmbedResult;

interface ResolveOptions {
  cookie?: string;
  preferDirect?: boolean;
}

async function expandBilibiliUrl(input: string, cookie?: string): Promise<string> {
  const normalized = normalizeMediaCandidate(input);
  try {
    const url = new URL(normalized);
    if (url.hostname.toLowerCase() !== "b23.tv") return normalized;
    const response = await requestUrl({
      url: normalized,
      method: "GET",
      headers: buildHeaders(cookie),
    });
    const html = String(response.text || "");
    const canonical =
      html.match(/<meta\s+property="og:url"\s+content="([^"]+)"/i)?.[1] ||
      html.match(/<link\s+rel="canonical"\s+href="([^"]+)"/i)?.[1];
    return canonical || normalized;
  } catch {
    return normalized;
  }
}

function getBilibiliIds(input: string): { bvid?: string; aid?: string; page: number } | null {
  const normalized = normalizeMediaCandidate(input);
  try {
    const url = new URL(normalized);
    const path = url.pathname;
    const bvid = url.searchParams.get("bvid") || path.match(/\/video\/(BV[0-9A-Za-z]+)/i)?.[1];
    const aid = url.searchParams.get("aid") || path.match(/\/video\/av(\d+)/i)?.[1];
    const page = Number(url.searchParams.get("p") || url.searchParams.get("page") || "1") || 1;
    if (!bvid && !aid) return null;
    return { bvid, aid, page };
  } catch {
    return null;
  }
}

function buildHeaders(cookie?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Referer: "https://www.bilibili.com/",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari",
  };
  if (cookie) headers.Cookie = cookie;
  return headers;
}

function extractPageInfoFromHtml(html: string): BilibiliPageInfo | null {
  const cidMatch = html.match(/"cid":(\d+)/);
  const pageMatch = html.match(/"p":(\d+)/);
  const cid = cidMatch ? Number(cidMatch[1]) : 0;
  if (!cid) return null;
  return {
    cid,
    page: pageMatch ? Number(pageMatch[1]) || 1 : 1,
  };
}

function extractDirectUrlFromHtml(html: string): string | null {
  const playInfoMatch = html.match(/__playinfo__\s*=\s*(\{[\s\S]*?\})\s*<\/script>/i);
  if (!playInfoMatch) return null;
  try {
    const data = JSON.parse(playInfoMatch[1]) as {
      data?: {
        durl?: Array<{ url?: string; backup_url?: string[] }>;
        dash?: {
          video?: Array<{ baseUrl?: string; base_url?: string }>;
        };
      };
    };
    const durl = data.data?.durl?.[0];
    if (durl?.url) return durl.url;
    if (durl?.backup_url?.[0]) return durl.backup_url[0];
    const dashVideo = data.data?.dash?.video?.[0];
    return dashVideo?.baseUrl || dashVideo?.base_url || null;
  } catch {
    return null;
  }
}

async function fetchHtmlFallback(
  sourceUrl: string,
  cookie?: string,
): Promise<string> {
  const response = await requestUrl({
    url: sourceUrl,
    method: "GET",
    headers: buildHeaders(cookie),
  });
  return String(response.text || "");
}

async function fetchPageInfo(
  sourceUrl: string,
  cookie?: string,
): Promise<BilibiliPageInfo | null> {
  const ids = getBilibiliIds(sourceUrl);
  if (!ids) return null;
  const api = new URL("https://api.bilibili.com/x/player/pagelist");
  if (ids.bvid) api.searchParams.set("bvid", ids.bvid);
  if (ids.aid) api.searchParams.set("aid", ids.aid);
  const response = await requestUrl({
    url: api.toString(),
    method: "GET",
    headers: buildHeaders(cookie),
  });
  const json = response.json as { code?: number; data?: BilibiliPageInfo[] };
  if (json.code !== 0 || !json.data?.length) return null;
  return json.data.find((item) => item.page === ids.page) || json.data[0];
}

async function fetchDirectUrl(
  sourceUrl: string,
  cid: number,
  cookie?: string,
): Promise<string | null> {
  const ids = getBilibiliIds(sourceUrl);
  if (!ids) return null;
  const api = new URL("https://api.bilibili.com/x/player/playurl");
  if (ids.bvid) api.searchParams.set("bvid", ids.bvid);
  if (ids.aid) api.searchParams.set("avid", ids.aid);
  api.searchParams.set("cid", String(cid));
  api.searchParams.set("qn", "64");
  api.searchParams.set("fnval", "0");
  api.searchParams.set("fourk", "0");
  api.searchParams.set("platform", "html5");
  const response = await requestUrl({
    url: api.toString(),
    method: "GET",
    headers: buildHeaders(cookie),
  });
  const json = response.json as { code?: number; data?: BilibiliPlayUrl };
  if (json.code !== 0 || !json.data) return null;
  if (json.data.url) return json.data.url;
  const first = json.data.durl?.[0];
  return first?.url || first?.backup_url?.[0] || null;
}

export async function resolveBilibiliSource(
  sourceUrl: string,
  options: ResolveOptions = {},
): Promise<BilibiliResolveResult> {
  const normalizedSourceUrl = await expandBilibiliUrl(sourceUrl, options.cookie);
  const embedUrl = toBilibiliEmbedUrl(normalizedSourceUrl) || normalizedSourceUrl;
  if (!options.preferDirect) return { type: "embed", url: embedUrl };
  try {
    let pageInfo = await fetchPageInfo(normalizedSourceUrl, options.cookie);
    let html = "";
    if (!pageInfo) {
      html = await fetchHtmlFallback(normalizedSourceUrl, options.cookie);
      pageInfo = extractPageInfoFromHtml(html);
    }
    const directUrl = pageInfo
      ? await fetchDirectUrl(normalizedSourceUrl, pageInfo.cid, options.cookie)
      : "";
    if (directUrl) {
      return { type: "direct", url: directUrl, displayUrl: normalizedSourceUrl };
    }
    if (!html) html = await fetchHtmlFallback(normalizedSourceUrl, options.cookie);
    const htmlDirectUrl = extractDirectUrlFromHtml(html);
    if (htmlDirectUrl) {
      return { type: "direct", url: htmlDirectUrl, displayUrl: normalizedSourceUrl };
    }
    return { type: "embed", url: embedUrl };
  } catch {
    return { type: "embed", url: embedUrl };
  }
}
