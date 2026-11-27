# AffeXDesk

Open-source desktop workspace manager built with Tauri 2, Rust, React, and TypeScript.

## Features

- Local SQLite persistence (`workspaces`, `project_urls`, `settings`) with WAL mode
- Lightweight native desktop shell powered by Tauri 2
- Strict Content Security Policy (CSP)
- React + TypeScript + Vite frontend with Vitest test setup

## Prerequisites

- [Node.js](https://nodejs.org/) (v20+)
- [Rust](https://www.rust-lang.org/) (stable)
- Platform prerequisites for [Tauri 2](https://v2.tauri.app/start/prerequisites/)

## Development

```bash
npm install
npm run tauri dev
```

## Verification

```bash
npx tsc --noEmit
npm test -- --run
cargo test --manifest-path src-tauri/Cargo.toml
```

## License

[MIT](./LICENSE)
