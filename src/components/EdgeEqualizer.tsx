import { useEffect, useRef } from "react";

export interface EdgeEqualizerProps {
  playing: boolean;
  enabled: boolean;
  liveMicReactive?: boolean;
}

const COLORS = [
  "#38bdf8", // cyan
  "#10b981", // emerald
  "#818cf8", // indigo
  "#fb7185", // rose
  "#f59e0b", // amber
];

export function EdgeEqualizer({
  playing,
  enabled,
  liveMicReactive = false,
}: EdgeEqualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const active = (playing || liveMicReactive) && enabled;

  useEffect(() => {
    if (!active) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let rafId = 0;
    const start = performance.now();
    const width = 12;

    // Optional real Web Audio API FFT spectrum analyzer (when user enables live beat mode)
    let audioCtx: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    let freqData: Uint8Array<ArrayBuffer> | null = null;
    let mediaStream: MediaStream | null = null;
    let disposed = false;

    if (liveMicReactive && navigator.mediaDevices?.getUserMedia) {
      void navigator.mediaDevices
        .getUserMedia({ audio: true, video: false })
        .then((stream) => {
          if (disposed) {
            stream.getTracks().forEach((tr) => tr.stop());
            return;
          }
          mediaStream = stream;
          const AudioCtx =
            window.AudioContext ||
            (window as unknown as { webkitAudioContext?: typeof AudioContext })
              .webkitAudioContext;
          if (!AudioCtx) return;
          audioCtx = new AudioCtx();
          const src = audioCtx.createMediaStreamSource(stream);
          analyser = audioCtx.createAnalyser();
          analyser.fftSize = 128;
          analyser.smoothingTimeConstant = 0.72;
          src.connect(analyser);
          freqData = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
        })
        .catch(() => {
          // Graceful fallback to synthetic wave if mic permission declined
        });
    }

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const h = window.innerHeight || 800;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const draw = (now: number) => {
      const t = (now - start) / 1000;
      const h = window.innerHeight || 800;
      ctx.clearRect(0, 0, width, h);

      const barHeight = 5;
      const gap = 4;
      const step = barHeight + gap;
      const count = Math.max(12, Math.floor(h / step));

      let hasLiveFft = false;
      if (analyser && freqData) {
        analyser.getByteFrequencyData(freqData);
        hasLiveFft = true;
      }

      for (let i = 0; i < count; i += 1) {
        const norm = i / count;
        let level: number;

        if (hasLiveFft && freqData) {
          // Mirror low/mid/high FFT bins cleanly along the edge
          const binIdx = Math.min(
            freqData.length - 1,
            Math.floor(Math.abs(norm - 0.5) * 2 * (freqData.length * 0.75))
          );
          const raw = freqData[binIdx] / 255;
          level = Math.max(0.1, Math.min(1, raw * 1.45));
        } else {
          const beat =
            0.42 +
            0.28 * Math.sin(t * 7.2 + i * 0.45) +
            0.18 * Math.cos(t * 11.4 - i * 0.72) +
            0.14 * Math.sin(t * 16.8 + i * 1.15);
          const envelope = 0.55 + 0.45 * Math.sin(norm * Math.PI);
          level = Math.max(0.12, Math.min(1, beat * envelope));
        }

        const barW = 2 + level * (width - 2);
        const colorIdx = Math.floor((norm * COLORS.length + t * 0.35) % COLORS.length);
        ctx.fillStyle = COLORS[colorIdx];
        ctx.globalAlpha = 0.38 + level * 0.6;
        ctx.fillRect(0, i * step + 2, barW, barHeight);
      }
      ctx.globalAlpha = 1;

      rafId = window.requestAnimationFrame(draw);
    };

    rafId = window.requestAnimationFrame(draw);
    return () => {
      disposed = true;
      window.cancelAnimationFrame(rafId);
      window.removeEventListener("resize", resize);
      mediaStream?.getTracks().forEach((tr) => tr.stop());
      if (audioCtx) void audioCtx.close();
      ctx.clearRect(0, 0, width, window.innerHeight || 800);
    };
  }, [active, liveMicReactive]);

  return (
    <canvas
      ref={canvasRef}
      className={`edge-equalizer${active ? " edge-equalizer--active" : ""}`}
      aria-hidden="true"
    />
  );
}
