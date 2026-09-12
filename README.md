<div align="center">

# 🔀 git-cano

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
| 🧩  | **Workspaces** — group repos, each remembers its own tabs & active repo; drag rows to reorder |
| 💾  | Session & recent-repo restore on startup                                |
| 🔗  | "Open in" → Folder, Terminal, VS Code (plus Kiro / Visual Studio / Rider when installed) — also in the command palette |

### 📊 History & Changes

|     |                                                             |
| --- | ----------------------------------------------------------- |
| 🌌  | Interactive commit graph (custom SVG renderer)              |
| 🏷️  | Hover a commit node — branch/tag chips (tags first, then remote before local per branch), author avatar, email & time |
| ⭕  | Selected commit node — static double ring + soft glow in the lane color, no distracting animation |
| 📏  | Commits with 5+ ref chips get a taller two-line row (chips above the message) |
| 💬  | Full-message popover — subject emphasized with author/date/hash header |
| 🔝  | To-top button — jump back to the top after deep scrolling (commit graph & diff view) |
| 🟢  | Selecting a commit flips the right panel to **Committed History** — green-tinted header & title, clearly distinct from working-dir Changes |
| 🎯  | **Solo a branch** — focus on one branch, unsolo to restore; files the soloed branch never touched fade in Changes |
| 🔍  | Search by message, author, hash, or ref                     |
| 🧺  | Stage/unstage files — or single diff hunks                  |
| ✅  | Commit & amend with a friendly title-length counter — risky actions (commit, revert, rebase, cherry-pick, merge, reset, squash, stash delete) offer timed Undo |
| 🟣  | Squash a HEAD range — `Shift+click` a range in the graph, right-click to squash N into 1 (skipping is impossible by design) |
| ↔️  | Unified / side-by-side diffs with word-level change highlights (syntax colors stay true — add/del rows carry an accent bar), image diffs, binary detection |
| 🕵️  | Blame view & per-file history — hover any line number in the diff for instant authorship (blame lens) |
| 🕰️  | Reflog viewer — timeline of every HEAD move with per-action colors, restore any entry (undoable) |

### 🌿 Branches, Tags & Remotes

|      |                                                        |
| ---- | ------------------------------------------------------ |
| 🌱   | Create / checkout / rename / delete / merge / rebase — drag a branch onto a branch to merge, drag a commit onto a branch to cherry-pick |
| 🏷️   | Tag create / delete / push                             |
| 🌐   | Remotes: add, edit, remove, test URLs                  |
| ⬇️⬆️ | Fetch / pull / push (SSH key or GitHub token) — buttons show an inline spinner while busy |
| 📦   | Stashes, worktrees, submodules, bisect assistant       |
| 🧩   | Conflict resolver — per-line picks + manual edit, side buttons show branch/hash, conflicts jump back to Changes |

### 🤖 AI Commit Messages _(optional)_

> 🪄 Let AI write the boring part!

- 🔌 OpenCode Go or OpenRouter providers
- 📝 Generate from **staged** changes, or auto-commit / auto-commit + push
- 👁️ Commit box shows the active model + auto-commit mode inline (green / orange / red dot, full name in tooltip)
- ⚡ `minimal` reasoning effort = fast responses
- 🎨 Optional auto-format before generating

### 🎨 Themes & branding

- 🌑 Dark / Dark Modern / Dark Neon, 💻 Terminal TUI (square corners, scanlines, dusty-navy palette), ☀️ Light
- 🖌️ Commit-graph lane colors adapt per theme
- 🛶 Cano logo in the sidebar toolbar, splash screen & empty state

### 🔔 Calm, non-blocking feedback

- ⏳ Transient toasts auto-dismiss (default **10s**, change it in Settings → General → Notifications) — the dismiss button shows a live **countdown ring**, and hovering a toast pauses its timer.
- 🔴 Failures interrupt with a focused dialog instead of a fleeting toast.
- ↩️ Risky actions (commit, revert, rebase, cherry-pick, merge, reset, squash, stash delete) offer a **timed Undo**.

### 🐇 Feels fast

- ⚡ Local data loads first — the repo is usable immediately
- 🌙 Remote tags load **in the background**, never block you
- 🔄 Workspace switches reuse open repos (no double `git status`)
- 🦥 Big repo? Optional `fsmonitor` + untracked cache in Settings → General

## ⌨️ Shortcuts

> 💡 macOS accepts both `⌘` and `Ctrl`. Press <kbd>?</kbd> in the app for the full list!

<details>
<summary><b>Click to expand the cheat sheet 📋</b></summary>

| Action                   | macOS 🍎              | Windows 🪟               |
| ------------------------ | --------------------- | ------------------------ |
| 🔄 Fetch                 | `Ctrl+Shift+↓`        | `Ctrl+Shift+↓`           |
| ⬇️ Pull                  | `Ctrl+↓`              | `Ctrl+↓`                 |
| ⬆️ Push                  | `Ctrl+↑`              | `Ctrl+↑`                 |
| 📁 Open repo             | `Ctrl+O`              | `Ctrl+O`                 |
| 📥 Clone repo            | `Ctrl+N`              | `Ctrl+N`                 |
| ❎ Close tab             | `Ctrl+W`              | `Ctrl+W`                 |
| 🔍 Search commits        | `⌘F`                  | `Ctrl+F`                 |
| ⚙️ Settings              | `Ctrl+,`              | `Ctrl+,`                 |
| ✨ Command palette       | `Ctrl+P` / `Shift×2`  | `Ctrl+P` / `Shift×2`     |
| ⌨️ Show shortcuts        | `?`                   | `?`                      |
| ✅ Commit                | `⌘↵`                  | `Ctrl+↵`                 |
| ❌ Close / cancel        | `Esc`                 | `Esc`                    |
| 🔎 Zoom in / out / reset | `⌘=` / `⌘-` / `⌘0`    | `Ctrl+=` / `Ctrl+-` / `Ctrl+0` |

> ✏️ Fetch, Pull, Push, Open repo, Clone repo, Search commits, Open settings and Command palette are customizable per platform (macOS / Windows) in Settings → Shortcuts (persisted, with a Default button).

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
- 📦 Releases ship as macOS `.dmg` (arm64) → `release/` via `pnpm dist:mac`, and Windows portable `git-cano-<version>-portable.exe` via `pnpm dist:win` (asar + maximum compression).
- 🤖 Building with AI? Read [AGENTS.md](AGENTS.md) first!
