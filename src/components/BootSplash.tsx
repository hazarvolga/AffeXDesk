import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import gsap from "gsap";
import { TerminalSquare } from "lucide-react";

export interface BootSplashProps {
  version: string;
  onComplete: () => void;
}

const TARGET_TITLE = "AFFEXDESK";
const SCRAMBLE_CHARS = "0123456789ABCDEF#$%+=*";
const BOOT_PHASES = [
  "KERNEL TELEMETRY · LOCKING",
  "WORKSPACES & GIT GRAPH · SYNCED",
  "DOCKER & DISK ENGINE · ONLINE",
  "MISSION CONTROL · ARMED",
];

const CORE_VERTEX_SHADER = /* glsl */ `
  uniform float uTime;
  uniform float uPulse;
  uniform float uExpand;
  varying vec3 vNormal;
  varying vec3 vViewPos;
  varying float vDisplace;

  float harmonicNoise(vec3 p, float t) {
    float n = sin(p.x * 3.1 + t * 1.4) * cos(p.y * 2.9 - t * 1.1) * sin(p.z * 3.3 + t * 0.9);
    n += 0.45 * sin(p.x * 6.4 - t * 2.1 + p.z * 4.2);
    n += 0.22 * cos(p.y * 8.2 + t * 2.7 - p.x * 5.1);
    return n;
  }

  void main() {
    float disp = harmonicNoise(position, uTime) * (0.14 + uPulse * 0.14);
    vDisplace = disp;
    vec3 displaced = position + normal * (disp + uExpand * 0.65);
    vec4 mvPos = modelViewMatrix * vec4(displaced, 1.0);
    vViewPos = -mvPos.xyz;
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * mvPos;
  }
`;

const CORE_FRAGMENT_SHADER = /* glsl */ `
  uniform float uTime;
  uniform float uOpacity;
  varying vec3 vNormal;
  varying vec3 vViewPos;
  varying float vDisplace;

  void main() {
    vec3 normal = normalize(vNormal);
    vec3 viewDir = normalize(vViewPos);
    float fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), 2.6);

    vec3 obsidian = vec3(0.035, 0.045, 0.075);
    vec3 cyan = vec3(0.22, 0.74, 0.97);
    vec3 emerald = vec3(0.06, 0.73, 0.51);
    vec3 indigo = vec3(0.50, 0.55, 0.97);

    float wave = 0.5 + 0.5 * sin(vDisplace * 14.0 + uTime * 2.2);
    vec3 energy = mix(cyan, emerald, wave);
    energy = mix(energy, indigo, fresnel * 0.35);

    float scan = 0.92 + 0.08 * sin(gl_FragCoord.y * 0.65 - uTime * 8.0);
    vec3 col = mix(obsidian, energy, clamp(fresnel * 1.25 + max(vDisplace, 0.0) * 1.4, 0.0, 1.0));
    col += energy * pow(fresnel, 4.5) * 0.9;
    col *= scan;

    gl_FragColor = vec4(col, uOpacity * (0.86 + fresnel * 0.14));
  }
`;

const PARTICLE_VERTEX_SHADER = /* glsl */ `
  uniform float uTime;
  uniform float uWarp;
  attribute float aScale;
  attribute vec3 aColor;
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    vColor = aColor;
    vec3 pos = position;
    float zRange = 28.0;
    pos.z = mod(pos.z + uTime * (1.4 + uWarp * 4.2) + zRange * 0.5, zRange) - zRange * 0.5;
    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    float dist = max(-mvPosition.z, 0.5);
    gl_PointSize = clamp(aScale * (120.0 / dist), 1.0, 10.0);
    vAlpha = smoothstep(14.0, 2.5, dist) * smoothstep(0.6, 2.2, dist);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const PARTICLE_FRAGMENT_SHADER = /* glsl */ `
  uniform float uOpacity;
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    vec2 uv = gl_PointCoord - vec2(0.5);
    float d = length(uv);
    if (d > 0.5) discard;
    float glow = smoothstep(0.5, 0.05, d);
    gl_FragColor = vec4(vColor, glow * vAlpha * uOpacity);
  }
`;

export function BootSplash({ version, onComplete }: BootSplashProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const mountRef = useRef<HTMLDivElement | null>(null);
  const hudRef = useRef<HTMLDivElement | null>(null);
  const barFillRef = useRef<HTMLSpanElement | null>(null);

  const [displayTitle, setDisplayTitle] = useState("0xAF9E4D1");
  const [percent, setPercent] = useState(0);
  const [phaseIdx, setPhaseIdx] = useState(0);

  const finishedRef = useRef(false);
  const timelineRef = useRef<gsap.core.Timeline | null>(null);

  const triggerComplete = () => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    timelineRef.current?.kill();
    if (rootRef.current) {
      gsap.to(rootRef.current, {
        opacity: 0,
        scale: 1.03,
        duration: 0.34,
        ease: "power3.inOut",
        onComplete,
      });
    } else {
      onComplete();
    }
  };

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
      warp: 0,
      pulse: 0.25,
      expand: 0,
      opacity: 1,
      mouseX: 0,
      mouseY: 0,
    };

    let camera: THREE.PerspectiveCamera | null = null;
    let coreGroup: THREE.Group | null = null;
    let coreMesh: THREE.Mesh | null = null;
    let cageMesh: THREE.Mesh | null = null;
    const rings: THREE.Mesh[] = [];
    let coreMat: THREE.ShaderMaterial | null = null;
    let particleMat: THREE.ShaderMaterial | null = null;

    const handleMouseMove = (e: MouseEvent) => {
      state.mouseX = (e.clientX / Math.max(window.innerWidth, 1) - 0.5) * 2;
      state.mouseY = (e.clientY / Math.max(window.innerHeight, 1) - 0.5) * 2;
    };
    window.addEventListener("mousemove", handleMouseMove);

    let handleResize: (() => void) | null = null;

    // Initialize real Three.js WebGL2 scene
    if (mount) {
      try {
        const width = window.innerWidth || 1280;
        const height = window.innerHeight || 800;

        const scene = new THREE.Scene();
        camera = new THREE.PerspectiveCamera(48, width / height, 0.1, 100);
        camera.position.set(0, 0.25, 11.5);

        renderer = new THREE.WebGLRenderer({
          antialias: true,
          alpha: true,
          powerPreference: "high-performance",
        });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.setSize(width, height);
        renderer.setClearColor(0x09090b, 1);
        mount.appendChild(renderer.domElement);

        coreGroup = new THREE.Group();
        coreGroup.position.set(0, 0.42, 0);
        coreGroup.scale.setScalar(0.22);
        scene.add(coreGroup);

        // 1. Custom GLSL Fresnel + Harmonic Displacement Core
        const coreGeo = new THREE.IcosahedronGeometry(1.12, 5);
        geometries.push(coreGeo);
        coreMat = new THREE.ShaderMaterial({
          vertexShader: CORE_VERTEX_SHADER,
          fragmentShader: CORE_FRAGMENT_SHADER,
          transparent: true,
          uniforms: {
            uTime: { value: 0 },
            uPulse: { value: state.pulse },
            uExpand: { value: state.expand },
            uOpacity: { value: 1 },
          },
        });
        materials.push(coreMat);
        coreMesh = new THREE.Mesh(coreGeo, coreMat);
        coreGroup.add(coreMesh);

        // 2. Precision Wireframe Geodesic Cage
        const cageGeo = new THREE.IcosahedronGeometry(1.48, 2);
        geometries.push(cageGeo);
        const cageMat = new THREE.MeshBasicMaterial({
          color: 0x38bdf8,
          wireframe: true,
          transparent: true,
          opacity: 0.24,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
        materials.push(cageMat);
        cageMesh = new THREE.Mesh(cageGeo, cageMat);
        coreGroup.add(cageMesh);

        // 3. Three Gyroscopic Orbital Telemetry Rings
        const ringSpecs = [
          { radius: 2.05, tube: 0.009, color: 0x38bdf8, opacity: 0.55, rot: [1.18, 0.35, 0] },
          { radius: 2.48, tube: 0.007, color: 0x10b981, opacity: 0.48, rot: [-0.72, 1.15, 0.45] },
          { radius: 2.92, tube: 0.006, color: 0x818cf8, opacity: 0.36, rot: [0.35, -0.85, 1.05] },
        ] as const;

        for (const spec of ringSpecs) {
          const rGeo = new THREE.TorusGeometry(spec.radius, spec.tube, 12, 120);
          geometries.push(rGeo);
          const rMat = new THREE.MeshBasicMaterial({
            color: spec.color,
            transparent: true,
            opacity: spec.opacity,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          });
          materials.push(rMat);
          const ring = new THREE.Mesh(rGeo, rMat);
          ring.rotation.set(spec.rot[0], spec.rot[1], spec.rot[2]);
          ring.scale.setScalar(0.01);

          // Tiny glowing satellite node on each orbital ring
          const nodeGeo = new THREE.SphereGeometry(0.042, 10, 10);
          geometries.push(nodeGeo);
          const nodeMat = new THREE.MeshBasicMaterial({
            color: 0xe0f2fe,
            blending: THREE.AdditiveBlending,
          });
          materials.push(nodeMat);
          const node = new THREE.Mesh(nodeGeo, nodeMat);
          node.position.set(spec.radius, 0, 0);
          ring.add(node);

          coreGroup.add(ring);
          rings.push(ring);
        }

        // 4. 2,200-Particle 3D Depth Warp Field
        const count = 2200;
        const positions = new Float32Array(count * 3);
        const colors = new Float32Array(count * 3);
        const scales = new Float32Array(count);

        const cCyan = new THREE.Color(0x38bdf8);
        const cEmerald = new THREE.Color(0x10b981);
        const cIndigo = new THREE.Color(0x818cf8);
        const cIce = new THREE.Color(0xe0f2fe);

        for (let i = 0; i < count; i += 1) {
          const angle = Math.random() * Math.PI * 2;
          const radius = 1.6 + Math.pow(Math.random(), 0.65) * 11.5;
          positions[i * 3] = Math.cos(angle) * radius;
          positions[i * 3 + 1] = Math.sin(angle) * radius * 0.72;
          positions[i * 3 + 2] = (Math.random() - 0.5) * 28;

          const pick = Math.random();
          const c =
            pick < 0.45 ? cCyan : pick < 0.72 ? cEmerald : pick < 0.88 ? cIndigo : cIce;
          colors[i * 3] = c.r;
          colors[i * 3 + 1] = c.g;
          colors[i * 3 + 2] = c.b;
          scales[i] = 0.6 + Math.random() * 1.9;
        }

        const pGeo = new THREE.BufferGeometry();
        pGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
        pGeo.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));
        pGeo.setAttribute("aScale", new THREE.BufferAttribute(scales, 1));
        geometries.push(pGeo);

        particleMat = new THREE.ShaderMaterial({
          vertexShader: PARTICLE_VERTEX_SHADER,
          fragmentShader: PARTICLE_FRAGMENT_SHADER,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          uniforms: {
            uTime: { value: 0 },
            uWarp: { value: 0 },
            uOpacity: { value: 0.85 },
          },
        });
        materials.push(particleMat);
        const particles = new THREE.Points(pGeo, particleMat);
        scene.add(particles);

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

          if (coreMat) {
            coreMat.uniforms.uTime.value = t;
            coreMat.uniforms.uPulse.value = state.pulse;
            coreMat.uniforms.uExpand.value = state.expand;
            coreMat.uniforms.uOpacity.value = state.opacity;
          }
          if (particleMat) {
            particleMat.uniforms.uTime.value = t;
            particleMat.uniforms.uWarp.value = state.warp;
            particleMat.uniforms.uOpacity.value = state.opacity * 0.9;
          }
          if (coreMesh) {
            coreMesh.rotation.y = t * 0.55;
            coreMesh.rotation.x = t * 0.28;
          }
          if (cageMesh) {
            cageMesh.rotation.y = -t * 0.42;
            cageMesh.rotation.z = t * 0.22;
          }
          if (rings[0]) rings[0].rotation.z = t * 0.85;
          if (rings[1]) rings[1].rotation.x = -0.72 + t * 0.65;
          if (rings[2]) rings[2].rotation.y = -0.85 - t * 0.52;

          // Subtle cursor parallax
          camera.position.x += (state.mouseX * 0.35 - camera.position.x) * 0.05;
          camera.position.y += (-state.mouseY * 0.22 + 0.22 - camera.position.y) * 0.05;
          camera.lookAt(0, 0.2, 0);

          renderer.render(scene, camera);
          rafId = window.requestAnimationFrame(animate);
        };
        rafId = window.requestAnimationFrame(animate);
      } catch {
        // Fallback silently if WebGL is unavailable
      }
    }

    // GSAP Master Cinematic Timeline (~3.0s)
    const tl = gsap.timeline({
      onComplete: () => {
        if (!finishedRef.current) {
          finishedRef.current = true;
          onComplete();
        }
      },
    });
    timelineRef.current = tl;

    // 1. Camera glide-in & 3D core unfold
    if (camera) {
      tl.to(
        camera.position,
        { z: 5.1, duration: 1.55, ease: "expo.out" },
        0
      );
    }
    if (coreGroup) {
      tl.to(
        coreGroup.scale,
        { x: 1, y: 1, z: 1, duration: 1.35, ease: "expo.out" },
        0.05
      );
    }
    if (rings.length > 0) {
      tl.to(
        rings.map((r) => r.scale),
        { x: 1, y: 1, z: 1, duration: 1.1, stagger: 0.14, ease: "power4.out" },
        0.22
      );
    }

    // 2. HUD reveal
    if (hudRef.current) {
      tl.fromTo(
        hudRef.current,
        { opacity: 0, y: 22, scale: 0.96 },
        { opacity: 1, y: 0, scale: 1, duration: 0.8, ease: "power3.out" },
        0.25
      );
    }

    // 3. Scramble character decode + live percentage counter (0 -> 100%)
    tl.to(
      state,
      {
        progress: 1,
        duration: 2.05,
        ease: "power2.inOut",
        onUpdate: () => {
          const p = state.progress;
          setPercent(Math.round(p * 100));
          const nextPhase = Math.min(
            BOOT_PHASES.length - 1,
            Math.floor(p * BOOT_PHASES.length)
          );
          setPhaseIdx(nextPhase);

          if (barFillRef.current) {
            barFillRef.current.style.transform = `scaleX(${p})`;
          }

          const lockedCount = Math.floor(p * (TARGET_TITLE.length + 1));
          let out = "";
          for (let i = 0; i < TARGET_TITLE.length; i += 1) {
            if (i < lockedCount) {
              out += TARGET_TITLE[i];
            } else {
              const idx = Math.floor(
                (p * 47 + i * 7) % SCRAMBLE_CHARS.length
              );
              out += SCRAMBLE_CHARS[idx];
            }
          }
          setDisplayTitle(out);
        },
      },
      0.22
    );

    // 4. Energy pulse peak right before warp-dive
    tl.to(state, { pulse: 0.95, duration: 0.32, ease: "power2.in" }, 2.1);

    // 5. Warp-Dive Finale: camera rockets into the core as FOV opens & splash dissolves
    if (camera) {
      tl.to(
        camera.position,
        { z: 0.45, duration: 0.68, ease: "power3.in" },
        2.32
      );
      tl.to(
        camera,
        {
          fov: 96,
          duration: 0.68,
          ease: "power3.in",
          onUpdate: () => camera?.updateProjectionMatrix(),
        },
        2.32
      );
    }
    tl.to(
      state,
      { warp: 5.5, expand: 1.45, opacity: 0, duration: 0.68, ease: "power3.in" },
      2.32
    );
    if (hudRef.current) {
      tl.to(
        hudRef.current,
        { opacity: 0, y: -14, scale: 1.04, duration: 0.42, ease: "power2.in" },
        2.36
      );
    }
    if (rootRef.current) {
      tl.to(
        rootRef.current,
        { opacity: 0, duration: 0.42, ease: "power2.inOut" },
        2.62
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

  return (
    <div
      ref={rootRef}
      className="boot-splash"
      role="presentation"
      onClick={triggerComplete}
      title="Geçmek için tıklayın"
    >
      <div ref={mountRef} className="boot-splash__webgl" aria-hidden="true" />
      <div className="boot-splash__vignette" aria-hidden="true" />

      {/* Corner HUD Brackets */}
      <span className="boot-hud-corner boot-hud-corner--tl" aria-hidden="true" />
      <span className="boot-hud-corner boot-hud-corner--tr" aria-hidden="true" />
      <span className="boot-hud-corner boot-hud-corner--bl" aria-hidden="true" />
      <span className="boot-hud-corner boot-hud-corner--br" aria-hidden="true" />

      <div ref={hudRef} className="boot-splash__core">
        <div className="boot-splash__mark">
          <TerminalSquare size={20} />
        </div>
        <div className="boot-splash__title-row">
          <span className="boot-splash__wordmark mono">{displayTitle}</span>
          <span className="boot-splash__version mono">v{version}</span>
        </div>
        <div className="boot-splash__bar-wrap">
          <div className="boot-splash__bar">
            <span ref={barFillRef} className="boot-splash__bar-fill" />
          </div>
          <span className="boot-splash__pct mono tabular">
            {String(percent).padStart(3, "0")}%
          </span>
        </div>
        <div className="boot-splash__status mono">
          <span className="status-dot status-dot--live" />
          <span>{BOOT_PHASES[phaseIdx]}</span>
        </div>
      </div>

      <span className="boot-splash__meta mono">WEBGL2 · GSAP ENGINE</span>
      <span className="boot-splash__skip mono">ESC / CLICK TO SKIP</span>
    </div>
  );
}
