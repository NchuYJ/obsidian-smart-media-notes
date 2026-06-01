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

interface YouTubePlayer {
  getCurrentTime(): number;
  seekTo(seconds: number, allowSeekAhead?: boolean): void;
  destroy(): void;
  playVideo?(): void;
  pauseVideo?(): void;
}

interface YouTubePlayerConstructor {
  new (
    element: HTMLElement,
    options: {
      videoId: string;
      playerVars: Record<string, string | number>;
      events: {
        onReady: () => void;
        onStateChange?: () => void;
      };
    },
  ): YouTubePlayer;
}

declare global {
  interface Window {
    YT?: {
      Player?: YouTubePlayerConstructor;
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

let youtubeApiPromise: Promise<void> | null = null;

function loadYouTubeIframeApi(): Promise<void> {
  if (window.YT?.Player) return Promise.resolve();
  if (youtubeApiPromise) return youtubeApiPromise;

  youtubeApiPromise = new Promise((resolve, reject) => {
    const previousReady = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previousReady?.();
      resolve();
    };

    const existingScript = document.querySelector<HTMLScriptElement>(
      'script[src="https://www.youtube.com/iframe_api"]',
    );
    if (existingScript) {
      existingScript.addEventListener("error", () => reject(new Error("YouTube API failed to load")), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    script.onerror = () => reject(new Error("YouTube API failed to load"));
    document.head.appendChild(script);
  });

  return youtubeApiPromise;
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
    const [frameUrl, setFrameUrl] = useState(embedUrl);
    const [apiFallback, setApiFallback] = useState(false);
    const currentSecondsRef = useRef(start || 0);
    const onReadyRef = useRef(onReady);
    const onProgressRef = useRef(onProgress);
    const youtubeContainerRef = useRef<HTMLDivElement | null>(null);
    const youtubePlayerRef = useRef<YouTubePlayer | null>(null);
    const youtubeVideoId = getYouTubeVideoId(originalUrl) || getYouTubeVideoId(embedUrl);
    const useYouTubeApi = title.toLowerCase() === "youtube" && Boolean(youtubeVideoId) && !apiFallback;

    useEffect(() => {
      onReadyRef.current = onReady;
      onProgressRef.current = onProgress;
    }, [onProgress, onReady]);

    useEffect(() => {
      if (!useYouTubeApi || !youtubeContainerRef.current) return;

      let cancelled = false;
      let progressTimer: number | null = null;

      loadYouTubeIframeApi()
        .then(() => {
          if (cancelled || !youtubeContainerRef.current || !window.YT?.Player) return;
          youtubePlayerRef.current?.destroy();
          youtubePlayerRef.current = new window.YT.Player(youtubeContainerRef.current, {
            videoId: youtubeVideoId,
            playerVars: {
              autoplay: 0,
              modestbranding: 1,
              playsinline: 1,
              rel: 0,
              start: Math.max(0, Math.floor(start || 0)),
            },
            events: {
              onReady: () => {
                onReadyRef.current();
                progressTimer = window.setInterval(() => {
                  const currentTime = youtubePlayerRef.current?.getCurrentTime() || 0;
                  if (Number.isFinite(currentTime)) {
                    currentSecondsRef.current = currentTime;
                    onProgressRef.current?.({ playedSeconds: currentTime });
                  }
                }, 500);
              },
              onStateChange: () => {
                const currentTime = youtubePlayerRef.current?.getCurrentTime() || 0;
                if (Number.isFinite(currentTime)) {
                  currentSecondsRef.current = currentTime;
                  onProgressRef.current?.({ playedSeconds: currentTime });
                }
              },
            },
          });
        })
        .catch(() => setApiFallback(true));

      return () => {
        cancelled = true;
        if (progressTimer !== null) window.clearInterval(progressTimer);
        youtubePlayerRef.current?.destroy();
        youtubePlayerRef.current = null;
      };
    }, [start, useYouTubeApi, youtubeVideoId]);

    useImperativeHandle(ref, () => ({
      seekTo(seconds: number) {
        const safeSeconds = Math.max(0, Math.floor(seconds || 0));
        currentSecondsRef.current = safeSeconds;
        if (youtubePlayerRef.current) {
          youtubePlayerRef.current.seekTo(safeSeconds, true);
          onProgressRef.current?.({ playedSeconds: safeSeconds });
          return;
        }
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
        const currentTime = youtubePlayerRef.current?.getCurrentTime();
        if (typeof currentTime === "number" && Number.isFinite(currentTime)) {
          currentSecondsRef.current = currentTime;
        }
        return currentSecondsRef.current;
      },
      props: {
        playing: false,
      },
    }), [embedUrl, onProgress]);

    const openExternally = () => {
      window.open(originalUrl, "_blank", "noopener,noreferrer");
    };

    return (
      <div className="smn-embed-player" style={{ width, height }}>
        <div className="smn-embed-toolbar">
          <span className="smn-embed-title">{title}</span>
          <span className="smn-embed-clock" title={useYouTubeApi ? "Current playback time is available for timestamps" : "Iframe players only expose timestamp jumps"}>
            {useYouTubeApi ? "Timestamp capture supported" : "Timestamp jump supported"}
          </span>
          <button className="smn-embed-external" onClick={openExternally}>
            Open externally
          </button>
        </div>
        {useYouTubeApi ? (
          <div className="smn-embed-frame" ref={youtubeContainerRef} />
        ) : (
          <iframe
            className="smn-embed-frame"
            src={frameUrl}
            title={title}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
            allowFullScreen
            referrerPolicy="no-referrer-when-downgrade"
            onLoad={onReady}
          />
        )}
      </div>
    );
  },
);

EmbedPlayer.displayName = "EmbedPlayer";

export default EmbedPlayer;
