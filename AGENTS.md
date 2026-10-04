# AGENTS.md

Guidance for AI agents working in this repository. This root file holds the
rules that apply to every task; deeper area notes live in nested `AGENTS.md`
files that OpenCode loads automatically when you read files in their directory.

## What this is

git-cano — an Electron + Vue 3 + TypeScript desktop Git GUI built on simple-git.
Renderer is plain HTML/CSS (no UI framework). Package manager: **pnpm**.

## Commands

- `pnpm dev` — development with hot reload
- `pnpm lint` — oxlint + vue-tsc; run before every commit
- `pnpm typecheck` — vue-tsc + tsc only
- `pnpm test:unit` — Vitest unit tests for pure logic (`tests/unit`)
- `pnpm test:e2e` — Playwright Electron E2E; builds `out/` first (`tests/e2e`) — see `tests/AGENTS.md`
- `pnpm test` — lint + typecheck + unit + e2e (release gate)
- `pnpm build` — production build (`out/`)
- `pnpm dist:mac` / `pnpm dist:win` — macOS `.dmg` (arm64) / Windows Setup `.exe` (NSIS) → `release/`
- Packaging (`package.json` → `build`): `appId` `com.jutipong.git-cano`, `productName` `Git Cano`,
  icons `build/icons/cano.png` + per-OS `cano.icns` / `cano.ico`, `asar: true` with maximum
  compression. `files` ships `out/**/*` + `package.json` only (excludes `out/tsbuild`,
  `*.map`, `*.md`, `LICENSE*`). New platform assets must follow the same png/icns/ico triple.
  There are no native modules left, so nothing needs `asarUnpack`; `npmRebuild: false` stays as a
  cheap guard so electron-builder never reaches for a native rebuild toolchain on `pnpm dist:*`.
  The one exception is `node-pty` (the terminal panel): it ships prebuilt N-API binaries, so it needs
  no rebuild step either — but it must stay listed in `asarUnpack`
  (`**/node_modules/node-pty/**`) because a `.node` file cannot be loaded from inside the asar, and
  it must stay in `rollupOptions.external` in `electron.vite.config.ts` because its CJS loader
  requires those binaries with paths relative to its own folder. `allowBuilds: node-pty` in
  `pnpm-workspace.yaml` lets pnpm run its install script (which picks the right prebuild).

## Architecture

Data flows one direction: **component → window.api (preload IPC) → main process → git.ts → simple-git**.
Never call git from the renderer directly, and never import from `src/main` in the renderer —
add a new IPC handler in `main/index.ts`, expose it in `preload/index.ts`, and type it via
`shared/types.ts`. Keep `window.api` names verb-first, and add new repo-scoped operations with an
optional `dir` param resolved by `getRepoFor` (never the mutable active-repo global).

Key files:

- `src/main/git.ts` — all git operations (one exported function per operation) — see `src/main/AGENTS.md`
- `src/main/opencode.ts` — AI commit-message generation — see `src/main/AGENTS.md`
- `src/main/terminal.ts` — PTY sessions for the terminal panel — see `src/main/AGENTS.md`
- `src/main/updater.ts` — Windows in-app update download/install — see `src/main/AGENTS.md`
- `src/preload/index.ts` — the `window.api` surface
- `src/renderer/src/App.vue` — app shell, global keydown handler, toast/error rendering
- `src/renderer/src/stores/` — repo/ui/terminal/updater/workspace/uiTransient state — see `src/renderer/src/stores/AGENTS.md`
- `src/renderer/src/utils/shortcuts.ts` — single source of truth for keyboard shortcuts
- `src/renderer/src/components/` — one Vue SFC per panel/modal — see `src/renderer/src/components/AGENTS.md`
- `src/shared/` — `types.ts` (IPC types), `models.ts` (model catalogs/helpers), `lanes.ts`

## Area guides

Nested files are loaded automatically when an agent reads files in their directory.
Always-on rules stay in this root file.

- `src/main/AGENTS.md` — simple-git environment, AI commit messages, undo journalling,
  reflog, interactive rebase, squash, updates & releases.
- `src/renderer/AGENTS.md` — app shell & UI model, keyboard shortcuts, feedback
  (toasts/error dialog), update UI.
- `src/renderer/src/components/AGENTS.md` — context menus, modals, commit graph, diff
  rendering, file preview, blame lens, shared component patterns.
- `src/renderer/src/stores/AGENTS.md` — store responsibilities, repository loading &
  performance, persisted state.

## Conventions

- **Never commit on your own.** Only commit when the user explicitly asks (e.g. "commit").
- Vue SFCs use 4-space indentation inside `<script setup>`; all imports are explicit
  (`vue`/`pinia`, stores/utils, `~icons/...` via `unplugin-icons`) — no auto-import plugins.
- Shared date formatting lives in `src/renderer/src/utils/format.ts`; reuse it rather than
  re-formatting dates inline.
- Commit titles follow the usual convention (≤50 chars ideal, ≤72 hard cap); the UI enforces
  this softly via a counter, not a block.
- Run `pnpm lint` and commit with an imperative-mood one-line message.
