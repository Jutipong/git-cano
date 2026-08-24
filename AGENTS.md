# AGENTS.md

Guidance for AI agents working in this repository.

## What this is

Open Git — an Electron + Vue 3 + TypeScript desktop Git GUI built on simple-git.
Renderer is plain HTML/CSS (no UI framework). Package manager: **pnpm**.

## Commands

- `pnpm dev` — development with hot reload
- `pnpm lint` — oxlint + vue-tsc; run before every commit
- `pnpm typecheck` — vue-tsc + tsc only
- `pnpm build` / `pnpm dist` — production build / macOS .dmg

## Architecture

Data flows one direction: **component → window.api (preload IPC) → main process → git.ts → simple-git**.
Never call git from the renderer directly, and never import from `src/main` in the renderer —
add a new IPC handler in `main/index.ts`, expose it in `preload/index.ts`, and type it via
`shared/types.ts`.

Key files:

- `src/main/git.ts` — all git operations (one exported function per operation)
- `src/preload/index.ts` — the `window.api` surface (keep names verb-first)
- `src/renderer/src/stores/repo.ts` — repo tabs, selected commit/file, commit files
- `src/renderer/src/stores/ui.ts` — persisted UI state (theme, panel widths/heights)
- `src/renderer/src/components/` — one Vue SFC per panel/modal

## UI model

- **Tab bar** (top): capsule-shaped repository tabs (`TabBar.vue`); the `+` button is a flat
  green icon styled like the panel refresh buttons — no outline.
- **Sidebar**: fetch/pull/push sync card at the top, branch/tag sections, then the STASHES
  section; bottom actions are Settings and the theme toggle only (no stash button there —
  stash creation lives in the STASHES section).
- **Changes panel** (right): shows either working-directory changes or, when a commit is
  selected in the graph, that commit's files. The summary textarea is read-only in commit mode
  (author · date chip sits above it).
- **DiffView overlay**: opens over sidebar + graph when a file row is clicked (right pane stays
  interactive for switching files). Has fullscreen toggle and close (✕).
- **Commit selection** affects Changes/DiffView but there is no separate details panel —
  do not reintroduce one; extend the Changes panel instead.
- Panel sizes live in the ui store and persist to localStorage; new resizable regions should
  follow the same pattern (`ref` + `persist.pick` + mousedown drag handler).
- **Styling** has two layers: `styles.css` (base) and `modern-ui.css` (loaded after, overrides
  look & feel). Put visual tweaks in `modern-ui.css`. Keep cards/panels/modals at a consistent
  `12px` radius; rows/buttons use pill (`999px`) shapes.

## Conventions

- **Never commit on your own.** Only commit when the user explicitly asks (e.g. "commit").
- Vue SFCs use 4-space indentation inside `<script setup>`; auto-imports cover vue/pinia APIs
  (no explicit `ref`/`computed` imports) — icons come from `lucide-vue-next`.
- Shared date formatting lives in `src/renderer/src/utils/format.ts`; reuse it rather than
  re-formatting dates inline.
- Commit titles follow the usual convention (≤50 chars ideal, ≤72 hard cap); the UI enforces
  this softly via a counter, not a block.
- Run `pnpm lint` and commit with an imperative-mood one-line message.
