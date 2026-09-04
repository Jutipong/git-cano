# Open Git

Open Git is a lightweight desktop Git client for Windows and macOS. It focuses
on the everyday Git workflow: open repositories, review history, manage
branches and tags, and commit changes without leaving the app.

Built with **Electron, Vue 3, TypeScript, Pinia, and simple-git**.

## Features

### Repositories and workspaces

- Open, initialize, and clone repositories
- Keep multiple repositories open in tabs
- Create named workspaces, each with its own tabs and active repository
- Restore recent repositories and sessions on startup
- Open the active repository in Explorer/Finder, Terminal, or VS Code

### History and changes

- Interactive commit graph for branches, remotes, and tags
- Search commits by message, author, hash, or ref
- Review working-directory changes or files changed by a commit
- Stage and unstage files or individual diff hunks
- Commit, amend, discard changes, and copy commit hashes
- Unified or side-by-side diffs with image and binary-file support
- Blame and per-file history views

### Branches, tags, and remotes

- Create, checkout, rename, delete, merge, and rebase branches
- Create, delete, and push tags
- Add, edit, remove, and test remote URLs
- Fetch, pull, and push with SSH key or GitHub token authentication
- Manage stashes, worktrees, submodules, and Git bisect sessions
- Resolve merge conflicts with ours/theirs choices or manual editing

### Optional AI commit messages

- Supports OpenCode Go and OpenRouter
- Generate a commit message from staged changes
- Optional auto-commit and auto-commit-plus-push modes
- Optional formatting before generation

### Fast loading

- Local repository data loads before network-dependent data
- Remote tags load in the background and do not block repository switching
- The TAGS section shows a loading indicator while remote tag status is being checked
- Switching workspaces keeps shared repositories open when possible
- Optional `fsmonitor` and untracked-cache accelerators are available in Settings → General

## Keyboard shortcuts

macOS accepts both `⌘` and `Ctrl` for the common Ctrl-based shortcuts. Press
`?` in the app to see the complete shortcut list.

| Action          | macOS            | Windows             |
| --------------- | ---------------- | ------------------- |
| Pull            | `Ctrl+L` or `⌘↓` | `Ctrl+L` or `Alt+↓` |
| Push            | `Ctrl+P` or `⌘↑` | `Ctrl+P` or `Alt+↑` |
| Fetch           | `Ctrl+F`         | `Ctrl+F`            |
| Open repository | `Ctrl+O`         | `Ctrl+O`            |
| Settings        | `Ctrl+,`         | `Ctrl+,`            |
| Refresh         | `⌘R`             | `Ctrl+R`            |
| Search commits  | `⌘⇧F`            | `Ctrl+Shift+F`      |
| New tab         | `⌘⇧P`            | `Ctrl+Shift+P`      |
| Commit          | `⌘↵`             | `Ctrl+↵`            |
| Close or cancel | `Esc`            | `Esc`               |

## Requirements

- Node.js
- pnpm 10 or newer
- Git available in `PATH`

## Development

```bash
pnpm install
pnpm approve-builds electron esbuild   # first install only
pnpm dev                                # development with hot reload
```

Useful checks and builds:

```bash
pnpm typecheck
pnpm lint
pnpm build                              # production build
pnpm dist:win                           # Windows portable app
pnpm dist:mac                           # macOS .dmg
```

Run the production build with:

```bash
npx electron .
```

## Project structure

```text
src/
├── main/              # Electron main process and Git operations
├── preload/           # Secure window.api bridge
├── shared/            # Shared TypeScript types and graph helpers
└── renderer/src/
    ├── components/    # Vue panels, views, and dialogs
    ├── stores/        # Repository, workspace, UI, sync, and AI state
    ├── utils/         # Formatting, shortcuts, dialogs, and helpers
    ├── styles.css     # Base styles
    └── modern-ui.css  # Modern UI overrides
```

## Notes

- Open Git never sends Git operations directly from the renderer. Calls go
  through `window.api` to the Electron main process.
- Remote tag status depends on the repository's `origin` and network access.
  It is intentionally loaded in the background so slow remotes do not block
  the rest of the application.
- See [AGENTS.md](AGENTS.md) for repository-specific development guidance.
