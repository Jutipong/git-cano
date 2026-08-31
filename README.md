# 🔀 Open Git

A lightweight open-source Git GUI — **basic features first**, with optional AI-generated
commit messages (no PR integration).

Built with **Electron + Vue 3 + TypeScript + Pinia + simple-git** (renderer uses plain HTML/CSS — no UI framework).

## Features

### Repos & history

- 📂 Open / Init / Clone repository (+ recent repos list, session restore)
- 🗂️ Multiple repositories open at once as tabs (capsule tab bar with a green `+`)
- 📊 Interactive commit graph across all branches (custom SVG DAG renderer)
- 🔎 Search commits by message, author, hash, or ref (`⌘⇧F`) — search lives
  in the graph toolbar
- ⏱️ Auto-refresh every minute · instant refresh on window focus or external
  repo changes · manual refresh with `⌘R`

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
- 🌐 Remote management UI: add / remove / edit URLs; fetch all, pull, push
  (auto `--set-upstream` on first push) — sync buttons sit at the top of the sidebar,
  settings & theme toggle at the bottom
- 🎛️ Hunk-level partial staging (stage/unstage individual diff hunks)
- 🔎 Blame view & per-file history browser
- 🧰 Stash management: create, apply, pop, drop (including untracked files)
- ⏯️ Rebase `edit` & `split` commands with pause/resume and safe rollback
- ⚗️ Git bisect assistant (start, good/bad/skip, finish)
- 🌳 Worktree management + submodule listing/updating
- ⚡ Merge conflict resolver: take ours / theirs, mark resolved, abort/continue
- 🔀 Rebase onto branch with conflict handling (continue/abort)
- 🎛️ Interactive rebase todo editor: pick / reword / squash / fixup / drop,
  reorder commits (right-click a branch or commit)

### Interactions

- 📋 Right-click context menus on commits and branches
  (checkout, cherry-pick, revert, reset, create branch/tag here)
- 🤝 Drag & drop: commit → branch to reset, branch → branch to merge
- 🖱️ Resizable sidebar, right pane, and summary box (sizes persist)
- ⌨️ Shortcuts: `⌘R` refresh · `⌘⇧F` search · `⌘⇧P` open repo · `⌘↵` commit ·
  `Esc` close diff → deselect commit

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
└── renderer/
    ├── index.html
    └── src/
        ├── components/   # Vue SFCs, one per panel/modal
        │   ├── Welcome.vue        # Open/Init/Clone screen
        │   ├── TabBar.vue         # Repository tabs (capsule bar)
        │   ├── Sidebar.vue        # Sync actions, branches, stashes, bottom actions
        │   ├── GraphView.vue      # Commit graph (SVG) + commit search
        │   ├── FilePanel.vue      # Changes panel + commit box
        │   ├── DiffView.vue       # Diff overlay viewer
        │   └── ...                # Modals: history, blame, rebase, bisect…
        ├── stores/       # Pinia stores (repo state + persisted UI state)
        ├── utils/        # Shared helpers (date formatting, highlighting)
        ├── styles.css    # Global stylesheet (base)
        └── modern-ui.css # Modern theme overrides (palette, radii, pills)
```

## Notes

- Requires system `git` in PATH.
- The graph auto-refreshes every minute and instantly on focus/external changes.
- Agent guidance lives in [AGENTS.md](AGENTS.md).
