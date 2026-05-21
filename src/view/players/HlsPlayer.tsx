import Hls from "hls.js";
import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";

export interface HlsPlayerHandle {
  seekTo(seconds: number): void;
  getCurrentTime(): number;
  props: {
    playing: boolean;
  };
}

interface HlsPlayerProps {
  url: string;
  playing: boolean;
  width: string | number;
  height: string | number;
  start?: number;
  progressInterval?: number;
  onReady: () => void;
  onProgress: (state: { playedSeconds: number }) => void;
  onError: (message: string) => void;
}

const HLS_ERROR =
  "This HLS stream cannot be played in this Obsidian environment. Try opening it externally or check whether the m3u8 URL allows cross-origin playback.";

function shouldIgnorePlayError(error: unknown): boolean {
  if (!(error instanceof DOMException)) return false;
  return error.name === "NotAllowedError" || error.name === "AbortError";
}

const HlsPlayer = forwardRef<HlsPlayerHandle, HlsPlayerProps>(
  (
    {
      url,
      playing,
      width,
      height,
      start,
      progressInterval = 200,
      onReady,
      onProgress,
      onError,
    },
    ref,
  ) => {
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const hlsRef = useRef<Hls | null>(null);
    const readyRef = useRef(false);
    const onReadyRef = useRef(onReady);
    const onProgressRef = useRef(onProgress);
    const onErrorRef = useRef(onError);

    useEffect(() => {
      onReadyRef.current = onReady;
      onProgressRef.current = onProgress;
      onErrorRef.current = onError;
    });

    useImperativeHandle(ref, () => ({
      seekTo(seconds: number) {
        if (videoRef.current) videoRef.current.currentTime = seconds;
      },
      getCurrentTime() {
        return videoRef.current?.currentTime ?? 0;
      },
      props: {
        playing,
      },
    }));

    useEffect(() => {
      const video = videoRef.current;
      if (!video) return;

      readyRef.current = false;
      const markReady = () => {
        if (readyRef.current) return;
        readyRef.current = true;
        if (start) video.currentTime = start;
        onReadyRef.current();
      };

      const reportError = () => {
        if (video.readyState === 0) onErrorRef.current(HLS_ERROR);
      };
      video.addEventListener("loadedmetadata", markReady);
      video.addEventListener("canplay", markReady);
      video.addEventListener("error", reportError);

      if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = url;
      } else if (Hls.isSupported()) {
        const hls = new Hls();
        hlsRef.current = hls;
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (!data.fatal) return;
          window.setTimeout(() => {
            if (video.readyState === 0) onErrorRef.current(HLS_ERROR);
          }, 800);
        });
        hls.loadSource(url);
        hls.attachMedia(video);
      } else {
        onErrorRef.current(HLS_ERROR);
      }

      return () => {
        video.pause();
        video.removeEventListener("loadedmetadata", markReady);
        video.removeEventListener("canplay", markReady);
        video.removeEventListener("error", reportError);
        video.removeAttribute("src");
        video.load();
        hlsRef.current?.destroy();
        hlsRef.current = null;
      };
    }, [start, url]);

    useEffect(() => {
      const video = videoRef.current;
      if (!video) return;
      if (playing) {
        void video.play().catch((error: unknown) => {
          if (shouldIgnorePlayError(error)) return;
          onErrorRef.current(HLS_ERROR);
        });
      } else {
        video.pause();
      }
    }, [playing]);

    useEffect(() => {
      const timer = window.setInterval(() => {
        onProgressRef.current({ playedSeconds: videoRef.current?.currentTime ?? 0 });
      }, progressInterval);
      return () => window.clearInterval(timer);
    }, [progressInterval]);

    return (
      <video
        ref={videoRef}
        controls
        playsInline
        style={{
          width,
          height,
          display: "block",
          backgroundColor: "black",
        }}
      />
    );
  },
);

HlsPlayer.displayName = "HlsPlayer";

export default HlsPlayer;
