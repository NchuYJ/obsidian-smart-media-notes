/**
 * VideoContainer.tsx — React 媒体播放器组件
 *
 * 这是在 Obsidian 里嵌入的 React 组件，负责：
 *   1. 用 react-player 播放视频/音频
 *   2. 显示字幕叠加层（overlay）
 *   3. 显示可点击的字幕列表（browser）
 *   4. 支持文件夹内媒体文件的前后导航（playlist）
 *
 * 它是怎么嵌进 Obsidian 的？
 *   VideoView（ItemView）用 createRoot 把这个组件挂到 Obsidian 面板的 DOM 节点上。
 *   详见 VideoView.tsx。
 */

import React, { useRef, useState, useEffect } from "react";
// react-player 支持 YouTube、本地文件、HLS 等几十种来源
// esbuild 的 tree-shaking 会自动删除未使用的播放器代码
import ReactPlayer from "react-player";
import { SubtitleCue, findCueAtTime, formatSecondsAsTimestamp } from "../utils";

// ============================================================
// 类型定义
// ============================================================

/** 播放列表信息：文件夹内的媒体文件列表和当前播放位置 */
export interface PlaylistInfo {
  files: any[];       // 同目录下的媒体 TFile 数组
  currentIndex: number; // 当前播放的是第几个
}

/** VideoContainer 接收的 props */
interface VideoContainerProps {
  url: string;                                        // 要播放的媒体 URL
  setupPlayer: (player: any, setPlaying: (p: boolean) => void) => void;  // 把播放器实例传回给插件
  start?: number;                                     // 从第几秒开始播放
  setupError: (err: string) => void;                   // 播放出错回调
  subtitles?: SubtitleCue[];                           // 字幕数据
  onSubtitleChange: (cue: SubtitleCue | null) => void; // 当前字幕变化时通知插件
  showSubtitleOverlay?: boolean;   // 是否在视频上方显示当前字幕
  showSubtitleBrowser?: boolean;   // 是否在视频下方显示字幕列表
  playlist?: PlaylistInfo | null;  // 播放列表（同目录文件导航）
  onNavigatePlaylist?: (file: any) => void;  // 切换到上/下一个文件
}

// ============================================================
// 组件主体
// ============================================================

const VideoContainer: React.FC<VideoContainerProps> = ({
  url,
  setupPlayer,
  start,
  setupError,
  subtitles,
  onSubtitleChange,
  showSubtitleOverlay,
  showSubtitleBrowser,
  playlist,
  onNavigatePlaylist,
}) => {
  // ---- Refs 和状态 ----

  /** 播放器实例的引用 — 用于调用 seekTo()、getCurrentTime() 等方法 */
  const playerRef = useRef<any>();

  /** 字幕列表容器的引用 — 用于自动滚动到当前字幕 */
  const subtitleListRef = useRef<HTMLDivElement>(null);

  /** 控制播放/暂停 */
  const [playing, setPlaying] = useState(false);

  /** 当前高亮的字幕条目 */
  const [activeSubtitle, setActiveSubtitle] = useState<SubtitleCue | null>(null);

  // ---- URL 变化时自动开始播放 ----
  // 每次 url 改变（切换视频），先短暂暂停再开始，让播放器重新初始化
  useEffect(() => {
    setPlaying(false);
    const timer = setTimeout(() => setPlaying(true), 400);
    return () => clearTimeout(timer); // 清理：防止内存泄漏
  }, [url]);

  // ---- 当前字幕变化时自动滚动 ----
  // 让字幕列表自动滚动到当前播放的字幕行
  useEffect(() => {
    if (activeSubtitle && subtitleListRef.current) {
      const el = subtitleListRef.current.querySelector('[data-active="true"]');
      if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [activeSubtitle]);

  // ---- 播放器事件处理 ----

  /** 播放器准备好后：跳转到起始时间，把实例传回给插件 */
  const onReady = () => {
    if (start) playerRef.current.seekTo(start);
    // setupPlayer 把 player 引用和 setPlaying 函数传给插件
    // 这样插件可以用 this.player.seekTo() 来控制播放
    if (playerRef) setupPlayer(playerRef.current, setPlaying);
  };

  /**
   * 播放进度更新回调（每 200ms 触发一次）
   * react-player 的 onProgress 传入 { playedSeconds, played, loadedSeconds, loaded }
   */
  const handleProgress = (state: { playedSeconds: number }) => {
    // 查找当前播放时间对应的字幕
    const nextSubtitle = findCueAtTime(subtitles || [], state.playedSeconds || 0);
    // 只在字幕真正变化时才更新状态（避免不必要的重渲染）
    if (nextSubtitle?.start !== activeSubtitle?.start) {
      setActiveSubtitle(nextSubtitle);
      onSubtitleChange(nextSubtitle);
    }
  };

  /** 点击字幕行 → 跳转到对应时间 */
  const handleSubtitleClick = (cue: SubtitleCue) => {
    if (playerRef.current) playerRef.current.seekTo(cue.start);
  };

  // ---- 渲染 ----

  const hasSubtitles = subtitles && subtitles.length > 0;

  /** 字幕列表项 — 每条字幕一行，当前播放的字幕高亮 */
  const subtitleItems = hasSubtitles
    ? subtitles!.map((cue, idx) => {
        const isActive = activeSubtitle && activeSubtitle.start === cue.start;
        return (
          <div
            key={idx}
            data-active={isActive ? "true" : "false"}  // 用于 scrollIntoView 查找
            onClick={() => handleSubtitleClick(cue)}
            style={{
              padding: "5px 10px",
              cursor: "pointer",
              borderBottom: "1px solid var(--background-modifier-border)",
              // 用 Obsidian CSS 变量 — 自动适配明暗主题
              backgroundColor: isActive
                ? "var(--interactive-accent)"
                : "transparent",
              color: isActive
                ? "var(--text-on-accent)"
                : "var(--text-normal)",
              fontSize: "12px",
              lineHeight: "1.4",
              transition: "background-color 0.15s",
            }}
            onMouseEnter={(e) => {
              if (!isActive)
                e.currentTarget.style.backgroundColor =
                  "var(--background-modifier-hover)";
            }}
            onMouseLeave={(e) => {
              if (!isActive)
                e.currentTarget.style.backgroundColor = "transparent";
            }}
          >
            {/* 时间戳标签 */}
            <span
              style={{
                fontWeight: 600,
                marginRight: "8px",
                opacity: isActive ? 1 : 0.65,
                fontSize: "10px",
                fontFamily: "var(--font-monospace)",     // Obsidian 等宽字体
                whiteSpace: "nowrap",
              }}
            >
              {formatSecondsAsTimestamp(cue.start)}
            </span>
            <span>{cue.text}</span>
          </div>
        );
      })
    : null;

  return (
    // 最外层：flex 纵向布局
    <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%" }}>
      {/* 播放器区域 + 字幕叠加层 */}
      <div style={{ position: "relative", flex: "1 1 auto", minHeight: 0 }}>
        {/* react-player 组件 — 核心播放器 */}
        <ReactPlayer
          key={url}              // key=url → url 变化时销毁旧实例，创建新实例
          ref={playerRef}
          url={url}
          playing={playing}
          controls={true}        // 显示播放控件（进度条、音量等）
          width="100%"
          height="100%"
          onReady={onReady}
          onProgress={handleProgress}
          progressInterval={200} // 每 200ms 报告一次进度
          onError={(err: any) =>
            setupError(
              err?.message ||
                "Video is unplayable due to privacy settings, streaming permissions, etc.",
            )
          }
        />

        {/* 字幕叠加层 — 半透明浮在视频底部 */}
        {activeSubtitle && showSubtitleOverlay && (
          <div
            style={{
              position: "absolute",
              left: "16px", right: "16px", bottom: "18px",
              padding: "10px 14px",
              borderRadius: "12px",
              background: "rgba(0, 0, 0, 0.72)",
              color: "white",
              fontSize: "15px",
              lineHeight: "1.45",
              textAlign: "center",
              pointerEvents: "none",     // 鼠标事件穿透 → 不阻挡播放器控件
              backdropFilter: "blur(6px)", // 毛玻璃效果
            }}
          >
            {activeSubtitle.text}
          </div>
        )}
      </div>

      {/* 播放列表导航栏 — 只有同目录有多个媒体文件时显示 */}
      {playlist && (
        <div
          style={{
            flex: "0 0 auto",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "10px",
            padding: "4px 8px",
            borderTop: "1px solid var(--background-modifier-border)",
            backgroundColor: "var(--background-secondary)",
            fontSize: "11px",
          }}
        >
          {/* 上一个 */}
          <button
            onClick={() => {
              if (playlist.currentIndex > 0)
                onNavigatePlaylist?.(playlist.files[playlist.currentIndex - 1]);
            }}
            disabled={playlist.currentIndex <= 0}
            style={{
              padding: "1px 8px",
              cursor: playlist.currentIndex > 0 ? "pointer" : "default",
              opacity: playlist.currentIndex > 0 ? 1 : 0.3,
            }}
          >◀</button>

          {/* 当前位置指示 */}
          <span style={{ color: "var(--text-muted)", minWidth: "40px", textAlign: "center" }}>
            {playlist.currentIndex + 1} / {playlist.files.length}
          </span>

          {/* 下一个 */}
          <button
            onClick={() => {
              if (playlist.currentIndex < playlist.files.length - 1)
                onNavigatePlaylist?.(playlist.files[playlist.currentIndex + 1]);
            }}
            disabled={playlist.currentIndex >= playlist.files.length - 1}
            style={{
              padding: "1px 8px",
              cursor: playlist.currentIndex < playlist.files.length - 1 ? "pointer" : "default",
              opacity: playlist.currentIndex < playlist.files.length - 1 ? 1 : 0.3,
            }}
          >▶</button>
        </div>
      )}

      {/* 字幕浏览器 — 可滚动的字幕列表 */}
      {hasSubtitles && showSubtitleBrowser && (
        <div
          ref={subtitleListRef}
          style={{
            flex: "0 0 auto",
            maxHeight: "38%",      // 不超过面板高度的 38%
            overflowY: "auto",
            borderTop: "1px solid var(--background-modifier-border)",
            backgroundColor: "var(--background-primary)",
          }}
        >
          {/* 列表标题 — sticky 固定在顶部 */}
          <div
            style={{
              padding: "5px 10px",
              fontSize: "10px",
              fontWeight: 600,
              color: "var(--text-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.5px",
              borderBottom: "1px solid var(--background-modifier-border)",
              position: "sticky",
              top: 0,
              backgroundColor: "var(--background-primary)",
              zIndex: 1,
            }}
          >
            Subtitles ({subtitles!.length})
          </div>
          {subtitleItems}
        </div>
      )}
    </div>
  );
};

export default VideoContainer;
