<div align="center">

# 🔀 Open Git

**A lightweight, open-source Git GUI — everyday Git, without the clutter.**

[![Electron](https://img.shields.io/badge/Electron-44-47848F?logo=electron&logoColor=white)](https://www.electronjs.org)
[![Vue 3](https://img.shields.io/badge/Vue-3-4FC08D?logo=vuedotjs&logoColor=white)](https://vuejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-6-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![pnpm](https://img.shields.io/badge/pnpm-10-F69220?logo=pnpm&logoColor=white)](https://pnpm.io)
[![License](https://img.shields.io/badge/license-open--source-blue)](#)

</div>

---

Open Git is a desktop Git client for **Windows and macOS** built on
**Electron + Vue 3 + TypeScript + Pinia + simple-git**. It focuses on the
workflow you do every day — review history, stage changes, manage branches and
tags, and commit — while network-bound operations (like remote tags) load in
the background so a slow remote never blocks the UI.

## ✨ Features

### 📂 Repositories & Workspaces

- Open, initialize, and clone repositories
- Multiple repositories open at once as tabs
- **Workspaces** — group repos into named workspaces, each remembering its own tabs & active repo
- Session & recent-repo restore on startup
- "Open in" menu → Explorer/Finder, Terminal, VS Code

### 📊 History & Changes

- Interactive commit graph (custom SVG DAG renderer)
- Search commits by message, author, hash, or ref
- Stage/unstage files — or individual diff hunks
- Commit & amend with a soft title-length counter
- Unified / side-by-side diffs, image diffs, binary detection
- Blame view & per-file history

### 🌿 Branches, Tags & Remotes

- Create / checkout / rename / delete / merge / rebase branches
- Tag create / delete / push
- Remote management: add, edit, remove, test URLs
- Fetch / pull / push with SSH key or GitHub token auth
- Stashes, worktrees, submodules, Git bisect assistant
- Merge-conflict resolver with per-line picks and manual editing

### 🤖 AI Commit Messages _(optional)_

- OpenCode Go or OpenRouter providers
- Generate from **staged** changes, or auto-commit / auto-commit + push from all working changes
- Reasoning-effort `minimal` for fast responses
- Optional auto-format before generating

### ⚡ Fast Loading

| Operation        | Behavior                                                                                     |
| ---------------- | -------------------------------------------------------------------------------------------- |
| Repo switch      | Local data (status, log, branches, tags) loads first — repo is usable immediately            |
| Remote tags      | Loaded **in the background** via a separate git instance — never blocks switching            |
| TAGS section     | Shows `Loading tags…` / `Loading remote tags…` while data is in flight                       |
| Workspace switch | Repos shared between workspaces stay open; `git status` is not run twice for the active repo |
| Large worktrees  | Optional `fsmonitor` + untracked cache (Settings → General)                                  |

## ⌨️ Keyboard Shortcuts

macOS accepts both `⌘` and `Ctrl` for Ctrl-based shortcuts.
Press <kbd>?</kbd> in the app to see the full list.

| Action                | macOS              | Windows                        |
| --------------------- | ------------------ | ------------------------------ |
| Pull                  | `Ctrl+L` / `⌘↓`    | `Ctrl+L` / `Alt+↓`             |
| Push                  | `Ctrl+P` / `⌘↑`    | `Ctrl+P` / `Alt+↑`             |
| Fetch                 | `Ctrl+F`           | `Ctrl+F`                       |
| Open repository       | `Ctrl+O`           | `Ctrl+O`                       |
| Settings              | `Ctrl+,`           | `Ctrl+,`                       |
| Refresh               | `⌘R`               | `Ctrl+R`                       |
| Search commits        | `⌘⇧F`              | `Ctrl+Shift+F`                 |
| New tab               | `⌘⇧P`              | `Ctrl+Shift+P`                 |
| Commit (from box)     | `⌘↵`               | `Ctrl+↵`                       |
| Close / cancel        | `Esc`              | `Esc`                          |
| Zoom in / out / reset | `⌘=` / `⌘-` / `⌘0` | `Ctrl+=` / `Ctrl+-` / `Ctrl+0` |

## 🚀 Getting Started

### Requirements

- [Node.js](https://nodejs.org)
- [pnpm](https://pnpm.io) 10+
- Git available in `PATH`

### Install & run

```bash
# 1. Install dependencies
pnpm install

# 2. Allow build scripts (first time only)
pnpm approve-builds electron esbuild

# 3. Start development (hot reload)
pnpm dev
```

### Commands

| Command          | Description                          |
| ---------------- | ------------------------------------ |
| `pnpm dev`       | Development with hot reload          |
| `pnpm build`     | Production build                     |
| `npx electron .` | Run the built app                    |
| `pnpm typecheck` | vue-tsc + tsc type checking          |
| `pnpm lint`      | oxlint + vue-tsc                     |
| `pnpm dist:win`  | Windows portable `.exe` → `release/` |
| `pnpm dist:mac`  | macOS `.dmg` → `release/`            |

## 🗂️ Project Structure

```text
src/
├── main/              # Electron main process + all git operations
│   ├── index.ts       #   Window + IPC handlers
│   ├── git.ts         #   Git logic (simple-git)
│   └── opencode.ts    #   AI commit-message generation
├── preload/           # Secure window.api bridge (contextBridge)
├── shared/            # Shared types + graph lane helpers
└── renderer/src/
    ├── components/    # Vue SFCs — one per panel / modal / context menu
    ├── stores/        # Pinia stores (repo, workspace, ui, sync, ai, feedback)
    ├── utils/         # Formatting, shortcuts, dialogs
    ├── styles.css     # Base styles
    └── modern-ui.css  # Modern UI overrides
```

## 📝 Notes

- Git operations **never** run in the renderer — everything goes through
  `window.api` → Electron main process → simple-git.
- Remote tag status depends on the repository's `origin` and network access.
  It is intentionally background-loaded so slow remotes don't block the app.
- Development guidance for AI agents lives in [AGENTS.md](AGENTS.md).
