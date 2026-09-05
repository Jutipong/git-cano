<div align="center">

# 🔀 Open Git

### Everyday Git, without the clutter ✨

A lightweight, open-source Git GUI for **Windows & macOS** — review history 📊, stage changes 🧺, manage branches 🌿, and commit ✅, all in one calm place.

[![Electron](https://img.shields.io/badge/Electron-44-47848F?logo=electron&logoColor=white)](https://www.electronjs.org)
[![Vue 3](https://img.shields.io/badge/Vue-3-4FC08D?logo=vuedotjs&logoColor=white)](https://vuejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-6-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![pnpm](https://img.shields.io/badge/pnpm-10-F69220?logo=pnpm&logoColor=white)](https://pnpm.io)

</div>

---

## 🚀 Quick Start

**Need:** [Node.js](https://nodejs.org) 🟢 · [pnpm](https://pnpm.io) 10+ 📦 · Git in `PATH` 🌿

```bash
# 1️⃣ Install dependencies
pnpm install

# 2️⃣ Allow build scripts (first time only)
pnpm approve-builds electron esbuild

# 3️⃣ Run it! (hot reload 🔥)
pnpm dev
```

> 🎉 That's it — pick a repository and start exploring!

## ✨ What can it do?

### 📂 Repositories & Workspaces

|     |                                                                         |
| --- | ----------------------------------------------------------------------- |
| 📁  | Open, initialize & clone repositories                                   |
| 🗂️  | Multiple repos open at once as tabs                                     |
| 🧩  | **Workspaces** — group repos, each remembers its own tabs & active repo |
| 💾  | Session & recent-repo restore on startup                                |
| 🔗  | "Open in" → Explorer/Finder, Terminal, VS Code                          |

### 📊 History & Changes

|     |                                                             |
| --- | ----------------------------------------------------------- |
| 🌌  | Interactive commit graph (custom SVG renderer)              |
| 🎯  | **Solo a branch** — focus on one branch, unsolo to restore  |
| 🔍  | Search by message, author, hash, or ref                     |
| 🧺  | Stage/unstage files — or single diff hunks                  |
| ✅  | Commit & amend with a friendly title-length counter         |
| ↔️  | Unified / side-by-side diffs, image diffs, binary detection |
| 🕵️  | Blame view & per-file history                               |

### 🌿 Branches, Tags & Remotes

|      |                                                        |
| ---- | ------------------------------------------------------ |
| 🌱   | Create / checkout / rename / delete / merge / rebase   |
| 🏷️   | Tag create / delete / push                             |
| 🌐   | Remotes: add, edit, remove, test URLs                  |
| ⬇️⬆️ | Fetch / pull / push (SSH key or GitHub token)          |
| 📦   | Stashes, worktrees, submodules, bisect assistant       |
| 🧩   | Merge-conflict resolver — per-line picks + manual edit |

### 🤖 AI Commit Messages _(optional)_

> 🪄 Let AI write the boring part!

- 🔌 OpenCode Go or OpenRouter providers
- 📝 Generate from **staged** changes, or auto-commit / auto-commit + push
- ⚡ `minimal` reasoning effort = fast responses
- 🎨 Optional auto-format before generating

### 🐇 Feels fast

- ⚡ Local data loads first — the repo is usable immediately
- 🌙 Remote tags load **in the background**, never block you
- 🔄 Workspace switches reuse open repos (no double `git status`)
- 🦥 Big repo? Optional `fsmonitor` + untracked cache in Settings → General

## ⌨️ Shortcuts

> 💡 macOS accepts both `⌘` and `Ctrl`. Press <kbd>?</kbd> in the app for the full list!

<details>
<summary><b>Click to expand the cheat sheet 📋</b></summary>

| Action                   | macOS 🍎           | Windows 🪟                     |
| ------------------------ | ------------------ | ------------------------------ |
| ⬇️ Pull                  | `Ctrl+L` / `⌘↓`    | `Ctrl+L` / `Alt+↓`             |
| ⬆️ Push                  | `Ctrl+P` / `⌘↑`    | `Ctrl+P` / `Alt+↑`             |
| 🔄 Fetch                 | `Ctrl+F`           | `Ctrl+F`                       |
| 📁 Open repo             | `Ctrl+O`           | `Ctrl+O`                       |
| ⚙️ Settings              | `Ctrl+,`           | `Ctrl+,`                       |
| ✨ Refresh               | `⌘R`               | `Ctrl+R`                       |
| 🔍 Search commits        | `⌘⇧F`              | `Ctrl+Shift+F`                 |
| ➕ New tab               | `⌘⇧P`              | `Ctrl+Shift+P`                 |
| ✅ Commit                | `⌘↵`               | `Ctrl+↵`                       |
| ❌ Close / cancel        | `Esc`              | `Esc`                          |
| 🔎 Zoom in / out / reset | `⌘=` / `⌘-` / `⌘0` | `Ctrl+=` / `Ctrl+-` / `Ctrl+0` |

</details>

## 🛠️ Commands

| Command          | What it does 📌                         |
| ---------------- | --------------------------------------- |
| `pnpm dev`       | 🔥 Dev mode with hot reload             |
| `pnpm build`     | 📦 Production build                     |
| `pnpm typecheck` | 🔍 Type checking (vue-tsc + tsc)        |
| `pnpm lint`      | 🧹 oxlint + vue-tsc                     |
| `pnpm format`    | 💅 Format with oxfmt                    |
| `pnpm dist:mac`  | 🍎 macOS `.dmg` → `release/`            |
| `pnpm dist:win`  | 🪟 Windows portable `.exe` → `release/` |

## 🗂️ How it's organized

```text
src/
├── 🖥️ main/              # Electron main process + ALL git operations
│   ├── index.ts       #   Window + IPC handlers
│   ├── git.ts         #   Git logic (simple-git)
│   └── opencode.ts    #   AI commit-message generation
├── 🌉 preload/           # Secure window.api bridge
├── 📦 shared/            # Shared types + graph helpers
└── 🎨 renderer/src/
    ├── components/    # Vue SFCs — one per panel / modal / menu
    ├── stores/        # Pinia: repo, workspace, ui, sync, ai, feedback
    ├── utils/         # Formatting, shortcuts, dialogs
    ├── styles.css     # Base styles
    └── modern-ui.css  # Modern UI overrides ✨
```

> 🔒 **Golden rule:** Git never runs in the renderer — everything flows
> `component → window.api → main process → simple-git`.

## 📝 Good to know

- 🌙 Remote tag status needs `origin` + network — it loads in the background on purpose.
- 🤖 Building with AI? Read [AGENTS.md](AGENTS.md) first!
