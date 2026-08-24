# 🔀 Open Git

A lightweight open-source Git GUI — **basic features only** (no AI, no PR integration).

Built with **Electron + Vue 3 + TypeScript + Pinia + simple-git** (renderer uses plain HTML/CSS — no UI framework).

## Features

- 📂 Open / Init / Clone repository (+ recent repos list)
- 📊 Interactive commit graph across all branches (custom SVG DAG renderer)
- 📝 Stage / Unstage files individually or all at once
- 🔍 Side-by-side line diff viewer (staged & working directory)
- ✍️ Commit box with `⌘↵` shortcut
- 🌿 Branch management: create, checkout, rename, delete, merge, rebase
- 🧰 Stash management: create, apply, pop, drop (including untracked files)
- 🔎 Search commits by message, author, hash, or ref (`⌘⇧F`)
- ☁️ Remote operations: Fetch all, Pull, Push (auto `--set-upstream` on first push)
- ↺ Discard working directory changes
- 🖱️ Resizable sidebar and changes panel
- ✏️ Amend last commit (auto-loads previous message)
- 🏷️ Tag management: create / delete / push tags, create tag from any commit
- 🌐 Remote management UI: add / remove / edit URLs
- 🎚️ Hunk-level partial staging (stage/unstage individual diff hunks)
- 🔎 Blame view & per-file history browser
- ⏯️ Rebase `edit` & `split` commands with pause/resume and safe rollback
- ⚗️ Git bisect assistant (start, good/bad/skip, finish)
- 🌳 Worktree management + submodule listing/updating
- 🧾 Commit details with changed-file list, per-file diff, checkout / cherry-pick / revert
- ⚡ Merge conflict resolver: take ours / theirs, mark resolved, abort or continue
- 🔀 Rebase onto branch with conflict handling (continue/abort)
- 🎛️ Interactive rebase todo editor: pick / reword / squash / fixup / drop, reorder commits (right-click a branch or commit)
- 📋 Right-click context menus on commits and branches
- 🤝 Drag & drop: commit → branch to reset, branch → branch to merge
- ⌘R Refresh repository shortcut

## Build a macOS app (.dmg)

```bash
pnpm dist
# → release/Open Git-<version>-arm64.dmg
```

## Run

Requires [pnpm](https://pnpm.io) (v10+):

```bash
pnpm install
pnpm approve-builds electron esbuild   # allow postinstall scripts (first time only)
pnpm dev                               # development (hot reload)
pnpm build                             # production build
npx electron .                         # run the built app
```

## Project structure

```
src/
├── main/           # Electron main process
│   ├── index.ts    # Window + IPC handlers
│   └── git.ts      # All git logic (simple-git)
├── preload/        # contextBridge API (window.api)
├── shared/         # Shared types
└── renderer/       # React UI
    └── src/components/
        ├── Welcome.tsx    # Open/Init/Clone screen
        ├── Toolbar.tsx    # Fetch/Pull/Push bar
        ├── Sidebar.tsx    # Branches panel
        ├── GraphView.tsx  # Commit graph (SVG)
        ├── FilePanel.tsx  # Staging + commit box
        └── DiffView.tsx   # Diff viewer
```

## Notes

- Requires system `git` in PATH.
- The graph auto-refreshes every 5 seconds.
