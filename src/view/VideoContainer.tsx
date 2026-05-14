/**
 * VideoContainer.tsx — React 媒体播放器组件
 *
 * 支持视频和音频两种模式：
 *   - 视频：播放器撑满可用高度，字幕叠加层浮于底部
 *   - 音频：播放器自适应内容高度（compact 控制栏），剩余空间留给字幕/播放列表
 *
 * 音频检测：通过 URL 扩展名判断（.mp3/.m4a/.ogg 等）
 */

import React, { useRef, useState, useEffect } from "react";
import ReactPlayer from "react-player";
import { SubtitleCue, findCueAtTime, formatSecondsAsTimestamp, isAudioFile } from "../utils";

// ---- 类型 ----

export interface PlaylistInfo {
  files: any[];
  currentIndex: number;
}

interface VideoContainerProps {
  url: string;
  setupPlayer: (player: any, setPlaying: (p: boolean) => void) => void;
  start?: number;
  setupError: (err: string) => void;
  subtitles?: SubtitleCue[];
  onSubtitleChange: (cue: SubtitleCue | null) => void;
  showSubtitleOverlay?: boolean;
  showSubtitleBrowser?: boolean;
  subtitleOverlayFontSize?: string; // small / medium / large / xlarge
  playlist?: PlaylistInfo | null;
  onNavigatePlaylist?: (file: any) => void;
  // 由外部指定是否为音频（本地文件的 blob URL 无法通过扩展名检测）
  isAudio?: boolean;
  // 听写模式
  dictationMode?: boolean;
  dictationLoopCount?: number;  // 0=无限
  dictationLoopGap?: number;    // 间隔秒数
}

// ---- 组件 ----

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
  isAudio: isAudioProp,
  subtitleOverlayFontSize = "large",
  dictationMode = false,
  dictationLoopCount = 0,
  dictationLoopGap = 0.5,
}) => {
  const playerRef = useRef<any>();
  const subtitleListRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [activeSubtitle, setActiveSubtitle] = useState<SubtitleCue | null>(null);

  // 听写循环状态
  const loopCountRef = useRef(0);
  const loopPauseRef = useRef(false);

  // 当字幕变化时重置循环计数
  useEffect(() => {
    loopCountRef.current = 0;
    loopPauseRef.current = false;
  }, [activeSubtitle?.start]);

  // 音频模式：优先用外部传入的 isAudio（本地文件 blob URL 无法通过扩展名检测）
  const audio = isAudioProp ?? isAudioFile(url);

  // 根据设置计算字体大小
  const sizeMap: Record<string, { text: string; ts: string }> = {
    small: { text: "13px", ts: "10px" },
    medium: { text: "15px", ts: "12px" },
    large: { text: "18px", ts: "14px" },
    xlarge: { text: "22px", ts: "16px" },
  };
  const fs = sizeMap[subtitleOverlayFontSize] || sizeMap.large;

  // ---- 副作用 ----

  useEffect(() => {
    setPlaying(false);
    const timer = setTimeout(() => setPlaying(true), 400);
    return () => clearTimeout(timer);
  }, [url]);

  useEffect(() => {
    if (activeSubtitle && subtitleListRef.current) {
      const el = subtitleListRef.current.querySelector('[data-active="true"]');
      if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [activeSubtitle]);

  // ---- 事件处理 ----

  const onReady = () => {
    if (start) playerRef.current.seekTo(start);
    if (playerRef) setupPlayer(playerRef.current, setPlaying);
  };

  const handleProgress = (state: { playedSeconds: number }) => {
    const currentTime = state.playedSeconds || 0;
    const nextSubtitle = findCueAtTime(subtitles || [], currentTime);
    if (nextSubtitle?.start !== activeSubtitle?.start) {
      setActiveSubtitle(nextSubtitle);
      onSubtitleChange(nextSubtitle);
    }
    // 听写模式：循环当前字幕片段（支持次数限制+间隔）
    if (dictationMode && activeSubtitle && playerRef.current) {
      const endTime = activeSubtitle.end;
      const startTime = activeSubtitle.start;
      if (currentTime >= endTime && !loopPauseRef.current) {
        const maxCount = dictationLoopCount || 0;
        loopCountRef.current++;
        if (maxCount > 0 && loopCountRef.current >= maxCount) {
          // 达到最大循环次数 → 跳到下一句
          const idx = (subtitles || []).findIndex((c) => c.start === activeSubtitle.start);
          if (idx >= 0 && idx < (subtitles || []).length - 1) {
            playerRef.current.seekTo(subtitles![idx + 1].start);
          }
          loopCountRef.current = 0;
        } else {
          // 插入间隔暂停
          loopPauseRef.current = true;
          setTimeout(() => {
            if (playerRef.current) {
              playerRef.current.seekTo(startTime);
            }
            loopPauseRef.current = false;
          }, (dictationLoopGap || 0.5) * 1000);
        }
      }
    }
  };

  const handleSubtitleClick = (cue: SubtitleCue) => {
    if (playerRef.current) playerRef.current.seekTo(cue.start);
  };

  const hasSubtitles = subtitles && subtitles.length > 0;

  // ---- 渲染 ----

  // 播放器的尺寸策略：
  //   视频：width/height 100%，flex:1 撑满
  //   音频：width 100%，height 固定 54px（react-player 音频控制栏高度）
  const playerStyle: React.CSSProperties = audio
    ? { width: "100%", height: "54px" }
    : { width: "100%", height: "100%" };

  // 播放器容器：视频撑满，音频只占内容高度
  const playerWrapperStyle: React.CSSProperties = audio
    ? { position: "relative", flex: "0 0 auto" }
    : { position: "relative", flex: "1 1 auto", minHeight: 0 };

  // 字幕：音频模式下自动占剩余空间
  const subtitleStyle: React.CSSProperties = audio
    ? {
        flex: "1 1 auto",
        overflowY: "auto",
        borderTop: "1px solid var(--background-modifier-border)",
        backgroundColor: "var(--background-primary)",
      }
    : {
        flex: "0 0 auto",
        maxHeight: "38%",
        overflowY: "auto",
        borderTop: "1px solid var(--background-modifier-border)",
        backgroundColor: "var(--background-primary)",
      };

  const subtitleItems = hasSubtitles
    ? subtitles!.map((cue, idx) => {
        const isActive = activeSubtitle && activeSubtitle.start === cue.start;
        return (
          <div
            key={idx}
            data-active={isActive ? "true" : "false"}
            onClick={() => handleSubtitleClick(cue)}
            style={{
              padding: "5px 10px",
              cursor: "pointer",
              borderBottom: "1px solid var(--background-modifier-border)",
              backgroundColor: isActive ? "var(--interactive-accent)" : "transparent",
              color: isActive ? "var(--text-on-accent)" : "var(--text-normal)",
              fontSize: "12px",
              lineHeight: "1.4",
              transition: "background-color 0.15s",
            }}
            onMouseEnter={(e) => {
              if (!isActive) e.currentTarget.style.backgroundColor = "var(--background-modifier-hover)";
            }}
            onMouseLeave={(e) => {
              if (!isActive) e.currentTarget.style.backgroundColor = "transparent";
            }}
          >
            <span
              style={{
                fontWeight: 600,
                marginRight: "8px",
                opacity: isActive ? 1 : 0.65,
                fontSize: "10px",
                fontFamily: "var(--font-monospace)",
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
    <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%" }}>
      {/* 播放器容器 */}
      <div style={playerWrapperStyle}>
        <ReactPlayer
          key={url}
          ref={playerRef}
          url={url}
          playing={playing}
          controls={true}
          width={playerStyle.width}
          height={playerStyle.height}
          onReady={onReady}
          onProgress={handleProgress}
          progressInterval={200}
          onError={(err: any) =>
            setupError(
              err?.message ||
                "Video is unplayable due to privacy settings, streaming permissions, etc.",
            )
          }
        />
      </div>

      {/* 当前字幕 banner — 始终占位，避免出现/消失时布局抖动 */}
      <div
        style={{
          flex: "0 0 auto",
          minHeight: "4.5em",
          maxHeight: "4.5em",
          overflow: "hidden",
          display: "flex",
          alignItems: "flex-start",
          gap: 0,
          padding: activeSubtitle && showSubtitleOverlay && !dictationMode ? "14px 16px" : 0,
          borderTop: activeSubtitle && showSubtitleOverlay && !dictationMode
            ? "1px solid var(--background-modifier-border)" : "none",
          borderBottom: activeSubtitle && showSubtitleOverlay && !dictationMode
            ? "1px solid var(--background-modifier-border)" : "none",
          background: activeSubtitle && showSubtitleOverlay && !dictationMode
            ? "linear-gradient(135deg, var(--background-primary) 0%, var(--background-secondary) 100%)"
            : dictationMode
              ? "var(--background-modifier-error)"
              : "transparent",
          color: "var(--text-normal)",
          fontSize: fs.text,
          lineHeight: "1.6",
          fontWeight: 500,
          transition: "padding 0.15s, border 0.15s, background 0.15s",
        }}
      >
        {dictationMode ? (
          <span style={{ fontSize: fs.ts, fontWeight: 700, color: "var(--text-error)",
            textTransform: "uppercase", letterSpacing: "0.5px" }}>
            Dictation Mode — Listen and type in your note. Use "Reveal answer" to compare.
          </span>
        ) : activeSubtitle && showSubtitleOverlay ? (
          <>
            <span style={{ fontWeight: 700, marginRight: "12px", fontSize: fs.ts,
              color: "var(--text-accent)", fontFamily: "var(--font-monospace)",
              background: "var(--background-modifier-hover)", padding: "2px 8px", borderRadius: "4px",
              flexShrink: 0, alignSelf: "flex-start" }}>
              {formatSecondsAsTimestamp(activeSubtitle.start)}
            </span>
            <span style={{
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}>
              {activeSubtitle.text}
            </span>
          </>
        ) : null}
      </div>

      {/* 播放列表导航 */}
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
              border: "1px solid var(--background-modifier-border)",
              borderRadius: "4px",
              background: "var(--background-primary)",
              color: "var(--text-normal)",
              fontSize: "13px",
            }}
          >
            ◀
          </button>
          <span style={{ color: "var(--text-muted)", minWidth: "40px", textAlign: "center" }}>
            {playlist.currentIndex + 1} / {playlist.files.length}
          </span>
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
              border: "1px solid var(--background-modifier-border)",
              borderRadius: "4px",
              background: "var(--background-primary)",
              color: "var(--text-normal)",
              fontSize: "13px",
            }}
          >
            ▶
          </button>
        </div>
      )}

      {/* 字幕浏览器 */}
      {hasSubtitles && showSubtitleBrowser && !dictationMode && (
        <div ref={subtitleListRef} style={subtitleStyle}>
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
