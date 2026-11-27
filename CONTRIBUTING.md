# Contributing to AffeXDesk

Thank you for considering contributing to **AffeXDesk**! We welcome bug reports, feature proposals, documentation improvements, and pull requests.

## Core Principles

1. **Cross-Platform & Zero Hardcoding:** Never hardcode personal paths, usernames, hostnames, or OS-specific assumptions without proper `cfg!(target_os = ...)` handling.
2. **Safety First:** Any file-deletion, process-termination, or Docker/package-manager cleanup code must enforce strict allowlists, symlink checks, and confirmation dialogs.
3. **Privacy by Default:** Never introduce telemetry, external analytics, or plaintext secret logging. Keep credentials masked across the IPC boundary.

## Development Setup

```bash
npm install
npm run tauri dev
```

## Before Opening a Pull Request

Please verify all checks pass locally:

```bash
npx tsc --noEmit
CI=true npm test
cd src-tauri && cargo clippy --all-targets -- -D warnings && cargo test
```

## Pull Request Guidelines

- Keep PRs focused on a single feature or bug fix.
- Include unit or component tests for new backend safety rules or UI workflows.
- Use clear, conventional commit messages (`feat(...)`, `fix(...)`, `perf(...)`, `docs(...)`).
