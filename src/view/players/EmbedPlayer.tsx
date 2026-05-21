import React, {
  forwardRef,
  useImperativeHandle,
  useState,
} from "react";

export interface EmbedPlayerHandle {
  seekTo(seconds: number): void;
  getCurrentTime(): number;
  props: {
    playing: boolean;
  };
}

interface EmbedPlayerProps {
  embedUrl: string;
  originalUrl: string;
  title: string;
  width: string | number;
  height: string | number;
  playing: boolean;
  start?: number;
  onReady: () => void;
}

const EmbedPlayer = forwardRef<EmbedPlayerHandle, EmbedPlayerProps>(
  (
    {
      embedUrl,
      originalUrl,
      title,
      width,
      height,
      start = 0,
      onReady,
    },
    ref,
  ) => {
    const [frameUrl, setFrameUrl] = useState(embedUrl);
    const [currentSeconds, setCurrentSeconds] = useState(start || 0);

    useImperativeHandle(ref, () => ({
      seekTo(seconds: number) {
        const safeSeconds = Math.max(0, Math.floor(seconds || 0));
        setCurrentSeconds(safeSeconds);
        try {
          const nextUrl = new URL(embedUrl);
          nextUrl.searchParams.set("t", String(safeSeconds));
          nextUrl.searchParams.set("start_progress", String(safeSeconds * 1000));
          nextUrl.searchParams.set("autoplay", "1");
          setFrameUrl(nextUrl.toString());
        } catch {
          setFrameUrl(embedUrl);
        }
      },
      getCurrentTime() {
        return currentSeconds;
      },
      props: {
        playing: false,
      },
    }), [currentSeconds, embedUrl]);

    const openExternally = () => {
      window.open(originalUrl, "_blank", "noopener,noreferrer");
    };

    return (
      <div className="smn-embed-player" style={{ width, height }}>
        <div className="smn-embed-toolbar">
          <span className="smn-embed-title">{title}</span>
          <span className="smn-embed-clock" title="Iframe players do not expose current playback time">
            Timestamp jump supported
          </span>
          <button className="smn-embed-external" onClick={openExternally}>
            Open externally
          </button>
        </div>
        <iframe
          className="smn-embed-frame"
          src={frameUrl}
          title={title}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
          allowFullScreen
          referrerPolicy="no-referrer-when-downgrade"
          onLoad={onReady}
        />
      </div>
    );
  },
);

EmbedPlayer.displayName = "EmbedPlayer";

export default EmbedPlayer;
