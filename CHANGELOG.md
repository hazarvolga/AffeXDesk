# Changelog

All notable changes to **AffeXDesk** are documented in this file.

## [0.1.0] - 2026-11-27

Initial public open-source release of **AffeXDesk — Developer & Founder Mission Control** (Tauri 2 + Rust + React 19 + TypeScript + Three.js WebGL2 + GSAP + SQLite).

### Added
- **Mission Control Overview & Live Telemetry (`⌘1` / `⌘2`):** Real-time CPU, RAM pressure, primary disk capacity, thermal status, dev process/port scanner (`lsof` / `netstat`), zombie process detection, and safe process termination with protected PID guards.
- **Always-On-Top Floating Desktop Telemetry HUD:** Draggable `980×40` frameless system telemetry bar (`CPU · RAM · DISK · THERMAL`) with top-center default placement, Space-wide visibility, and persistent SQLite toggle.
- **Project Radar & Project Detail Cockpit (`⌘3`):**
  - Multi-stack workspace scanner (JS/TS, Rust/Tauri, Python, Go, Java, PHP, Flutter, Swift, Docker) with Git status, live URL uptime checks, and clickable Finder links on every allowlisted cache chip.
  - Dedicated **Project Detail Page** with 0–100 DevOps/WebDev health score, platform detection (GitHub, GitLab, Vercel, Docker, Tauri), recent 5 commits, dirty file list, and 1-click non-overwriting starter templates (`.gitignore`, `.env.example`, `README.md`, `.github/workflows/ci.yml`).
  - **Customizable DevOps Rule Library Editor:** Toggle any of the 12 built-in rules ON/OFF and add/delete custom `file_exists`, `file_contains`, or `file_absent` rules persisted in local SQLite.
- **Visual Disk Analyzer & Smart System Cleaner (`⌘4`):**
  - Parallel multi-threaded disk breakdown (`~/Library`, `~/dev`, `~/.cache` fan-out), interactive SVG category donut, drill-down explorer, Quick Wins, and macOS Full Disk Mode toggle.
  - **Smart System Cleaner:** Safe cleanup for Docker Build Cache, Unused Images, `pnpm store prune`, `npm`, `pip`, `uv`, `brew cleanup --prune=all -s`, Xcode DerivedData, old app updaters, Playwright browsers, and browser caches — with per-item freed-byte proof and Docker container/volume mutual-exclusion lock.
  - **Local AI Model Manager:** Collapsible panel scanning HuggingFace, MLX-Serve, and LM Studio weights (`Active`, `Unused`, `Incomplete`) with 2-step permanent delete confirmation.
- **Clients & Zero-Server Remote Support (`⌘5`):** Local SQLite CRM synced bidirectionally with workspace projects, plus 1-click native URI launchers for RustDesk, HopToDesk, AnyDesk, VNC, RDP, and SSH.
- **Spaceship Tactical Lidar Boot HUD & GSAP Motion:** WebGL2 GLSL Lidar grid + high-speed real-data Matrix Rain streaming live discovered project/client names while background scans finish, followed by 3D-perspective GSAP card choreography.
- **Open-Source Hardening & Documentation:** 55 Rust unit tests (`0` clippy warnings), 11 Vitest component tests, 3-OS GitHub Actions CI, SQLite WAL + schema versioning + `0600` permissions, masked IPC tokens, bilingual `README.md` / `README.tr.md`, 6 Retina showcase screenshots, `CONTRIBUTING.md`, `SECURITY.md`, and issue/PR templates.
