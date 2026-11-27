import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import gsap from "gsap";
import { TerminalSquare } from "lucide-react";
import type {
  ClientRecord,
  DevProcessReport,
  ProjectInfo,
  SystemMetrics,
} from "../lib/api";
import { formatBytes, formatPct } from "../lib/format";

export interface BootSplashProps {
  version: string;
  metrics: SystemMetrics | null;
  processes: DevProcessReport | null;
  projects: ProjectInfo[];
  clients: ClientRecord[];
  clientProjectsCount: number;
  onComplete: () => void;
}

const TARGET_TITLE = "AFFEXDESK";
const SCRAMBLE_CHARS = "0123456789ABCDEF/\\-_#";

// Custom GLSL 3D Lidar Tactical Grid + Sweeping Laser Scanner Shader
const LIDAR_VERTEX_SHADER = /* glsl */ `
  uniform float uTime;
  uniform float uScanZ;
  varying vec3 vWorldPos;
  varying vec2 vUv;
  varying float vElev;

  float terrainWave(vec2 p, float t) {
    float h = sin(p.x * 0.42 + t * 0.65) * cos(p.y * 0.36 - t * 0.45) * 0.62;
    h += sin(p.x * 1.15 - p.y * 0.95 + t * 0.9) * 0.22;
    float centerBowl = smoothstep(1.5, 9.5, length(p * vec2(0.85, 0.7)));
    return h * centerBowl;
  }

  void main() {
    vUv = uv;
    vec3 pos = position;
    float elev = terrainWave(pos.xy, uTime);
    pos.z += elev;
    vElev = elev;
    vec4 worldPos = modelMatrix * vec4(pos, 1.0);
    vWorldPos = worldPos.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const LIDAR_FRAGMENT_SHADER = /* glsl */ `
  uniform float uTime;
  uniform float uScanZ;
  uniform float uOpacity;
  uniform float uLockFlash;
  varying vec3 vWorldPos;
  varying vec2 vUv;
  varying float vElev;

  void main() {
    vec2 major = abs(fract(vWorldPos.xz * 0.5 - 0.5) - 0.5) / fwidth(vWorldPos.xz * 0.5);
    float majorLine = 1.0 - min(min(major.x, major.y), 1.0);

    vec2 minor = abs(fract(vWorldPos.xz * 2.0 - 0.5) - 0.5) / fwidth(vWorldPos.xz * 2.0);
    float minorLine = (1.0 - min(min(minor.x, minor.y), 1.0)) * 0.28;

    float grid = max(majorLine, minorLine);

    float scanDist = abs(vWorldPos.z - uScanZ);
    float laserCore = smoothstep(0.28, 0.0, scanDist);
    float laserTrail = smoothstep(3.4, 0.0, scanDist) * 0.45;
    float scanEnergy = laserCore + laserTrail;

    float radialDist = length(vWorldPos.xz);
    float pulseRing = smoothstep(0.35, 0.0, abs(radialDist - mod(uTime * 3.8, 16.0))) * 0.4;
    float distFade = smoothstep(18.0, 2.5, radialDist);

    vec3 baseCyan = vec3(0.18, 0.68, 0.94);
    vec3 hotCyan = vec3(0.55, 0.92, 1.0);
    vec3 emerald = vec3(0.06, 0.78, 0.54);

    vec3 gridCol = mix(baseCyan, emerald, smoothstep(-0.35, 0.55, vElev));
    vec3 col = gridCol * grid * (0.28 + scanEnergy * 1.15 + pulseRing);
    col += hotCyan * laserCore * 0.55;
    col += emerald * uLockFlash * grid * 0.7;

    float alpha = (grid * 0.42 + laserCore * 0.65 + laserTrail * 0.16 + pulseRing * 0.2) * distFade * uOpacity;
    if (alpha < 0.008) discard;

    gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.95));
  }
`;

export function BootSplash({
  version,
  metrics,
  processes,
  projects,
  clients,
  clientProjectsCount,
  onComplete,
}: BootSplashProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const mountRef = useRef<HTMLDivElement | null>(null);
  const matrixRef = useRef<HTMLCanvasElement | null>(null);
  const hudRef = useRef<HTMLDivElement | null>(null);
  const leftWingRef = useRef<HTMLDivElement | null>(null);
  const rightWingRef = useRef<HTMLDivElement | null>(null);
  const reticleRef = useRef<SVGSVGElement | null>(null);
  const shutterTopRef = useRef<HTMLDivElement | null>(null);
  const shutterBotRef = useRef<HTMLDivElement | null>(null);
  const barFillRef = useRef<HTMLSpanElement | null>(null);

  // Live ref of real project & client names for the background Matrix Rain
  const matrixTokensRef = useRef<string[]>([
    "AFFEXDESK",
    "TELEMETRY",
    "WORKSPACES",
    "GIT-GRAPH",
    "DOCKER-RAW",
    "NVME-SCAN",
  ]);

  const [displayTitle, setDisplayTitle] = useState("0xAF/E9-X");
  const [percent, setPercent] = useState(0);
  const [progressRatio, setProgressRatio] = useState(0);
  const [scanState, setScanState] = useState<"SCANNING" | "INDEXING" | "LOCKED">("SCANNING");
  const [telemetryCoords, setTelemetryCoords] = useState("AZ 000.0° · EL +18.4°");

  const finishedRef = useRef(false);
  const timelineRef = useRef<gsap.core.Timeline | null>(null);

  const triggerComplete = () => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    timelineRef.current?.kill();
    if (rootRef.current) {
      gsap.to(rootRef.current, {
        opacity: 0,
        duration: 0.3,
        ease: "power2.inOut",
        onComplete,
      });
    } else {
      onComplete();
    }
  };

  // Top 8 real projects (prioritizing dirty or largest reclaimable so the scan feels live & useful)
  const visibleProjects = useMemo(() => {
    if (projects.length === 0) return [];
    const sorted = [...projects].sort((a, b) => {
      if (b.git_dirty_count !== a.git_dirty_count) {
        return b.git_dirty_count - a.git_dirty_count;
      }
      return b.reclaimable_bytes - a.reclaimable_bytes;
    });
    return sorted.slice(0, 8);
  }, [projects]);

  const visibleClients = useMemo(() => clients.slice(0, 6), [clients]);

  const dirtyRepoCount = useMemo(
    () => projects.filter((p) => p.git_dirty_count > 0).length,
    [projects]
  );

  // Update Matrix Rain stream tokens immediately whenever real projects/clients arrive
  useEffect(() => {
    const tokens: string[] = [];
    for (const p of projects) {
      if (p.name) tokens.push(p.name.toUpperCase());
      if (p.git_branch && p.git_branch !== "main") {
        tokens.push(`${p.name.toUpperCase()}@${p.git_branch.toUpperCase()}`);
      }
    }
    for (const c of clients) {
      if (c.name) tokens.push(`CLIENT:${c.name.toUpperCase()}`);
    }
    if (tokens.length > 0) {
      matrixTokensRef.current = tokens;
    }
  }, [projects, clients]);

  // Real-Data Project Name Matrix Rain (transparent Canvas 2D over WebGL2 Lidar)
  useEffect(() => {
    const canvas = matrixRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let rafId = 0;
    let width = window.innerWidth || 1280;
    let height = window.innerHeight || 800;
    const colWidth = 20;
    const charStep = 15;

    interface MatrixColumn {
      x: number;
      y: number;
      speed: number;
      text: string;
      charIdx: number;
      accent: "emerald" | "cyan";
    }

    let columns: MatrixColumn[] = [];

    const pickToken = () => {
      const list = matrixTokensRef.current;
      const base = list[Math.floor(Math.random() * list.length)] || "AFFEXDESK";
      return `${base} · `;
    };

    const initColumns = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth || 1280;
      height = window.innerHeight || 800;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const count = Math.max(16, Math.floor(width / colWidth));
      columns = Array.from({ length: count }, (_, i) => ({
        x: i * colWidth + 10,
        y: Math.random() * height - height * 0.4,
        speed: 135 + Math.random() * 155,
        text: pickToken(),
        charIdx: Math.floor(Math.random() * 8),
        accent: i % 3 === 0 ? "cyan" : "emerald",
      }));
    };

    initColumns();
    window.addEventListener("resize", initColumns);

    let lastTime = performance.now();
    let stepAccum = 0;

    const drawMatrix = (now: number) => {
      const dt = Math.min(0.05, (now - lastTime) / 1000);
      lastTime = now;
      stepAccum += dt;

      // Gently fade existing trails using destination-out so the WebGL2 Lidar stays transparent behind it
      if (stepAccum >= 0.032) {
        stepAccum = 0;
        ctx.save();
        ctx.globalCompositeOperation = "destination-out";
        ctx.fillStyle = "rgba(0, 0, 0, 0.16)";
        ctx.fillRect(0, 0, width, height);
        ctx.restore();
      }

      ctx.font = '600 12px ui-monospace, "SF Mono", Menlo, Monaco, Consolas, monospace';
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      for (const col of columns) {
        const prevRow = Math.floor(col.y / charStep);
        col.y += col.speed * dt;
        const currRow = Math.floor(col.y / charStep);

        if (currRow > prevRow) {
          if (col.charIdx >= col.text.length) {
            col.text = pickToken();
            col.charIdx = 0;
          }
          const ch = col.text[col.charIdx] || "·";
          col.charIdx += 1;

          const drawY = currRow * charStep;
          if (drawY >= 36 && drawY <= height - 36) {
            // Paint previous head in emerald/cyan so only the newest tip glows ice-white
            if (prevRow * charStep >= 36) {
              const prevCh = col.text[Math.max(0, col.charIdx - 2)] || "";
              if (prevCh) {
                ctx.fillStyle =
                  col.accent === "cyan"
                    ? "rgba(56, 189, 248, 0.62)"
                    : "rgba(16, 185, 129, 0.68)";
                ctx.fillText(prevCh, col.x, prevRow * charStep);
              }
            }

            // Bright leading head character
            ctx.fillStyle = "rgba(224, 242, 254, 0.92)";
            ctx.fillText(ch, col.x, drawY);
          }
        }

        if (col.y > height + 40) {
          col.y = -Math.random() * 140;
          col.speed = 135 + Math.random() * 155;
          col.text = pickToken();
          col.charIdx = 0;
        }
      }

      rafId = window.requestAnimationFrame(drawMatrix);
    };

    rafId = window.requestAnimationFrame(drawMatrix);
    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener("resize", initColumns);
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === " " || e.key === "Enter") {
        triggerComplete();
      }
    };
    window.addEventListener("keydown", onKeyDown);

    const mount = mountRef.current;
    let renderer: THREE.WebGLRenderer | null = null;
    let rafId = 0;
    let disposed = false;
    const geometries: THREE.BufferGeometry[] = [];
    const materials: THREE.Material[] = [];

    const state = {
      progress: 0,
      scanZ: -12,
      opacity: 1,
      lockFlash: 0,
      mouseX: 0,
      mouseY: 0,
    };

    let camera: THREE.PerspectiveCamera | null = null;
    let lidarMat: THREE.ShaderMaterial | null = null;
    let barMeshes: THREE.Mesh[] = [];

    const handleMouseMove = (e: MouseEvent) => {
      state.mouseX = (e.clientX / Math.max(window.innerWidth, 1) - 0.5) * 2;
      state.mouseY = (e.clientY / Math.max(window.innerHeight, 1) - 0.5) * 2;
    };
    window.addEventListener("mousemove", handleMouseMove);

    let handleResize: (() => void) | null = null;

    if (mount) {
      try {
        const width = window.innerWidth || 1280;
        const height = window.innerHeight || 800;

        const scene = new THREE.Scene();
        camera = new THREE.PerspectiveCamera(46, width / height, 0.1, 100);
        camera.position.set(0, 6.2, 11.8);
        camera.lookAt(0, -0.4, 0);

        renderer = new THREE.WebGLRenderer({
          antialias: true,
          alpha: true,
          powerPreference: "high-performance",
        });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.setSize(width, height);
        renderer.setClearColor(0x07080b, 1);
        mount.appendChild(renderer.domElement);

        // 1. 3D Lidar Topographic Grid Floor
        const planeGeo = new THREE.PlaneGeometry(34, 34, 96, 96);
        geometries.push(planeGeo);
        lidarMat = new THREE.ShaderMaterial({
          vertexShader: LIDAR_VERTEX_SHADER,
          fragmentShader: LIDAR_FRAGMENT_SHADER,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          extensions: { derivatives: true } as unknown as THREE.ShaderMaterialParameters["extensions"],
          uniforms: {
            uTime: { value: 0 },
            uScanZ: { value: state.scanZ },
            uOpacity: { value: 1 },
            uLockFlash: { value: 0 },
          },
        });
        materials.push(lidarMat);
        const terrain = new THREE.Mesh(planeGeo, lidarMat);
        terrain.rotation.x = -Math.PI / 2;
        terrain.position.y = -1.75;
        scene.add(terrain);

        // 2. Vertical 3D Tactical Telemetry Columns along left & right flanks
        const colGeo = new THREE.BoxGeometry(0.11, 1, 0.11);
        geometries.push(colGeo);
        const colMatCyan = new THREE.MeshBasicMaterial({
          color: 0x38bdf8,
          transparent: true,
          opacity: 0.42,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
        const colMatEmerald = new THREE.MeshBasicMaterial({
          color: 0x10b981,
          transparent: true,
          opacity: 0.45,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
        materials.push(colMatCyan, colMatEmerald);

        barMeshes = [];
        for (let side = -1; side <= 1; side += 2) {
          for (let i = 0; i < 14; i += 1) {
            const z = -9.5 + i * 1.35;
            const x = side * (5.2 + (i % 3) * 0.75);
            const mat = i % 3 === 0 ? colMatEmerald : colMatCyan;
            const mesh = new THREE.Mesh(colGeo, mat);
            mesh.position.set(x, -1.75, z);
            mesh.scale.y = 0.05;
            mesh.userData = {
              baseHeight: 0.35 + ((i * 37) % 10) * 0.16,
              phase: i * 0.6 + (side > 0 ? 1.5 : 0),
            };
            scene.add(mesh);
            barMeshes.push(mesh);
          }
        }

        // 3. Sweeping Horizon Laser Bar
        const laserBarGeo = new THREE.PlaneGeometry(24, 0.04);
        geometries.push(laserBarGeo);
        const laserBarMat = new THREE.MeshBasicMaterial({
          color: 0x38bdf8,
          transparent: true,
          opacity: 0.65,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
        });
        materials.push(laserBarMat);
        const laserBar = new THREE.Mesh(laserBarGeo, laserBarMat);
        laserBar.rotation.x = -Math.PI / 2;
        laserBar.position.y = -1.68;
        scene.add(laserBar);

        handleResize = () => {
          if (!camera || !renderer) return;
          const w = window.innerWidth || 1280;
          const h = window.innerHeight || 800;
          camera.aspect = w / h;
          camera.updateProjectionMatrix();
          renderer.setSize(w, h);
        };
        window.addEventListener("resize", handleResize);

        const clock = new THREE.Clock();
        const animate = () => {
          if (disposed || !renderer || !camera) return;
          const t = clock.getElapsedTime();

          if (lidarMat) {
            lidarMat.uniforms.uTime.value = t;
            lidarMat.uniforms.uScanZ.value = state.scanZ;
            lidarMat.uniforms.uOpacity.value = state.opacity;
            lidarMat.uniforms.uLockFlash.value = state.lockFlash;
          }

          laserBar.position.z = state.scanZ;
          laserBarMat.opacity = 0.55 * state.opacity;

          for (const bar of barMeshes) {
            const { baseHeight, phase } = bar.userData as {
              baseHeight: number;
              phase: number;
            };
            const distToScan = Math.abs(bar.position.z - state.scanZ);
            const boost = distToScan < 1.8 ? (1.8 - distToScan) * 0.95 : 0;
            const h = Math.max(
              0.08,
              (baseHeight + Math.sin(t * 2.4 + phase) * 0.25 + boost) *
                Math.min(1, state.progress * 1.6 + 0.15)
            );
            bar.scale.y = h;
            bar.position.y = -1.75 + h * 0.5;
          }

          camera.position.x += (state.mouseX * 0.45 - camera.position.x) * 0.04;
          camera.lookAt(0, -0.35, -0.5);

          renderer.render(scene, camera);
          rafId = window.requestAnimationFrame(animate);
        };
        rafId = window.requestAnimationFrame(animate);
      } catch {
        // Fallback silently if WebGL is unavailable
      }
    }

    // GSAP Master Spaceship Scanner Timeline (~5.5s, click/ESC to skip anytime)
    const tl = gsap.timeline({
      onComplete: () => {
        if (!finishedRef.current) {
          finishedRef.current = true;
          onComplete();
        }
      },
    });
    timelineRef.current = tl;

    if (camera) {
      tl.to(
        camera.position,
        { y: 3.0, z: 7.2, duration: 2.6, ease: "expo.out" },
        0
      );
    }

    tl.fromTo(
      state,
      { scanZ: -11 },
      { scanZ: 8, duration: 1.75, ease: "power1.inOut" },
      0.05
    )
      .to(state, { scanZ: -8, duration: 1.55, ease: "power1.inOut" }, 1.8)
      .to(state, { scanZ: 4, duration: 1.4, ease: "power2.inOut" }, 3.35);

    if (reticleRef.current) {
      tl.fromTo(
        reticleRef.current,
        { scale: 1.28, opacity: 0, rotate: -14 },
        { scale: 1, opacity: 1, rotate: 0, duration: 1.35, ease: "expo.out" },
        0.1
      );
    }

    if (hudRef.current) {
      tl.fromTo(
        hudRef.current,
        { opacity: 0, y: 14 },
        { opacity: 1, y: 0, duration: 0.85, ease: "power3.out" },
        0.22
      );
    }

    if (leftWingRef.current) {
      tl.fromTo(
        leftWingRef.current,
        { opacity: 0, x: -32 },
        { opacity: 1, x: 0, duration: 0.9, ease: "power3.out" },
        0.32
      );
    }

    if (rightWingRef.current) {
      tl.fromTo(
        rightWingRef.current,
        { opacity: 0, x: 32 },
        { opacity: 1, x: 0, duration: 0.9, ease: "power3.out" },
        0.38
      );
    }

    // Live scanner sweep (0% -> 100% over 4.2s so repos & clients are cleanly legible)
    tl.to(
      state,
      {
        progress: 1,
        duration: 4.2,
        ease: "power1.inOut",
        onUpdate: () => {
          const p = state.progress;
          setPercent(Math.round(p * 100));
          setProgressRatio(p);
          if (p > 0.94) setScanState("LOCKED");
          else if (p > 0.32) setScanState("INDEXING");

          const az = (p * 360).toFixed(1).padStart(5, "0");
          const el = (18.4 + Math.sin(p * Math.PI * 2) * 4.2).toFixed(1);
          setTelemetryCoords(`AZ ${az}° · EL +${el}°`);

          if (barFillRef.current) {
            barFillRef.current.style.transform = `scaleX(${p})`;
          }

          const resolved = Math.floor(p * (TARGET_TITLE.length + 1));
          let out = "";
          for (let i = 0; i < TARGET_TITLE.length; i += 1) {
            if (i < resolved) {
              out += TARGET_TITLE[i];
            } else {
              const idx = Math.floor((p * 53 + i * 7) % SCRAMBLE_CHARS.length);
              out += SCRAMBLE_CHARS[idx];
            }
          }
          setDisplayTitle(out);
        },
      },
      0.28
    );

    // Target Lock emerald flash + brief hold + Tactical Shutter Split Reveal
    tl.to(state, { lockFlash: 1, duration: 0.2, ease: "power2.out" }, 4.55)
      .to(state, { lockFlash: 0, duration: 0.32 }, 4.75);

    if (camera) {
      tl.to(
        camera.position,
        { y: 1.2, z: 3.4, duration: 0.65, ease: "power3.in" },
        4.92
      );
    }
    if (leftWingRef.current) {
      tl.to(leftWingRef.current, { opacity: 0, x: -34, duration: 0.38, ease: "power2.in" }, 4.92);
    }
    if (rightWingRef.current) {
      tl.to(rightWingRef.current, { opacity: 0, x: 34, duration: 0.38, ease: "power2.in" }, 4.92);
    }
    if (hudRef.current) {
      tl.to(
        hudRef.current,
        { opacity: 0, scale: 0.97, duration: 0.36, ease: "power2.in" },
        4.96
      );
    }
    if (reticleRef.current) {
      tl.to(
        reticleRef.current,
        { opacity: 0, scale: 1.18, duration: 0.42, ease: "power2.in" },
        4.96
      );
    }
    if (shutterTopRef.current && shutterBotRef.current) {
      tl.to(
        shutterTopRef.current,
        { yPercent: -100, duration: 0.48, ease: "expo.inOut" },
        5.05
      );
      tl.to(
        shutterBotRef.current,
        { yPercent: 100, duration: 0.48, ease: "expo.inOut" },
        5.05
      );
    }
    tl.to(state, { opacity: 0, duration: 0.45, ease: "power2.in" }, 5.02);
    if (rootRef.current) {
      tl.to(
        rootRef.current,
        { opacity: 0, duration: 0.36, ease: "power2.inOut" },
        5.22
      );
    }

    return () => {
      disposed = true;
      tl.kill();
      window.cancelAnimationFrame(rafId);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("mousemove", handleMouseMove);
      if (handleResize) window.removeEventListener("resize", handleResize);
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
      if (renderer) {
        renderer.dispose();
        if (renderer.domElement.parentNode === mount) {
          mount?.removeChild(renderer.domElement);
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const nodeLabel = (metrics?.hostname || "LOCAL-BRIDGE").toUpperCase();
  const osLabel = (metrics?.os_name || "MACOS WORKSTATION").toUpperCase();
  const coresLabel = metrics?.cpu_cores
    ? `${metrics.cpu_cores}-CORE SILICON`
    : "MULTI-CORE BUS";

  const activeRepoIdx =
    visibleProjects.length > 0
      ? Math.min(visibleProjects.length, Math.floor(progressRatio * (visibleProjects.length + 0.6)))
      : 0;

  const activeClientIdx =
    visibleClients.length > 0
      ? Math.min(visibleClients.length, Math.floor(progressRatio * (visibleClients.length + 0.6)))
      : 0;

  const subsystemRows = [
    {
      code: "SYS.01",
      label: "TELEMETRY BUS",
      ready: progressRatio > 0.22 && Boolean(metrics),
      badge: metrics ? `${formatBytes(metrics.disk_available_bytes)} FREE` : "PROBING",
    },
    {
      code: "SYS.02",
      label: "WORKSPACE REPOS",
      ready: progressRatio > 0.45,
      badge:
        projects.length > 0
          ? `${projects.length} REPOS${dirtyRepoCount > 0 ? ` · ${dirtyRepoCount} DIRTY` : ""}`
          : "INDEXING",
    },
    {
      code: "SYS.03",
      label: "CLIENT REGISTRY",
      ready: progressRatio > 0.68,
      badge:
        clients.length > 0
          ? `${clients.length} CLIENTS · ${clientProjectsCount} LINKED`
          : "STANDBY",
    },
    {
      code: "SYS.04",
      label: "DEV PROCESSES",
      ready: progressRatio > 0.86,
      badge: processes ? `${processes.processes.length} ACTIVE` : "PROBING",
    },
  ];

  return (
    <div
      ref={rootRef}
      className="boot-splash"
      role="presentation"
      onClick={triggerComplete}
      title="Geçmek için tıklayın"
    >
      <div ref={mountRef} className="boot-splash__webgl" aria-hidden="true" />
      <canvas ref={matrixRef} className="boot-splash__matrix" aria-hidden="true" />
      <div className="boot-splash__scanlines" aria-hidden="true" />
      <div className="boot-splash__vignette" aria-hidden="true" />

      {/* Top & Bottom Tactical Shutter Bars */}
      <div ref={shutterTopRef} className="boot-shutter boot-shutter--top" aria-hidden="true">
        <div className="boot-shutter__row mono">
          <span>NODE // {nodeLabel}</span>
          <span>{telemetryCoords}</span>
          <span>BUS // {coresLabel}</span>
        </div>
      </div>
      <div ref={shutterBotRef} className="boot-shutter boot-shutter--bottom" aria-hidden="true">
        <div className="boot-shutter__row mono">
          <span>OS // {osLabel}</span>
          <span>LIVE WORKSPACE LIDAR · WEBGL2</span>
          <span>ESC / CLICK TO BYPASS</span>
        </div>
      </div>

      {/* Left Wing: Live Discovered Repositories */}
      <aside ref={leftWingRef} className="boot-wing boot-wing--left mono" aria-hidden="true">
        <div className="boot-wing__head">
          <span>REPOS // LIVE SCAN</span>
          <span className="text-cyan tabular">{projects.length}</span>
        </div>
        <div className="boot-feed">
          {visibleProjects.length === 0 ? (
            <div className="boot-feed__empty">
              {progressRatio > 0.7 ? "NO WORKSPACES MOUNTED" : "SCANNING DEV ROOTS..."}
            </div>
          ) : (
            visibleProjects.map((proj, idx) => {
              const scanned = idx < activeRepoIdx;
              const scanningNow = idx === activeRepoIdx && progressRatio < 0.98;
              return (
                <div
                  key={proj.path}
                  className={`boot-feed__row ${
                    scanned
                      ? "boot-feed__row--done"
                      : scanningNow
                      ? "boot-feed__row--active"
                      : ""
                  }`}
                >
                  <span className="boot-feed__name truncate">{proj.name}</span>
                  <span className="boot-feed__meta">
                    {proj.git_branch ? proj.git_branch : "local"}
                  </span>
                  <span
                    className={`boot-feed__tag ${
                      !scanned
                        ? ""
                        : proj.git_dirty_count > 0
                        ? "boot-feed__tag--warn"
                        : "boot-feed__tag--ok"
                    }`}
                  >
                    {!scanned
                      ? scanningNow
                        ? "SCAN"
                        : "WAIT"
                      : proj.git_dirty_count > 0
                      ? `${proj.git_dirty_count}D`
                      : "OK"}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </aside>

      {/* Right Wing: Live Clients & Hardware Readout */}
      <aside ref={rightWingRef} className="boot-wing boot-wing--right mono" aria-hidden="true">
        <div className="boot-wing__head">
          <span>TELEMETRY // LIVE</span>
          <span className="text-emerald">ONLINE</span>
        </div>
        <div className="boot-telem-grid">
          <div className="boot-telem-cell">
            <span>CPU</span>
            <strong>{metrics ? formatPct(metrics.cpu_usage_pct) : "--"}</strong>
          </div>
          <div className="boot-telem-cell">
            <span>RAM</span>
            <strong>{metrics ? formatBytes(metrics.mem_used_bytes) : "--"}</strong>
          </div>
          <div className="boot-telem-cell">
            <span>DISK FREE</span>
            <strong className="text-emerald">
              {metrics ? formatBytes(metrics.disk_available_bytes) : "--"}
            </strong>
          </div>
          <div className="boot-telem-cell">
            <span>PROCS</span>
            <strong>{processes ? processes.processes.length : "--"}</strong>
          </div>
        </div>

        <div className="boot-wing__head boot-wing__head--sub">
          <span>CLIENTS // REGISTRY</span>
          <span className="text-cyan tabular">{clients.length}</span>
        </div>
        <div className="boot-feed">
          {visibleClients.length === 0 ? (
            <div className="boot-feed__empty">CLIENT REGISTRY READY</div>
          ) : (
            visibleClients.map((client, idx) => {
              const scanned = idx < activeClientIdx;
              const scanningNow = idx === activeClientIdx && progressRatio < 0.98;
              return (
                <div
                  key={client.id}
                  className={`boot-feed__row ${
                    scanned
                      ? "boot-feed__row--done"
                      : scanningNow
                      ? "boot-feed__row--active"
                      : ""
                  }`}
                >
                  <span className="boot-feed__name truncate">{client.name}</span>
                  <span className="boot-feed__meta truncate">
                    {(client.remote_tool || "LOCAL").toUpperCase()}
                  </span>
                  <span
                    className={`boot-feed__tag ${
                      scanned ? "boot-feed__tag--ok" : ""
                    }`}
                  >
                    {scanned ? "SYNC" : scanningNow ? "PING" : "WAIT"}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </aside>

      {/* Precision Spaceship Tactical Scanner Reticle SVG */}
      <svg
        ref={reticleRef}
        className="boot-reticle"
        viewBox="0 0 520 520"
        fill="none"
        aria-hidden="true"
      >
        <path d="M90 140 L90 90 L140 90" stroke="rgba(56,189,248,0.55)" strokeWidth="1.5" />
        <path d="M380 90 L430 90 L430 140" stroke="rgba(56,189,248,0.55)" strokeWidth="1.5" />
        <path d="M90 380 L90 430 L140 430" stroke="rgba(56,189,248,0.55)" strokeWidth="1.5" />
        <path d="M380 430 L430 430 L430 380" stroke="rgba(56,189,248,0.55)" strokeWidth="1.5" />

        <line x1="260" y1="62" x2="260" y2="86" stroke="rgba(56,189,248,0.7)" strokeWidth="1" />
        <line x1="260" y1="434" x2="260" y2="458" stroke="rgba(56,189,248,0.7)" strokeWidth="1" />
        <line x1="62" y1="260" x2="86" y2="260" stroke="rgba(56,189,248,0.7)" strokeWidth="1" />
        <line x1="434" y1="260" x2="458" y2="260" stroke="rgba(56,189,248,0.7)" strokeWidth="1" />

        <circle
          cx="260"
          cy="260"
          r="194"
          stroke="rgba(56,189,248,0.16)"
          strokeWidth="1"
          strokeDasharray="6 10"
        />
        <circle
          cx="260"
          cy="260"
          r="156"
          stroke={scanState === "LOCKED" ? "rgba(16,185,129,0.55)" : "rgba(56,189,248,0.22)"}
          strokeWidth="1"
          strokeDasharray="40 20 8 20"
        />

        <text x="260" y="52" textAnchor="middle" fill="rgba(56,189,248,0.65)" fontSize="9" fontFamily="monospace">000°</text>
        <text x="476" y="263" textAnchor="start" fill="rgba(56,189,248,0.65)" fontSize="9" fontFamily="monospace">090°</text>
        <text x="260" y="476" textAnchor="middle" fill="rgba(56,189,248,0.65)" fontSize="9" fontFamily="monospace">180°</text>
        <text x="44" y="263" textAnchor="end" fill="rgba(56,189,248,0.65)" fontSize="9" fontFamily="monospace">270°</text>
      </svg>

      {/* Center Tactical Command Core */}
      <div ref={hudRef} className="boot-hud-panel">
        <div className="boot-hud-panel__top mono">
          <span className="boot-hud-chip">
            <TerminalSquare size={12} />
            <span>BRIDGE // v{version}</span>
          </span>
          <span
            className={`boot-hud-lock ${
              scanState === "LOCKED" ? "boot-hud-lock--ok" : ""
            }`}
          >
            <span className="status-dot status-dot--live" />
            <span>{scanState}</span>
          </span>
        </div>

        <div className="boot-splash__title-row">
          <span className="boot-splash__wordmark mono">{displayTitle}</span>
        </div>

        <div className="boot-checklist mono">
          {subsystemRows.map((sub) => (
            <div
              key={sub.code}
              className={`boot-checklist__row ${sub.ready ? "boot-checklist__row--ok" : ""}`}
            >
              <span className="boot-checklist__code">{sub.code}</span>
              <span className="boot-checklist__label">{sub.label}</span>
              <span className="boot-checklist__state">{sub.badge}</span>
            </div>
          ))}
        </div>

        <div className="boot-splash__bar-wrap">
          <div className="boot-splash__bar">
            <span ref={barFillRef} className="boot-splash__bar-fill" />
          </div>
          <span className="boot-splash__pct mono tabular">
            {String(percent).padStart(3, "0")}%
          </span>
        </div>
      </div>
    </div>
  );
}
