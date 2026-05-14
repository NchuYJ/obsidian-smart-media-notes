import React, { useRef, useState, useEffect } from "react";
import ReactPlayer from "react-player";
import { SubtitleCue, findCueAtTime, formatSecondsAsTimestamp } from "../utils";

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
  playlist?: PlaylistInfo | null;
  onNavigatePlaylist?: (file: any) => void;
}

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
  const playerRef = useRef<any>();
  const subtitleListRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    setPlaying(false);
    const timer = setTimeout(() => setPlaying(true), 400);
    return () => clearTimeout(timer);
  }, [url]);

  const [activeSubtitle, setActiveSubtitle] = useState<SubtitleCue | null>(null);

  useEffect(() => {
    if (activeSubtitle && subtitleListRef.current) {
      const el = subtitleListRef.current.querySelector('[data-active="true"]');
      if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [activeSubtitle]);

  const onReady = () => {
    if (start) playerRef.current.seekTo(start);
    if (playerRef) setupPlayer(playerRef.current, setPlaying);
  };

  const handleProgress = (state: { playedSeconds: number }) => {
    const nextSubtitle = findCueAtTime(subtitles || [], state.playedSeconds || 0);
    if (nextSubtitle?.start !== activeSubtitle?.start) {
      setActiveSubtitle(nextSubtitle);
      onSubtitleChange(nextSubtitle);
    }
  };

  const handleSubtitleClick = (cue: SubtitleCue) => {
    if (playerRef.current) playerRef.current.seekTo(cue.start);
  };

  const hasSubtitles = subtitles && subtitles.length > 0;

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
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
      }}
    >
      <div
        style={{
          position: "relative",
          flex: "1 1 auto",
          minHeight: 0,
        }}
      >
        <ReactPlayer
          key={url}
          ref={playerRef}
          url={url}
          playing={playing}
          controls={true}
          width="100%"
          height="100%"
          onReady={onReady}
          onProgress={handleProgress}
          progressInterval={200}
          onError={(err: any) =>
            setupError(
              err
                ? err.message
                : "Video is unplayable due to privacy settings, streaming permissions, etc.",
            )
          }
        />
        {activeSubtitle && showSubtitleOverlay ? (
          <div
            style={{
              position: "absolute",
              left: "16px",
              right: "16px",
              bottom: "18px",
              padding: "10px 14px",
              borderRadius: "12px",
              background: "rgba(0, 0, 0, 0.72)",
              color: "white",
              fontSize: "15px",
              lineHeight: "1.45",
              textAlign: "center",
              pointerEvents: "none",
              backdropFilter: "blur(6px)",
            }}
          >
            {activeSubtitle.text}
          </div>
        ) : null}
      </div>

      {playlist ? (
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
          <span
            style={{
              color: "var(--text-muted)",
              minWidth: "40px",
              textAlign: "center",
            }}
          >
            {playlist.currentIndex + 1} / {playlist.files.length}
          </span>
          <button
            onClick={() => {
              if (playlist.currentIndex < playlist.files.length - 1)
                onNavigatePlaylist?.(
                  playlist.files[playlist.currentIndex + 1],
                );
            }}
            disabled={playlist.currentIndex >= playlist.files.length - 1}
            style={{
              padding: "1px 8px",
              cursor:
                playlist.currentIndex < playlist.files.length - 1
                  ? "pointer"
                  : "default",
              opacity:
                playlist.currentIndex < playlist.files.length - 1 ? 1 : 0.3,
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
      ) : null}

      {hasSubtitles && showSubtitleBrowser ? (
        <div
          ref={subtitleListRef}
          style={{
            flex: "0 0 auto",
            maxHeight: "38%",
            overflowY: "auto",
            borderTop: "1px solid var(--background-modifier-border)",
            backgroundColor: "var(--background-primary)",
          }}
        >
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
      ) : null}
    </div>
  );
};

export default VideoContainer;
