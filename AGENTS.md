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
- `src/main/opencode.ts` — AI commit-message generation (see "AI commit messages" below)
- `src/preload/index.ts` — the `window.api` surface (keep names verb-first)
- `src/renderer/src/stores/repo.ts` — repo tabs, selected commit/file, commit files
- `src/renderer/src/stores/ui.ts` — persisted UI state (theme, font size, zoom, panel widths/heights)
- `src/renderer/src/stores/workspace.ts` — named workspaces, each with its own persisted
  repo-tab session (paths + active tab)
- `src/renderer/src/utils/shortcuts.ts` — single source of truth for keyboard shortcuts
- `src/renderer/src/components/` — one Vue SFC per panel/modal

## Repository loading and performance

- `repo.ts` loads local repository data (status, history, branches, local tags, and remote existence) before marking the repo as loaded.
- Remote tag status is network-bound and must stay outside the awaited refresh batch. `loadRemoteTags()` runs it in the background, keeps a loading state for the TAGS section, and ignores results from an inactive repo.
- `listRemoteTags()` uses a separate `plainGit()` instance so the background network request does not block local Git commands. Do not add a cache or put this request back into the main refresh `Promise.all()` without a deliberate product decision.
- Workspace switches close only repositories that are not present in the destination workspace, open target repositories concurrently, and pass the already-computed active-repo status into `selectTab()` to avoid a duplicate `git status`.
- Keep the local loading indicators honest: local tags and remote tag status have separate loading states, and local tags should remain visible while remote status is loading.

## UI model

- **Tab bar** (top): capsule-shaped repository tabs (`TabBar.vue`); the `+` button is a flat
  green icon styled like the panel refresh buttons — no outline.
- **Sidebar**: fetch/pull/push sync card at the top, workspace switcher
  (`WorkspaceButton.vue`, one persisted repo-tab session per workspace), branch/tag
  sections, then the STASHES section; bottom actions are Settings and the theme toggle
  only (no stash button there — stash creation lives in the STASHES section).
- **Context menus are per-feature SFCs**: `CommitContextMenu.vue` (graph commits),
  `LocalBranchContextMenu.vue` (local branches), `TagContextMenu.vue`,
  `StashContextMenu.vue`, `RepoTabContextMenu.vue`, `FileContextMenu.vue`. The shared
  `ContextMenu.vue` is only for generic dropdown menus (e.g. remote branches in the
  sidebar and the `OpenInButton.vue` "Open in Folder/Terminal/VS Code" menu).
  Follow the stash pattern: export a `*MenuState` interface from the component, pass it
  through a single `menu` prop, emit a typed event per action, and import icons directly
  inside the SFC — never grow `ContextMenu.vue`'s icon registry for feature-specific items.
- **Changes panel** (right): shows either working-directory changes or, when a commit is
  selected in the graph, that commit's files. The summary textarea is read-only in commit mode
  (author · date chip sits above it).
- **DiffView overlay**: opens as a floating card over the tab bar + sidebar + graph when a
  file row is clicked (right pane stays interactive for switching files). It is rendered as a
  direct child of `.app` — **not** inside `.app-body` — because `.app-body` has
  `overflow: hidden` and would clip anything extending above it. Has fullscreen toggle and
  close (✕).
- **Commit selection** affects Changes/DiffView but there is no separate details panel —
  do not reintroduce one; extend the Changes panel instead.
- Panel sizes live in the ui store and persist to localStorage; new resizable regions should
  follow the same pattern (`ref` + `persist.pick` + mousedown drag handler).
- **Styling** has two layers: `styles.css` (base) and `modern-ui.css` (loaded after, overrides
  look & feel). Put visual tweaks in `modern-ui.css`. Keep cards/panels/modals at a consistent
  `12px` radius; rows/buttons use pill (`999px`) shapes.
- **Close (✕) buttons** always use the `.icon-btn danger commit-close-btn` style (red ring +
  tinted background, hover intensifies — see `.commit-close-btn` in `styles.css`). Reuse that
  class on any close/dismiss ✕ button in panels and modals; never invent a one-off close style.
  The circle and the ✕ are drawn by the `CloseXIcon.vue` component (single SVG, always
  concentric) — don't swap it back for a plain `<i-lucide-x>` icon.

## Keyboard shortcuts

- All shortcuts live in `src/renderer/src/utils/shortcuts.ts` (`SHORTCUTS` array) — the
  global `keydown` handler in `App.vue` and the `ShortcutsModal.vue` help table both read
  from it. When adding a shortcut, add the entry to `SHORTCUTS` (with `mac`/`win` keys)
  and wire the handler in `App.vue`; macOS accepts both `⌘` and `Ctrl` for the
  Ctrl-based combos.
- Current set: Pull `Ctrl+L`/`⌘↓`, Push `Ctrl+P`/`⌘↑`, Fetch `Ctrl+F`, Open repo
  `Ctrl+O`, Settings `Ctrl+,`, Refresh `⌘R`, Search commits `⌘⇧F`, New tab `⌘⇧P`,
  Shortcuts modal `?` (outside text inputs), commit via `⌘↵` on the summary textarea,
  app zoom `⌘/Ctrl +` `−` `0` and Ctrl/⌘+wheel, `Esc` to close diff/deselect.
- Busy gate: while `uiTransient.busy` is set, shortcuts are ignored — except app zoom,
  which is intentionally handled above the gate in `App.vue`.

## AI commit messages

All AI logic lives in `src/main/opencode.ts` (renderer never calls model APIs directly;
it goes through the `ai:*` IPC handlers in `main/index.ts` → `preload/index.ts`, typed via
`shared/types.ts`).

- `callModel()` is the single HTTP entry point. It talks to three API "families"
  (`responses` for `gpt-*`/`grok-*`/`muse-*`, `messages` for `minimax-*`/`qwen-*`,
  `chat` for everything else incl. all of OpenRouter) selected by `familyOf()`.
- **Reasoning effort**: requests send `effort: 'minimal'` (OpenRouter uses
  `reasoning.effort`, OpenCode Go chat uses `reasoning_effort`, `messages` family
  omits thinking entirely). If the endpoint rejects it with a 400 mentioning
  effort/reasoning, `callModel()` retries `low`, then with no reasoning param.
  Do not raise this for commit messages — the point is speed and not burning the
  small output budget on thinking (`finish_reason=length`).
- **Context scope** (`AiContextScope` in `shared/types.ts`): `generateCommitMessage()`
  forwards it to `getChangesContext()` in `git.ts`.
    - `'staged'` → staged file list + `git diff --cached` only
    - `'all'` → staged + unstaged diff + untracked file previews
    - Rule: `FilePanel.vue` picks `'staged'` when `ui.aiCommitMode === 'off'`
      (Generate only) and `'all'` for auto commit / auto commit + push, because those
      modes run `stageAll()` before committing — the message must match what gets committed.
    - Default at every layer is `'staged'`; never change that silently.
- **Repo pinning**: the AI flow (`generate → stageAll → commit → push`) is slow, so
  `FilePanel.vue` pins `repoStore.repo.path` at the start and passes it through every
  IPC call (`ai:generateCommitMessage`, `file:stageAll`, `commit:message`,
  `remote:push`). The main process resolves those via `getRepoFor(dir)` — never the
  mutable global active repo — so a tab switch mid-flight can't stage/commit/push the
  wrong repo. If the tab changed while generating, the renderer discards the message
  (it describes the old repo) with a warning instead of filling the new repo's box.
  New repo-scoped git operations must follow this pattern (optional `dir` param →
  `getRepoFor`), not `getRepo()`.
- **Availability gate**: `canGenerate` in `FilePanel.vue` is false during merge/rebase
  conflict flows (the panel shows conflict actions then) — the command-palette one-shot
  path shares this gate.
- **Cancellation**: while generating, the AI button doubles as Cancel. The renderer
  calls `ai:cancelGenerate` (keyed by pinned repo path); the main process aborts the
  in-flight `fetch` via a per-key `AbortController` (`cancelModelCall`). A cancelled
  run surfaces a warning toast, never the error dialog.
- **Provider families**: `familyOf()` matches on the bare model id (any `provider/`
  prefix is stripped). All three families authenticate with `Bearer` only.
  `callModel()` logs the chosen family/endpoint at debug level (never the token).
  `extractContent()` for `responses` prefers the `type: 'message'` output item so a
  reasoning summary can't become the commit message.
- **Budgets**: commit generation uses 512 output tokens; on a persistent length cutoff
  (after the `minimal → low → none` effort fallbacks) it retries once with a doubled
  budget (cap 2048). `testConnection()` uses production-like conditions (128 tokens,
  empty replies rejected) so a pass means real generation likely works.
- **Context hygiene** (`getChangesContext()`): untracked previews skip binary files
  (NUL-byte probe) and files >256KB with an `(content omitted)` marker; prompt
  truncation (`truncateForPrompt()`) cuts on a line boundary. Empty model replies are
  logged raw to the log file but shown to the user as a clean message.
  `cleanModelMessage()` strips fences plus one layer of surrounding quotes/backticks.
- **Model catalogs**: offline fallback is per-provider (`lastKnownModels(provider)` —
  OpenRouter falls back to its own persisted list, not `[]`). Free-Zen detection lives
  only in `isFreeZenId()` (`shared/models.ts`) — never re-implement the suffix check.
- **Format-before-generate** (`formatRepoIfConfigured()`): the formatter only touches
  the worktree, so it runs only for scope `'all'` (auto commit modes, where a later
  `stageAll()` picks the formatted result up). For `'staged'` (Generate Only) it is
  skipped — formatting would dirty the worktree without ever reaching the message,
  and Generate Only must not touch the index.
- `COMMIT_SYSTEM_PROMPT` enforces one-line Conventional Commits output; keep it terse.

## Feedback: toasts & error dialog

- One store owns ALL feedback: `src/renderer/src/stores/uiTransient.ts`. Components reach it via
  `inject('notify')` (a `(message: string, type?: ToastKind) => void` provided in `App.vue`).
  Never invent a second toast/dialog system.
- `notify(message)` without a `type` auto-classifies via `inferToastKind()` (keyword matching:
  `error|failed|invalid|not found|…` → **error dialog**, `success|completed|…` → green toast, etc.).
- **Errors open `ErrorDialog.vue` (a modal), not a toast.** `App.vue` renders it from
  `uiTransient.errorDialog`; it closes via X / Close button / ESC. Everything non-error becomes a
  transient toast (auto-dismisses).
- Rule: when a failure must surface clearly, ALWAYS pass the type explicitly —
  `notify(msg, 'error')`. Do not rely on keyword inference, or messages like
  "Model returned an empty response (…json…)" silently degrade to a toast. Example to follow:
  AI commit-message generation failures in `FilePanel.vue` use `notify(msg, 'error')`.
- Toasts carry kinds (`success | error | warning | info | fetch | pull | push | stash`); the
  `push`/`pull`/`fetch`/`stash` kinds are action-accent colors for the sidebar sync card.

## Conventions

- **Never commit on your own.** Only commit when the user explicitly asks (e.g. "commit").
- Vue SFCs use 4-space indentation inside `<script setup>`; auto-imports cover vue/pinia APIs
  (no explicit `ref`/`computed` imports) — icons come from `lucide-vue-next`.
- Per-feature context menus get their own dedicated SFC (e.g. `StashContextMenu.vue`,
  `TagContextMenu.vue`) instead of adding more actions to the shared `ContextMenu.vue`.
  Follow the stash pattern: export a `*MenuState` interface from the component, pass it
  through a single `menu` prop, emit a typed event per action, and import icons directly
  inside the SFC — never grow `ContextMenu.vue`'s icon registry for feature-specific items.
- Shared date formatting lives in `src/renderer/src/utils/format.ts`; reuse it rather than
  re-formatting dates inline.
- Commit titles follow the usual convention (≤50 chars ideal, ≤72 hard cap); the UI enforces
  this softly via a counter, not a block.
- Run `pnpm lint` and commit with an imperative-mood one-line message.
