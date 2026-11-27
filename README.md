# AffeXDesk

**Open-Source Developer & Founder Mission Control** — built with **Tauri 2**, **Rust**, **React 19**, **TypeScript**, **Three.js (WebGL2)**, **GSAP**, and local **SQLite**.

[![License: MIT](https://img.shields.io/badge/License-MIT-10b981.svg)](./LICENSE)
[![Tauri 2](https://img.shields.io/badge/Tauri-2.x-38bdf8.svg)](https://v2.tauri.app/)
[![Rust](https://img.shields.io/badge/Rust-Stable-f59e0b.svg)](https://www.rust-lang.org/)
[![React 19](https://img.shields.io/badge/React-19-61dafb.svg)](https://react.dev/)
[![Platforms](https://img.shields.io/badge/Platforms-macOS%20%7C%20Windows%20%7C%20Linux-71717a.svg)](#installation--development)

> Zero cloud lock-in. Zero hardcoded paths. Zero telemetry sent off your machine.  
> Everything runs natively on your workstation with strict safety guards and a sharp, flat near-black granite interface.

---

## Why AffeXDesk?

Developers and indie founders juggle dozens of local repositories, zombie dev servers, hundreds of gigabytes of hidden caches (`Docker.raw`, `node_modules`, Rust `target/`, HuggingFace / MLX weights), client remote-support IDs, and local AI workflows across ten different terminal windows.

**AffeXDesk** unifies them into a single **18 MB native desktop mission control**:

### Core Modules

- **Live Hardware Telemetry & Process Control (`⌘1` / `⌘2`)**
  - Real-time CPU, RAM pressure, primary disk capacity, thermal state, and uptime ribbon across every view.
  - Developer process scanner with port detection (`lsof` / `netstat`), zombie process flagging, and safe termination with protected-PID guards.
- **Workspace & Project Hub (`⌘3`)**
  - Multi-workspace discovery across JS/TS, Rust/Tauri, Python, Go, Java, PHP, Flutter, Swift, and Docker projects.
  - Live Git branch, dirty file count, last commit, inline live URL uptime checks, and **one-click allowlisted cache cleanup** (`node_modules`, `target`, `.next`, `dist`, `.venv`, `__pycache__`) with clickable Finder links on every cache chip.
- **Visual Disk Analyzer & Smart System Cleaner (`⌘4`)**
  - Parallel multi-threaded disk breakdown with interactive SVG category donut, drill-down explorer, Quick Wins, and macOS Full Disk Mode toggle.
  - **Smart System Cleaner:** CleanMyMac-style safe cleanup for Docker Build Cache, Unused Images, `pnpm store prune`, `npm`, `pip`, `uv`, `brew cleanup --prune=all -s`, Xcode DerivedData, old app updaters, Playwright browsers, and browser HTTP caches — with per-item freed-byte reporting and mutual-exclusion safety locks for Docker containers/volumes.
  - **Local AI Model Manager:** Scans HuggingFace, MLX-Serve, and LM Studio weights, labeling `Active`, `Unused`, and `Incomplete` artifacts with 2-step permanent delete confirmation.
- **Clients & Zero-Server Remote Support (`⌘5`)**
  - Local SQLite CRM (`clients` & `client_projects` with `ON DELETE CASCADE`) synced bidirectionally with local workspace projects.
  - One-click native URI launcher for **RustDesk**, **HopToDesk**, **AnyDesk**, **VNC**, **RDP**, and **SSH** — plus ready-to-copy client invite templates.
- **Git / Repos, Knowledge Hub & Studio DevOps (`⌘6`–`⌘8`)**
  - Local repo creation, GitHub/GitLab integration (with masked IPC tokens), local knowledge hub search, `.env` secret hygiene scanner, Docker container controls, and creative media cache inspection.
- **Tactical Lidar Boot HUD & GSAP Motion (`Three.js WebGL2 + GSAP`)**
  - Real-time WebGL2 GLSL Lidar grid + live Matrix data rain streaming your actual discovered project & client names while background scans complete (click / `ESC` to skip anytime; WebGL context fully disposed after reveal for 0% idle GPU).
- **Local AI Copilot Drawer (`⌘K`)**
  - Connects to any OpenAI-compatible local server (MLX-Serve, Ollama, LM Studio) with offline fallback actions.

---

## Security & Safety Architecture

AffeXDesk is engineered around **zero-trust local safety**:

- **Protected Path Guards:** Root OS directories, user home roots (`Desktop`, `Documents`, `Library`, `dev`, `.ssh`, `.gnupg`, `com.docker.docker`, `/opt/homebrew`), symlinks, and `.git` directories are hard-blocked from deletion.
- **Allowlisted Project Cleanup:** Project card cleanup only ever targets regenerated build/dependency folders (`node_modules`, `target`, `.next`, `dist`, `.turbo`, `.venv`, `venv`, `__pycache__`, `.pytest_cache`).
- **2-Step Permanent Delete:** Irreversible deletions require an explicit two-step confirmation dialog (defaulting focus to Cancel on each step).
- **Local SQLite Hardening:** WAL mode, versioned schema migrations (`PRAGMA user_version`) with pre-migration backups, Unix `0600` database file permissions, and masked credential IPC (`__CONFIGURED__`).
- **Strict CSP:** Tight Content Security Policy configured in [tauri.conf.json](./src-tauri/tauri.conf.json).

---

## Keyboard Shortcuts

| Shortcut | Action |
| :--- | :--- |
| `⌘1` – `⌘9` *(or `Alt+1`–`9`)* | Switch between Overview, Processes, Projects, Disk Analyzer, Clients, Git, Knowledge, Studio & Settings |
| `⌘K` *(or `Ctrl+K`)* | Toggle AI Copilot Drawer |
| `ESC` | Close active dialog / skip Boot HUD |

---

## Installation & Development

### Prerequisites

- **Node.js** `v20+`
- **Rust** (stable toolchain via `rustup`)
- Platform prerequisites for [Tauri 2](https://v2.tauri.app/start/prerequisites/)

### Run Locally

```bash
git clone https://github.com/hazarvolga/AffeXDesk.git
cd AffeXDesk
npm install
npm run tauri dev
```

### Build Production Bundle

```bash
npm run tauri build
```

### Verification & Test Suite

```bash
# TypeScript & React component tests (Vitest)
npx tsc --noEmit
CI=true npm test

# Rust static analysis & unit tests (53 tests)
cd src-tauri
cargo clippy --all-targets -- -D warnings
cargo test
```

---

## Architecture Overview

```text
AffeXDesk/
├── src/                        # React 19 + TypeScript + Vite frontend
│   ├── components/             # Modular views (Overview, Processes, Projects, DiskAnalyzer,
│   │                           # SmartCleaner, Clients, Git, Knowledge, StudioDevOps, BootSplash)
│   └── lib/                    # Typed Tauri IPC bridge & formatters
├── src-tauri/src/              # Native Rust backend
│   ├── telemetry/              # Lightweight sysinfo CPU/RAM/disk/thermal collector
│   ├── processes/              # Dev process & port scanner with protected PID list
│   ├── workspace/              # Multi-stack project discovery & allowlisted cleaner
│   ├── disk_analyzer/          # Parallel fan-out disk scanner, AI model manager & safe Trash/Delete
│   ├── cleaner/                # Smart System Cleaner (Docker, pnpm, npm, pip, uv, brew, Xcode)
│   ├── clients/                # Local CRM & zero-server remote support URI launcher
│   ├── db/                     # SQLite WAL persistence, versioned migrations & backups
│   └── ai_copilot/             # Local LLM drawer bridge & offline action planner
└── .github/workflows/ci.yml    # 3-OS CI (macOS, Ubuntu, Windows)
```

---

## Contributing & Security

- Contributions are welcome! Please read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening a pull request.
- To report a security vulnerability, please follow [SECURITY.md](./SECURITY.md).

## License

Released under the [MIT License](./LICENSE).
