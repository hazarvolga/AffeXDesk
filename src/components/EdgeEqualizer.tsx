import { useEffect, useRef } from "react";

export interface EdgeEqualizerProps {
  playing: boolean;
  enabled: boolean;
}

const COLORS = [
  "#38bdf8", // cyan
  "#10b981", // emerald
  "#818cf8", // indigo
  "#fb7185", // rose
  "#f59e0b", // amber
];

export function EdgeEqualizer({ playing, enabled }: EdgeEqualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const active = playing && enabled;

  useEffect(() => {
    if (!active) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let rafId = 0;
    const start = performance.now();
    const width = 10;

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

      for (let i = 0; i < count; i += 1) {
        const norm = i / count;
        // Multi-frequency organic audio spectrum wave
        const beat =
          0.42 +
          0.28 * Math.sin(t * 7.2 + i * 0.45) +
          0.18 * Math.cos(t * 11.4 - i * 0.72) +
          0.14 * Math.sin(t * 16.8 + i * 1.15);
        const envelope = 0.55 + 0.45 * Math.sin(norm * Math.PI);
        const level = Math.max(0.12, Math.min(1, beat * envelope));

        const barW = 2 + level * (width - 2);
        const colorIdx = Math.floor((norm * COLORS.length + t * 0.35) % COLORS.length);
        ctx.fillStyle = COLORS[colorIdx];
        ctx.globalAlpha = 0.35 + level * 0.6;
        ctx.fillRect(0, i * step + 2, barW, barHeight);
      }
      ctx.globalAlpha = 1;

      rafId = window.requestAnimationFrame(draw);
    };

    rafId = window.requestAnimationFrame(draw);
    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener("resize", resize);
      ctx.clearRect(0, 0, width, window.innerHeight || 800);
    };
  }, [active]);

  return (
    <canvas
      ref={canvasRef}
      className={`edge-equalizer${active ? " edge-equalizer--active" : ""}`}
      aria-hidden="true"
    />
  );
}
