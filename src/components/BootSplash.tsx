import { useEffect, useRef, useState } from "react";
import { TerminalSquare } from "lucide-react";

export interface BootSplashProps {
  version: string;
  onComplete: () => void;
}

const BOOT_STEPS = [
  "SYSTEM TELEMETRY · SYNCING",
  "WORKSPACE & GIT INDEX · ONLINE",
  "LOCAL AI & DISK ENGINE · READY",
  "MISSION CONTROL · ARMED",
];

// 3D wireframe octahedron + outer cube vertices for a crisp, zero-dependency
// WebGL-style architectural geometry projection on Canvas 2D.
const CUBE_VERTS: [number, number, number][] = [
  [-1, -1, -1],
  [1, -1, -1],
  [1, 1, -1],
  [-1, 1, -1],
  [-1, -1, 1],
  [1, -1, 1],
  [1, 1, 1],
  [-1, 1, 1],
];

const CUBE_EDGES: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 0],
  [4, 5], [5, 6], [6, 7], [7, 4],
  [0, 4], [1, 5], [2, 6], [3, 7],
];

const OCTA_VERTS: [number, number, number][] = [
  [0, 1.35, 0],
  [0, -1.35, 0],
  [1.35, 0, 0],
  [-1.35, 0, 0],
  [0, 0, 1.35],
  [0, 0, -1.35],
];

const OCTA_EDGES: [number, number][] = [
  [0, 2], [0, 3], [0, 4], [0, 5],
  [1, 2], [1, 3], [1, 4], [1, 5],
  [2, 4], [4, 3], [3, 5], [5, 2],
];

export function BootSplash({ version, onComplete }: BootSplashProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [exiting, setExiting] = useState(false);
  const [stepIdx, setStepIdx] = useState(0);
  const completedRef = useRef(false);

  const finishNow = () => {
    if (completedRef.current) return;
    completedRef.current = true;
    setExiting(true);
    window.setTimeout(() => {
      onComplete();
    }, 440);
  };

  useEffect(() => {
    const t1 = window.setTimeout(() => setStepIdx(1), 620);
    const t2 = window.setTimeout(() => setStepIdx(2), 1280);
    const t3 = window.setTimeout(() => setStepIdx(3), 1880);
    const tExit = window.setTimeout(() => {
      if (!completedRef.current) {
        completedRef.current = true;
        setExiting(true);
      }
    }, 2400);
    const tDone = window.setTimeout(() => {
      onComplete();
    }, 2860);

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === " " || e.key === "Enter") {
        finishNow();
      }
    };
    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
      window.clearTimeout(tExit);
      window.clearTimeout(tDone);
      window.removeEventListener("keydown", onKeyDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let rafId = 0;
    const start = performance.now();

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(window.innerWidth * dpr);
      canvas.height = Math.floor(window.innerHeight * dpr);
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const project = (
      v: [number, number, number],
      rotX: number,
      rotY: number,
      cx: number,
      cy: number,
      scale: number
    ): [number, number, number] => {
      const [x0, y0, z0] = v;
      // Rotate Y
      const cosY = Math.cos(rotY);
      const sinY = Math.sin(rotY);
      const x1 = x0 * cosY - z0 * sinY;
      const z1 = x0 * sinY + z0 * cosY;
      // Rotate X
      const cosX = Math.cos(rotX);
      const sinX = Math.sin(rotX);
      const y2 = y0 * cosX - z1 * sinX;
      const z2 = y0 * sinX + z1 * cosX;

      const fov = 4.2;
      const factor = fov / (fov + z2 + 2.4);
      return [cx + x1 * scale * factor, cy + y2 * scale * factor, z2];
    };

    const draw = (now: number) => {
      const elapsed = (now - start) / 1000;
      const w = window.innerWidth;
      const h = window.innerHeight;
      const cx = w / 2;
      const cy = h / 2;

      ctx.clearRect(0, 0, w, h);

      // Subtle architectural perspective grid on the lower plane
      const horizonY = cy + 95;
      const gridAlpha = Math.min(1, elapsed * 2.2) * 0.14;
      ctx.strokeStyle = `rgba(56, 189, 248, ${gridAlpha.toFixed(3)})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = -8; i <= 8; i += 1) {
        const topX = cx + i * 38;
        const botX = cx + i * 165;
        ctx.moveTo(topX, horizonY);
        ctx.lineTo(botX, h + 20);
      }
      for (let row = 0; row < 7; row += 1) {
        const t = ((row / 7 + elapsed * 0.25) % 1);
        const y = horizonY + t * t * (h - horizonY + 20);
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
      }
      ctx.stroke();

      // Exponential ease-out entrance scale for the 3D wireframe
      const enterProgress = Math.min(1, elapsed / 1.15);
      const eased = 1 - Math.pow(1 - enterProgress, 4);
      const baseScale = Math.min(w, h) * 0.175 * (0.65 + 0.35 * eased);
      const rotY = elapsed * 0.9 + 0.55;
      const rotX = 0.42 + Math.sin(elapsed * 0.75) * 0.16;

      // Outer wireframe cube (subtle steel-cyan)
      const projCube = CUBE_VERTS.map((v) =>
        project(v, rotX, rotY, cx, cy - 26, baseScale)
      );
      ctx.strokeStyle = `rgba(56, 189, 248, ${(0.24 * eased).toFixed(3)})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const [a, b] of CUBE_EDGES) {
        ctx.moveTo(projCube[a][0], projCube[a][1]);
        ctx.lineTo(projCube[b][0], projCube[b][1]);
      }
      ctx.stroke();

      // Inner counter-rotating octahedron (crisp emerald-cyan highlight)
      const projOcta = OCTA_VERTS.map((v) =>
        project(v, -rotX * 0.85, -rotY * 1.35, cx, cy - 26, baseScale * 0.52)
      );
      ctx.strokeStyle = `rgba(16, 185, 129, ${(0.55 * eased).toFixed(3)})`;
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      for (const [a, b] of OCTA_EDGES) {
        ctx.moveTo(projOcta[a][0], projOcta[a][1]);
        ctx.lineTo(projOcta[b][0], projOcta[b][1]);
      }
      ctx.stroke();

      // Vertex telemetry nodes
      ctx.fillStyle = `rgba(224, 242, 254, ${(0.8 * eased).toFixed(3)})`;
      for (const [px, py] of projOcta) {
        ctx.fillRect(px - 1.5, py - 1.5, 3, 3);
      }

      // Horizontal precision sweep line
      const sweepY = ((elapsed * 1.15) % 1) * h;
      const grad = ctx.createLinearGradient(0, sweepY - 24, 0, sweepY + 24);
      grad.addColorStop(0, "rgba(56, 189, 248, 0)");
      grad.addColorStop(0.5, "rgba(56, 189, 248, 0.08)");
      grad.addColorStop(1, "rgba(56, 189, 248, 0)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, sweepY - 24, w, 48);

      rafId = window.requestAnimationFrame(draw);
    };

    rafId = window.requestAnimationFrame(draw);
    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <div
      className={`boot-splash${exiting ? " boot-splash--exit" : ""}`}
      role="presentation"
      onClick={finishNow}
      title="Geçmek için tıklayın"
    >
      <canvas ref={canvasRef} className="boot-splash__canvas" aria-hidden="true" />
      <div className="boot-splash__hairline" aria-hidden="true" />
      <div className="boot-splash__core">
        <div className="boot-splash__mark">
          <TerminalSquare size={22} />
        </div>
        <div className="boot-splash__title-row">
          <span className="boot-splash__wordmark">AFFEXDESK</span>
          <span className="boot-splash__version mono">v{version}</span>
        </div>
        <div className="boot-splash__bar">
          <span className="boot-splash__bar-fill" />
        </div>
        <div className="boot-splash__status mono">
          <span className="status-dot status-dot--live" />
          <span>{BOOT_STEPS[stepIdx]}</span>
        </div>
      </div>
      <span className="boot-splash__skip mono">ESC / CLICK TO SKIP</span>
    </div>
  );
}
