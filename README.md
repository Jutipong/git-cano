# 🔀 Open Git

A lightweight open-source Git GUI — **basic features first**, with optional AI-generated
commit messages (no PR integration).

Built with **Electron + Vue 3 + TypeScript + Pinia + simple-git** (renderer uses plain HTML/CSS — no UI framework).

## Features

### Repos & history

- 📂 Open / Init / Clone repository (+ recent repos list, session restore)
- 💼 **Workspaces**: group repositories into named workspaces, each remembering
  its own open tabs & active repo (switch from the sidebar workspace button)
- 🗂️ Multiple repositories open at once as tabs (capsule tab bar with a green `+`)
  — right-click a tab to rename/close it or set a **custom tab color** via the
  native color picker
- 📊 Interactive commit graph across all branches (custom SVG DAG renderer)
  with configurable columns (author / hash / date) and a custom date format
  (gear icon in the graph toolbar)
- 🔎 Search commits by message, author, hash, or ref (`⌘⇧F`) — search lives
  in the graph toolbar
- ⏱️ Auto-refresh every minute · instant refresh on window focus or external
  repo changes · manual refresh with `⌘R`
- ⚡ Fast refreshes: optional git worktree caching (fsmonitor + untracked cache,
  toggled in Settings → General) and virtualized rendering for large diffs

### Changes panel (right)

- 📝 Stage / unstage files individually or all at once
- ✍️ Commit box with `⌘↵` shortcut and a soft title-length counter
  (≤50 ideal / ≤72 hard cap per convention — warns, never blocks)
- ↺ Discard working-directory changes
- 🧾 Select any commit in the graph → the panel switches to that commit's
  changed files with per-file `+/−` stats and the total in the header
- 📋 Hash chip copies the full commit hash to the clipboard
- 📄 Readonly message view showing title + body with an author · date chip

### AI commit messages (optional)

- 🤖 One-click AI commit-message generation from the Changes panel — configure a
  provider (OpenCode Go or OpenRouter), token, and model in Settings → AI
- 🎯 Three modes next to the generate button: **Generate only**, **auto commit**,
  and **auto commit + push** (auto modes stage everything, then commit)
- 🎚️ Context matches what will be committed: Generate only summarizes the
  **staged** diff; auto-commit modes summarize **all** working-directory changes
  (staged + unstaged + untracked)
- ⚡ Requests run with reasoning-effort `minimal` (falls back to `low` → no
  reasoning param for models that don't support it) so thinking models answer fast
  instead of running out of output tokens
- ↺ Optional auto-format before generating (formatter toggle in Settings → AI)

### Diff viewing

- 🔍 Diff overlay opens as a floating card over the tab bar + sidebar + graph when
  you click a file row (the Changes panel stays interactive for switching files)
- ↔️ Unified & side-by-side modes (remembered between sessions)
- 🖼️ Image diffs and binary-file detection
- ⛶ Fullscreen toggle for distraction-free review

### Branches, remotes & advanced

- 🌿 Branch management: create, checkout, rename, delete, merge, rebase
- 🏷️ Tag management: create / delete / push tags, create tag from any commit
  (with an optional push-to-origin right from the create dialog)
- 🌐 Remote management UI: add / remove / edit URLs; fetch all, pull, push
  (auto `--set-upstream` on first push) — sync buttons sit at the top of the sidebar,
  settings & theme toggle at the bottom
- 🔑 SSH key management in Settings → Remotes: generate key pairs, list/delete
  keys in `~/.ssh`, copy public keys, and test keys against the repo's remote
  (including custom hosts)
- 🎛️ Hunk-level partial staging (stage/unstage individual diff hunks)
- 🔎 Blame view & per-file history browser
- 🧰 Stash management: create, apply, pop, drop (including untracked files)
- ⏯️ Rebase `edit` & `split` commands with pause/resume and safe rollback
- ⚗️ Git bisect assistant (start, good/bad/skip, finish)
- 🌳 Worktree management + submodule listing/updating
- ⚡ Merge conflict resolver: take ours / theirs, mark resolved, abort/continue —
  with **per-line picks**, whole-block selection, "use block" pills, select-all,
  and direct manual editing of the resolved output
- 🔀 Rebase onto branch with conflict handling (continue/abort)
- 🎛️ Interactive rebase todo editor: pick / reword / squash / fixup / drop,
  reorder commits (right-click a branch or commit)

### Appearance & apps

- 🎨 Four themes: Dark, Dark Modern, Dark Neon, Light — plus UI font size and
  display zoom settings (appearance settings are resettable to defaults)
- 🔍 Zoom the whole app with `⌃/⌘ +`, `−`, `0`, or Ctrl/⌘ + mouse wheel
- 📤 "Open in" menu: open the active repo in **Finder/Explorer**, **Terminal**,
  or **VS Code**
- 🏷️ App version shown in the sidebar
- ⏳ Busy card with animated indicator while git operations run, plus loading
  indicators on commit details and diff views

### Interactions

- 📋 Per-feature right-click context menus: commits, local & remote branches,
  tags, stashes, files, and repo tabs (each with its own dedicated menu component)
- 🤝 Drag & drop: commit → branch to reset, branch → branch to merge
- 🖱️ Resizable sidebar, right pane, and summary box (sizes persist)
- 💬 Toasts for feedback; errors open a modal dialog (ESC / ✕ / Close to dismiss)

## ⌨️ Keyboard shortcuts

Shortcuts differ slightly per platform — macOS accepts both `⌘` and `Ctrl`.
Press `?` inside the app (outside a text field) to open the shortcuts help modal.

| Action                              | macOS              | Windows                 |
| ----------------------------------- | ------------------ | ----------------------- |
| Pull                                | `Ctrl+L` or `⌘↓`   | `Ctrl+L` or `Alt+↓`     |
| Push                                | `Ctrl+P` or `⌘↑`   | `Ctrl+P` or `Alt+↑`     |
| Fetch                               | `Ctrl+F`           | `Ctrl+F`                |
| Open repo (new tab)                 | `Ctrl+O`           | `Ctrl+O`                |
| Open settings                       | `Ctrl+,`           | `Ctrl+,`                |
| Refresh repository                  | `⌘R`               | `Ctrl+R`                |
| Search commits                      | `⌘⇧F`              | `Ctrl+Shift+F`          |
| Open new tab                        | `⌘⇧P`              | `Ctrl+Shift+P`          |
| Commit (from commit box)            | `⌘↵`               | `Ctrl+↵`                |
| Show shortcuts modal                | `?`                | `?`                     |
| Zoom app in / out / reset           | `⌘=` / `⌘-` / `⌘0` | `Ctrl+` `=` / `-` / `0` |
| Zoom with mouse wheel               | `⌘ + wheel`        | `Ctrl + wheel`          |
| Close diff / deselect / close modal | `Esc`              | `Esc`                   |

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
│   ├── git.ts      # All git logic (simple-git)
│   └── opencode.ts # AI commit-message generation (OpenCode Go / OpenRouter APIs)
├── preload/        # contextBridge API (window.api)
├── shared/         # Shared types
├── docs/           # Architecture notes (commit-graph.md)
└── renderer/
    ├── index.html
    └── src/
        ├── components/   # Vue SFCs, one per panel/modal
        │   ├── Welcome.vue        # Open/Init/Clone screen
        │   ├── TabBar.vue         # Repository tabs (capsule bar, colors)
        │   ├── WorkspaceButton.vue # Workspace switcher (per-workspace sessions)
        │   ├── Sidebar.vue        # Sync actions, workspaces, branches, stashes
        │   ├── GraphView.vue      # Commit graph (SVG) + commit search
        │   ├── FilePanel.vue      # Changes panel + commit box
        │   ├── DiffView.vue       # Diff overlay viewer (virtualized)
        │   ├── ConflictView.vue   # Merge conflict resolver
        │   ├── ToolsModal.vue     # Settings (appearance/general/remotes/hook/AI)
        │   ├── ShortcutsModal.vue # Keyboard shortcuts help (? key)
        │   └── ...                # Modals & per-feature context menus
        ├── stores/       # Pinia stores (repo, ui, workspace, sync, ai, transient feedback)
        ├── utils/        # Shared helpers (formatting, shortcuts, dialogs)
        │   └── shortcuts.ts # Single source of truth for keyboard shortcuts
        ├── styles.css    # Global stylesheet (base)
        └── modern-ui.css # Modern theme overrides (palette, radii, pills)
```

## Notes

- Requires system `git` in PATH.
- The graph auto-refreshes every minute and instantly on focus/external changes.
- Agent guidance lives in [AGENTS.md](AGENTS.md).
