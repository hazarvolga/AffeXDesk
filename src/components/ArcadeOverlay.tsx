import { useEffect, useRef, useState } from "react";
import { RotateCcw, Volume2, VolumeX, X } from "lucide-react";

export interface ArcadeOverlayProps {
  onClose: () => void;
}

interface FallingCard {
  id: number;
  title: string;
  tag: string;
  x: number;
  y: number;
  w: number;
  h: number;
  vy: number;
  vx: number;
  hp: number;
  maxHp: number;
  color: string;
  hitFlash: number;
}

interface LaserBolt {
  x: number;
  y: number;
  vy: number;
  color: string;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
}

const HIGH_SCORE_KEY = "affexdesk.arcade.high_score.v1";
const CARD_PALETTE = ["#38bdf8", "#10b981", "#818cf8", "#f59e0b", "#fb7185"];

function harvestActivePageCards(): Array<{ title: string; tag: string }> {
  const selectors = [
    ".project-card",
    ".metric-card",
    ".quick-win-card",
    ".client-card",
    ".cleaner-row",
    ".rule-row",
  ];
  const found: Array<{ title: string; tag: string }> = [];
  const seen = new Set<string>();

  for (const sel of selectors) {
    const nodes = document.querySelectorAll<HTMLElement>(sel);
    for (const el of nodes) {
      const heading =
        el.querySelector("h2, h3, strong, .metric-card__label")?.textContent?.trim() ||
        "";
      const badge = el.querySelector(".badge, .tech-tag")?.textContent?.trim() || "CARD";
      const clean = heading.replace(/\s+/g, " ").slice(0, 22);
      if (clean && !seen.has(clean)) {
        seen.add(clean);
        found.push({ title: clean, tag: badge.slice(0, 10) });
      }
    }
  }

  if (found.length === 0) {
    return [
      { title: "AffeXDesk", tag: "TAURI" },
      { title: "Docker.raw", tag: "CACHE" },
      { title: "node_modules", tag: "DEV" },
      { title: "Rust target/", tag: "BUILD" },
      { title: "CPU Telemetry", tag: "SYS" },
      { title: "Zombie Proc", tag: "PID" },
    ];
  }
  return found;
}

class RetroSynth {
  private ctx: AudioContext | null = null;
  public muted = false;

  private ensure(): AudioContext | null {
    if (this.muted) return null;
    if (!this.ctx && typeof window !== "undefined") {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx?.state === "suspended") {
      void this.ctx.resume();
    }
    return this.ctx;
  }

  laser() {
    const ctx = this.ensure();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.setValueAtTime(760, now);
    osc.frequency.exponentialRampToValueAtTime(190, now + 0.085);
    gain.gain.setValueAtTime(0.06, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.095);
  }

  explode() {
    const ctx = this.ensure();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(180, now);
    osc.frequency.exponentialRampToValueAtTime(38, now + 0.19);
    gain.gain.setValueAtTime(0.11, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.21);
  }

  dispose() {
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
    }
  }
}

export function ArcadeOverlay({ onClose }: ArcadeOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const synthRef = useRef<RetroSynth | null>(null);

  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(() => {
    try {
      return Number(window.localStorage.getItem(HIGH_SCORE_KEY) || "0") || 0;
    } catch {
      return 0;
    }
  });
  const [lives, setLives] = useState(3);
  const [combo, setCombo] = useState(0);
  const [muted, setMuted] = useState(false);
  const [gameOver, setGameOver] = useState(false);
  const [runKey, setRunKey] = useState(0);

  useEffect(() => {
    if (synthRef.current) {
      synthRef.current.muted = muted;
    }
  }, [muted]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const synth = new RetroSynth();
    synth.muted = muted;
    synthRef.current = synth;

    const cardPool = harvestActivePageCards();
    let width = window.innerWidth || 1280;
    let height = window.innerHeight || 800;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth || 1280;
      height = window.innerHeight || 800;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    let turretX = width / 2;
    let targetMouseX: number | null = null;
    const keys = { left: false, right: false, fire: false };
    let mouseDown = false;
    let fireCooldown = 0;
    let spawnTimer = 0.2;
    let nextCardId = 1;
    let recoilLeft = 0;
    let recoilRight = 0;
    let shake = 0;
    let curScore = 0;
    let curLives = 3;
    let curCombo = 0;
    let ended = false;
    let elapsedTotal = 0;

    const cards: FallingCard[] = [];
    const bolts: LaserBolt[] = [];
    const particles: Particle[] = [];

    const spawnCard = () => {
      const pick = cardPool[Math.floor(Math.random() * cardPool.length)];
      const w = Math.max(126, Math.min(186, pick.title.length * 8.2 + 46));
      const h = 44;
      const margin = 44;
      const x = margin + Math.random() * Math.max(40, width - w - margin * 2);
      const speedBoost = 1 + Math.min(1.4, elapsedTotal / 45);
      const isHeavy = Math.random() < 0.25;
      cards.push({
        id: nextCardId++,
        title: pick.title,
        tag: pick.tag,
        x,
        y: -h - 10,
        w,
        h,
        vy: (68 + Math.random() * 64) * speedBoost,
        vx: (Math.random() - 0.5) * 24,
        hp: isHeavy ? 2 : 1,
        maxHp: isHeavy ? 2 : 1,
        color: CARD_PALETTE[Math.floor(Math.random() * CARD_PALETTE.length)],
        hitFlash: 0,
      });
    };

    const spawnExplosion = (cx: number, cy: number, color: string, count = 22) => {
      for (let i = 0; i < count; i += 1) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 70 + Math.random() * 240;
        particles.push({
          x: cx,
          y: cy,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: 0,
          maxLife: 0.35 + Math.random() * 0.35,
          size: 2 + Math.random() * 3.5,
          color: i % 3 === 0 ? "#e0f2fe" : color,
        });
      }
    };

    const fireTwinCannons = () => {
      const barrelOffset = 28;
      const baseY = height - 66;
      bolts.push(
        { x: turretX - barrelOffset, y: baseY, vy: -760, color: "#38bdf8" },
        { x: turretX + barrelOffset, y: baseY, vy: -760, color: "#10b981" }
      );
      recoilLeft = 7;
      recoilRight = 7;
      synth.laser();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") keys.left = true;
      if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") keys.right = true;
      if (e.key === " ") {
        e.preventDefault();
        keys.fire = true;
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") keys.left = false;
      if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") keys.right = false;
      if (e.key === " ") keys.fire = false;
    };
    const onMouseMove = (e: MouseEvent) => {
      targetMouseX = e.clientX;
    };
    const onMouseDown = (e: MouseEvent) => {
      if (e.button === 0 && (e.target as HTMLElement)?.tagName === "CANVAS") {
        mouseDown = true;
      }
    };
    const onMouseUp = () => {
      mouseDown = false;
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mouseup", onMouseUp);

    // Kick off with 3 immediate cards raining from top
    spawnCard();
    spawnCard();

    let rafId = 0;
    let lastTime = performance.now();

    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - lastTime) / 1000);
      lastTime = now;
      elapsedTotal += dt;

      if (!ended) {
        // Turret movement
        const moveSpeed = 540;
        if (keys.left) {
          turretX -= moveSpeed * dt;
          targetMouseX = null;
        }
        if (keys.right) {
          turretX += moveSpeed * dt;
          targetMouseX = null;
        }
        if (targetMouseX !== null) {
          turretX += (targetMouseX - turretX) * Math.min(1, dt * 16);
        }
        turretX = Math.max(54, Math.min(width - 54, turretX));

        // Firing
        fireCooldown = Math.max(0, fireCooldown - dt);
        if ((keys.fire || mouseDown) && fireCooldown <= 0) {
          fireTwinCannons();
          fireCooldown = 0.16;
        }

        // Spawning falling cards
        spawnTimer -= dt;
        const spawnInterval = Math.max(0.45, 1.15 - elapsedTotal * 0.012);
        if (spawnTimer <= 0 && cards.length < 12) {
          spawnCard();
          spawnTimer = spawnInterval;
        }

        // Update bolts
        for (let i = bolts.length - 1; i >= 0; i -= 1) {
          const b = bolts[i];
          b.y += b.vy * dt;
          if (b.y < -20) {
            bolts.splice(i, 1);
            continue;
          }
          // Hit test against cards
          let hit = false;
          for (let j = cards.length - 1; j >= 0; j -= 1) {
            const c = cards[j];
            if (b.x >= c.x && b.x <= c.x + c.w && b.y >= c.y && b.y <= c.y + c.h) {
              c.hp -= 1;
              c.hitFlash = 0.14;
              hit = true;
              if (c.hp <= 0) {
                spawnExplosion(c.x + c.w / 2, c.y + c.h / 2, c.color, 24);
                synth.explode();
                shake = 6;
                curCombo += 1;
                curScore += 100 + Math.min(200, curCombo * 15);
                setScore(curScore);
                setCombo(curCombo);
                if (curScore > highScore) {
                  setHighScore(curScore);
                  try {
                    window.localStorage.setItem(HIGH_SCORE_KEY, String(curScore));
                  } catch {
                    // ignore
                  }
                }
                cards.splice(j, 1);
              } else {
                spawnExplosion(b.x, b.y, "#e0f2fe", 8);
              }
              break;
            }
          }
          if (hit) bolts.splice(i, 1);
        }

        // Update cards
        for (let i = cards.length - 1; i >= 0; i -= 1) {
          const c = cards[i];
          c.y += c.vy * dt;
          c.x += c.vx * dt;
          if (c.x < 16 || c.x + c.w > width - 16) c.vx *= -1;
          c.hitFlash = Math.max(0, c.hitFlash - dt);

          if (c.y + c.h >= height - 44) {
            spawnExplosion(c.x + c.w / 2, height - 44, "#fb7185", 18);
            synth.explode();
            shake = 9;
            cards.splice(i, 1);
            curCombo = 0;
            curLives -= 1;
            setCombo(0);
            setLives(curLives);
            if (curLives <= 0) {
              ended = true;
              setGameOver(true);
            }
          }
        }
      }

      // Particles & recoil decay
      recoilLeft = Math.max(0, recoilLeft - dt * 42);
      recoilRight = Math.max(0, recoilRight - dt * 42);
      shake = Math.max(0, shake - dt * 36);

      for (let i = particles.length - 1; i >= 0; i -= 1) {
        const p = particles[i];
        p.life += dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += 240 * dt;
        if (p.life >= p.maxLife) particles.splice(i, 1);
      }

      // === RENDER ===
      ctx.save();
      if (shake > 0.2) {
        ctx.translate(
          (Math.random() - 0.5) * shake,
          (Math.random() - 0.5) * shake
        );
      }

      ctx.fillStyle = "rgba(7, 8, 12, 0.88)";
      ctx.fillRect(0, 0, width, height);

      // Subtle retro grid lines
      ctx.strokeStyle = "rgba(56, 189, 248, 0.05)";
      ctx.lineWidth = 1;
      for (let gx = 0; gx < width; gx += 48) {
        ctx.beginPath();
        ctx.moveTo(gx, 0);
        ctx.lineTo(gx, height);
        ctx.stroke();
      }
      for (let gy = 0; gy < height; gy += 48) {
        ctx.beginPath();
        ctx.moveTo(0, gy);
        ctx.lineTo(width, gy);
        ctx.stroke();
      }

      // Danger defense line
      ctx.strokeStyle = "rgba(251, 113, 133, 0.35)";
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      ctx.moveTo(0, height - 48);
      ctx.lineTo(width, height - 48);
      ctx.stroke();
      ctx.setLineDash([]);

      // Draw falling cards
      for (const c of cards) {
        ctx.fillStyle = c.hitFlash > 0 ? "rgba(224, 242, 254, 0.28)" : "#111116";
        ctx.strokeStyle = c.hitFlash > 0 ? "#ffffff" : c.color;
        ctx.lineWidth = c.maxHp > 1 ? 1.8 : 1.2;
        ctx.fillRect(c.x, c.y, c.w, c.h);
        ctx.strokeRect(c.x, c.y, c.w, c.h);

        // Top accent bar
        ctx.fillStyle = c.color;
        ctx.fillRect(c.x, c.y, c.w * (c.hp / c.maxHp), 3);

        ctx.font = '600 11.5px ui-monospace, "SF Mono", monospace';
        ctx.fillStyle = "#f4f4f5";
        ctx.textAlign = "left";
        ctx.fillText(c.title, c.x + 10, c.y + 21);

        ctx.font = '500 9.5px ui-monospace, "SF Mono", monospace';
        ctx.fillStyle = c.color;
        ctx.fillText(c.tag, c.x + 10, c.y + 35);
      }

      // Draw laser bolts
      for (const b of bolts) {
        ctx.fillStyle = b.color;
        ctx.fillRect(b.x - 2, b.y - 14, 4, 16);
        ctx.fillStyle = "#e0f2fe";
        ctx.fillRect(b.x - 1, b.y - 14, 2, 10);
      }

      // Draw twin space cannons at the bottom
      const baseY = height - 22;
      // Chassis
      ctx.fillStyle = "#18181b";
      ctx.strokeStyle = "#38bdf8";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(turretX - 42, baseY + 14);
      ctx.lineTo(turretX - 32, baseY - 12);
      ctx.lineTo(turretX + 32, baseY - 12);
      ctx.lineTo(turretX + 42, baseY + 14);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Left & Right Plasma Barrels
      ctx.fillStyle = "#38bdf8";
      ctx.fillRect(turretX - 31, baseY - 40 + recoilLeft, 6, 30);
      ctx.fillStyle = "#10b981";
      ctx.fillRect(turretX + 25, baseY - 40 + recoilRight, 6, 30);

      // Center core glow
      ctx.fillStyle = "#e0f2fe";
      ctx.fillRect(turretX - 8, baseY - 6, 16, 4);

      // Draw explosion particles
      for (const p of particles) {
        const alpha = Math.max(0, 1 - p.life / p.maxLife);
        ctx.globalAlpha = alpha;
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      }
      ctx.globalAlpha = 1;
      ctx.restore();

      rafId = window.requestAnimationFrame(loop);
    };

    rafId = window.requestAnimationFrame(loop);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener("resize", resize);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mouseup", onMouseUp);
      synth.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runKey]);

  const handleRestart = () => {
    setScore(0);
    setLives(3);
    setCombo(0);
    setGameOver(false);
    setRunKey((k) => k + 1);
  };

  return (
    <div className="arcade-overlay" role="dialog" aria-label="AffeXDesk Card Invaders">
      <canvas ref={canvasRef} className="arcade-overlay__canvas" />

      <div className="arcade-hud mono">
        <div className="arcade-hud__left">
          <span className="badge badge--info">CARD INVADERS</span>
          <span className="tabular">
            SKOR: <strong className="text-cyan">{score}</strong>
          </span>
          <span className="tabular muted">
            REKOR: <strong>{highScore}</strong>
          </span>
          {combo >= 2 && (
            <span className="badge badge--success tabular">x{combo} COMBO</span>
          )}
          <span className="tabular">
            CAN:{" "}
            <strong className="text-danger">
              {"♥".repeat(Math.max(0, lives))}
            </strong>
          </span>
        </div>

        <div className="arcade-hud__right">
          <span className="muted" style={{ fontSize: 11 }}>
            Fare / ←→ Hareket · Tık / Space Ateş
          </span>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => setMuted((m) => !m)}
            title={muted ? "Sesi aç" : "Sesi kapat"}
          >
            {muted ? <VolumeX size={13} /> : <Volume2 size={13} />}
          </button>
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            onClick={onClose}
          >
            <X size={13} />
            <span>Çık (ESC)</span>
          </button>
        </div>
      </div>

      {gameOver && (
        <div className="arcade-gameover mono">
          <h2>OYUN BİTTİ</h2>
          <p>
            Skor: <strong className="text-cyan">{score}</strong> · Rekor:{" "}
            <strong className="text-emerald">{highScore}</strong>
          </p>
          <div className="arcade-gameover__actions">
            <button
              type="button"
              className="btn btn--primary"
              onClick={handleRestart}
            >
              <RotateCcw size={14} />
              <span>Tekrar Oyna</span>
            </button>
            <button
              type="button"
              className="btn btn--secondary"
              onClick={onClose}
            >
              <span>Çalışmaya Dön</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
