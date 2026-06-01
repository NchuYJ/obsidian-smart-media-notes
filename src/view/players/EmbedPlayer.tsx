import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
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
  onProgress?: (state: { playedSeconds: number }) => void;
}

function getYouTubeVideoId(url: string): string {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (host === "youtu.be") {
      return parsed.pathname.split("/").filter(Boolean)[0] || "";
    }
    if (parsed.pathname.startsWith("/embed/")) {
      return parsed.pathname.split("/").filter(Boolean)[1] || "";
    }
    if (parsed.pathname.startsWith("/shorts/")) {
      return parsed.pathname.split("/").filter(Boolean)[1] || "";
    }
    return parsed.searchParams.get("v") || "";
  } catch {
    return "";
  }
}

function withYouTubeJsApi(embedUrl: string): string {
  try {
    const url = new URL(embedUrl);
    url.searchParams.set("enablejsapi", "1");
    url.searchParams.set("origin", window.location.origin);
    return url.toString();
  } catch {
    return embedUrl;
  }
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
      onProgress,
    },
    ref,
  ) => {
    const youtubeVideoId = getYouTubeVideoId(originalUrl) || getYouTubeVideoId(embedUrl);
    const useYouTubeMessaging = title.toLowerCase() === "youtube" && Boolean(youtubeVideoId);
    const initialFrameUrl = useYouTubeMessaging ? withYouTubeJsApi(embedUrl) : embedUrl;
    const [frameUrl, setFrameUrl] = useState(initialFrameUrl);
    const currentSecondsRef = useRef(start || 0);
    const onReadyRef = useRef(onReady);
    const onProgressRef = useRef(onProgress);
    const iframeRef = useRef<HTMLIFrameElement | null>(null);

    useEffect(() => {
      onReadyRef.current = onReady;
      onProgressRef.current = onProgress;
    }, [onProgress, onReady]);

    const postYouTubeMessage = (message: Record<string, unknown>) => {
      iframeRef.current?.contentWindow?.postMessage(JSON.stringify(message), "*");
    };

    const sendYouTubeCommand = (func: string, args: unknown[] = []) => {
      postYouTubeMessage({ event: "command", func, args });
    };

    const requestYouTubeProgress = () => {
      postYouTubeMessage({ event: "listening", id: "smart-media-notes" });
      sendYouTubeCommand("getCurrentTime");
    };

    useEffect(() => {
      if (!useYouTubeMessaging) return;

      const handleMessage = (event: MessageEvent) => {
        if (!/https:\/\/www\.youtube(?:-nocookie)?\.com$/.test(event.origin)) return;
        let data: { event?: string; info?: { currentTime?: number } } | null = null;
        try {
          data = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
        } catch {
          return;
        }
        const currentTime = data?.info?.currentTime;
        if (typeof currentTime === "number" && Number.isFinite(currentTime)) {
          currentSecondsRef.current = currentTime;
          onProgressRef.current?.({ playedSeconds: currentTime });
        }
      };

      window.addEventListener("message", handleMessage);
      const timer = window.setInterval(requestYouTubeProgress, 500);
      return () => {
        window.removeEventListener("message", handleMessage);
        window.clearInterval(timer);
      };
    }, [useYouTubeMessaging]);

    useImperativeHandle(ref, () => ({
      seekTo(seconds: number) {
        const safeSeconds = Math.max(0, Math.floor(seconds || 0));
        currentSecondsRef.current = safeSeconds;
        if (useYouTubeMessaging) {
          sendYouTubeCommand("seekTo", [safeSeconds, true]);
          onProgressRef.current?.({ playedSeconds: safeSeconds });
          return;
        }
        try {
          const nextUrl = new URL(initialFrameUrl);
          nextUrl.searchParams.set("t", String(safeSeconds));
          nextUrl.searchParams.set("start_progress", String(safeSeconds * 1000));
          nextUrl.searchParams.set("autoplay", "1");
          setFrameUrl(nextUrl.toString());
        } catch {
          setFrameUrl(embedUrl);
        }
      },
      getCurrentTime() {
        if (useYouTubeMessaging) requestYouTubeProgress();
        return currentSecondsRef.current;
      },
      props: {
        playing: false,
      },
    }), [initialFrameUrl, useYouTubeMessaging]);

    const openExternally = () => {
      window.open(originalUrl, "_blank", "noopener,noreferrer");
    };

    return (
      <div className="smn-embed-player" style={{ width, height }}>
        <div className="smn-embed-toolbar">
          <span className="smn-embed-title">{title}</span>
          <span className="smn-embed-clock" title={useYouTubeMessaging ? "Current playback time is available for timestamps" : "Iframe players only expose timestamp jumps"}>
            {useYouTubeMessaging ? "Timestamp capture supported" : "Timestamp jump supported"}
          </span>
          <button className="smn-embed-external" onClick={openExternally}>
            Open externally
          </button>
        </div>
        <iframe
          ref={iframeRef}
          className="smn-embed-frame"
          src={frameUrl}
          title={title}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
          allowFullScreen
          referrerPolicy="no-referrer-when-downgrade"
          onLoad={() => {
            onReady();
            if (useYouTubeMessaging) {
              requestYouTubeProgress();
              if (start) sendYouTubeCommand("seekTo", [Math.max(0, Math.floor(start)), true]);
            }
          }}
        />
      </div>
    );
  },
);

EmbedPlayer.displayName = "EmbedPlayer";

export default EmbedPlayer;
