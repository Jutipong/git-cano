# AGENTS.md

Guidance for AI agents working in this repository.

## What this is

git-cano — an Electron + Vue 3 + TypeScript desktop Git GUI built on simple-git.
Renderer is plain HTML/CSS (no UI framework). Package manager: **pnpm**.

## Commands

- `pnpm dev` — development with hot reload
- `pnpm lint` — oxlint + vue-tsc; run before every commit
- `pnpm typecheck` — vue-tsc + tsc only
- `pnpm build` — production build (`out/`)
- `pnpm dist:mac` / `pnpm dist:win` — macOS `.dmg` (arm64) / Windows portable `.exe` → `release/`
- Packaging (`package.json` → `build`): `appId` `com.jutipong.git-cano`, `productName` `Git Cano`,
  icons `build/icons/cano.png` + per-OS `cano.icns` / `cano.ico`, `asar: true` with maximum
  compression. `files` ships `out/**/*` + `package.json` only (excludes `out/tsbuild`,
  `*.map`, `*.md`, `LICENSE*`). New platform assets must follow the same png/icns/ico triple.

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
- `src/renderer/src/stores/ui.ts` — persisted UI state (theme, font size, zoom, panel widths/heights, shortcut overrides)
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

- **Tab bar** (top): capsule-shaped repository tabs (`TabBar.vue`); the open-repo trigger
  (`OpenRepoMenu.vue`) uses a catppuccin `folder-include` icon and repo search uses
  catppuccin `search` — the open popup appears instantly with no pop/rotate animation.
  Its rows use catppuccin `folder-open` (local) / `folder-git` (clone).
  Push/Pull/Fetch swap
  their icon for a compact `ThinkSpinner` (fixed 15px slot and 15px glyph, inherits
  the button color) while `syncStore.busy` is set.
- **Sidebar**: fetch/pull/push sync card at the top, workspace switcher
  (`WorkspaceButton.vue`, one persisted repo-tab session per workspace, text-only button
  with no leading icon), branch/tag
  sections, then the STASHES section; bottom actions are Settings and the theme toggle
  only (no stash button there — stash creation lives in the STASHES section).
  Brand icon `assets/cano.svg` sits at the top of the toolbar (`.sidebar-brand-icon`);
  the same asset drives the splash (`.splash-logo-image`) and no-repo empty state
  (`.app-empty-logo`) in `App.vue`. `Welcome.vue` was deleted — do not reintroduce it.
- **Workspaces reorder**: `workspace.ts` owns `reorder(from, to)` (bounds-guarded splice).
  `WorkspaceButton.vue` rows are `draggable`; reorder happens live on `dragover`
  (insertion = before/after by pointer Y within the row), `dragstart` is blocked while
  renaming/switching, and `draggingName` clears on drop/dragend/popover-close. There are
  deliberately no drop indicators — do not add them back without a product decision.
- **Context menus are per-feature SFCs**: `CommitContextMenu.vue` (graph commits),
  `LocalBranchContextMenu.vue` (local branches), `TagContextMenu.vue`,
  `StashContextMenu.vue`, `RepoTabContextMenu.vue`, `FileContextMenu.vue`. The shared
  `ContextMenu.vue` is only for generic dropdown menus (e.g. remote branches in the
  sidebar and the `OpenInButton.vue` short-label menu: Folder / Terminal / VS Code,
  plus Kiro / Visual Studio / Rider when installed). The command palette mirrors
  it via a repo-gated `Open in…` mode with the same items/conditions. Open-in Folder /
  Terminal use catppuccin `folder` / `bash` icons in both places.
  Palette command items must `close()` before acting/emitting (mode switches like
  Repo…/Branch… excepted) — otherwise the palette stays open over the next dialog.
  Follow the stash pattern: export a `*MenuState` interface from the component, pass it
  through a single `menu` prop, emit a typed event per action, and import icons directly
  inside the SFC — never grow `ContextMenu.vue`'s icon registry for feature-specific items.
- **Changes panel** (right): shows either working-directory changes or, when a commit is
  selected in the graph, that commit's files. The summary textarea is read-only in commit mode
  (author · date chip sits above it). Commit/stash mode (`commit-mode` in `modern-ui.css`)
  tints the header + file list green with a green title/border so it reads as a different
  mode from working-dir Changes — per-theme tuning keeps the title ≥ 4.5:1 contrast
  (dark 26%, dark-modern/terminal 20%, light 14% with a darker `#053a1a` title green).
- **Solo + Focus dim**: soloing a branch (`repoStore.soloBranch`, view-only, never persisted)
  filters the graph via `logSolo`, and `refresh()` also loads `soloFiles` (`listSoloFiles` —
  union of files touched by the solo commits at the same depth, one spawn). `FilePanel.vue`
  fades workdir rows absent from that set (`.file-dimmed`, hover/selected restores opacity).
  Rules: workdir mode only, new files (untracked / staged-added) never dim, empty/failed fetch
  means no dimming (fail-open via a `?.length` guard) — never invert this or a failed load
  fades the whole panel.
- **DiffView overlay**: opens as a floating card over the tab bar + sidebar + graph when a
  file row is clicked (right pane stays interactive for switching files). It is rendered as a
  direct child of `.app` — **not** inside `.app-body` — because `.app-body` has
  `overflow: hidden` and would clip anything extending above it. Has fullscreen toggle and
  close (✕).
- **Diff line highlighting** (`utils/highlight.ts` + `DiffView.vue`): word-level marks come
  from `markChangedLines()`, which pairs each `del` with its most similar `add` inside one
  block via weighted token LCS (letters/digits weigh 1, punctuation/whitespace 0.3) and only
  marks pairs above `MIN_LINE_SIMILARITY` 0.4 — do not drop the threshold or unrelated rows
  like `Memo = dto.memo` next to `PayDate = dto.paydate,` get misleading marks. Blocks larger
  than `MAX_MATCH_LINES` (250) or `MAX_MATCH_PAIRS` (12 000) skip matching entirely, and
  generated/minified lines use a `diffWindow` fallback capped at `MAX_DIFF_WINDOW_TOKENS`
  (512). `markHighlightedRanges()` wraps those ranges into HTML that was highlighted **once
  for the whole line** — never tokenize per mark segment, or strings/comments split across a
  mark change color. Search hits and diff marks are merged in `renderOne()`, with search
  winning overlaps. Syntax token colors always win inside add/del rows — the row tint
  (`--diff-row-tint`) and the 2px inset accent bar are the only add/del signals, so do not
  reintroduce `.diff-line.add pre { color: … }` or `.diff-line.moved pre` (a moved row keeps
  the purple background). Mark strength (`--diff-mark-strength`) and row tint live as CSS
  variables in `modern-ui.css` (light overrides the strength per paper contrast);
  `.diff-line.add/del mark` uses `:not(.search-hit)` so the orange search style stays intact.
- **Blame lens** (`.blame-lens-tip`, 450ms delay, styles in `modern-ui.css`, toggle in the
  DiffView header persisted via `ui.blameLens`, default off): hovering a gutter shows per-line
  authorship without opening `BlameModal.vue`. Blame is lazy (first hover only, cached per
  file+revision, never on diff load) and two-sided — added/context lines map `newNo` into the
  viewed tree (worktree / commit / stash), deleted lines map `oldNo` into the old side
  (`<rev>^`, `HEAD` for workdir; skipped entirely when the diff has no deletions). Lens state
  must stay declared **above** `loadDiff()`: the immediate file watcher runs it during setup,
  and anything touched there but declared below throws a TDZ ReferenceError that blanks the
  whole overlay. `getBlame()` parses `summary` plus the final line number from the porcelain
  sha header (`<orig> <final>` — there is no bare line-number line); do not regress this or
  `BlameModal.vue` shows 0 on every row again.
- **Commit graph virtualization** (`GraphView.vue`): SVG edges are collected in the
  `renderEdges` computed and drawn whenever the child→parent row span intersects the
  visible window (+5 rows overscan) — NOT only when both endpoints are on screen.
  Endpoint-based culling made long lane lines vanish mid-scroll; do not reintroduce it.
  Rows have variable heights via a prefix sum (`buildPrefix`/`indexAtOffset` in
  `utils/virtual.ts`): commits with more than 5 refs get a two-line 48px row
  (chips above the message), everything else is 30px — keep every Y computation
  (nodeY, tints, ticks, spacers, focus scroll) on the prefix, never `index * rowH`.
  The floating to-top button (`.to-top-btn`, styles in `styles.css`) appears after ~20
  rows of scroll in both the graph and the DiffView overlay (mounted in `.diff-main`
  with `right: 30px` to clear the minimap strip — `position: relative` on `.diff-main`
  in `modern-ui.css` is what anchors it). Both scroll back with the same rAF ease-out
  (160ms, cancels an in-flight animation, jumps instantly under 120px): GraphView's
  `animateScrollTo` mirrors DiffView's `animateBodyScrollTo` — keep them in sync.
  While a diff overlay covers the graph (DiffView / ConflictView / FileHistoryModal /
  BlameModal), App.vue passes `hide-to-top` to GraphView so the graph button hides:
  the overlay leaves a ~14px sliver on the right edge where it would otherwise peek
  out beside the diff's own button.
- **Selected commit node** (`.node-ring.selected`, styles in `modern-ui.css`) is a
  static double ring + soft glow in the lane color — deliberately no animation
  (ripple/pulse/dot-orbit variants were tried and rejected as distracting at 20px).
  Row hover does not zoom the avatar either; only selection scales it (1.12x).
- **Node hover tooltip** (`.avatar-tip`, 500ms delay, styles in `modern-ui.css`):
  shows ref chips on top (reusing `sortedRefs()` / `refKind()` / `chipColor()` so chips
  look identical to the row ones), then author with an avatar dot, email, and date.
  Refs come from `CommitNode.refs` (git log `%d` with `--decorate=full`) — they only
  exist on branch/tag tips; no on-demand `--contains` lookup. Remotes are encoded
  as `remote:<name>` by `normalizeRef()` in `git.ts` so classification needs no
  remote list. Chip order is tags (a-z) first, then branches grouped by short base
  (a-z) with remote before HEAD before local — keep it.
- **Full-message popover** (`.commit-msg-popover`, styles in `modern-ui.css`): header row
  is author (bold) / date / mono hash chip with a separator line, then the subject
  (bold) and the body as a `<pre>` (shown only when `commit.body` exists). Flips above
  the row via `.above` when there is not enough room below — keep that behavior.
- **Commit selection** affects Changes/DiffView but there is no separate details panel —
  do not reintroduce one; extend the Changes panel instead.
- Panel sizes live in the ui store and persist to localStorage; new resizable regions should
  follow the same pattern (`ref` + `persist.pick` + mousedown drag handler).
- **Styling** has two layers: `styles.css` (base) and `modern-ui.css` (loaded after, overrides
  look & feel). Put visual tweaks in `modern-ui.css`. Keep cards/panels/modals at a consistent
  `12px` radius; rows/buttons use pill (`999px`) shapes — except the `terminal` theme, which
  intentionally uses square corners (`--radius-card/pill: 0`), bracket titles, scanlines baked
  into the backdrop (not an overlay layer), and a `12px` background grid. Terminal palette is
  dusty navy with blue accents (see the `terminal` `ThemeOption` description in `ui.ts`);
  its graph lanes live in `GraphView.vue` (`TERMINAL_COLORS` + `TERMINAL_FIRST_LANE_COLOR`,
  8 entries, must stay mutually distinct). Dark palettes use `color-mix` for tints; light is a
  warm-gray base — keep both legible on low-clarity Windows displays.
- **Settings (`ToolsModal.vue`) has no Zoom control** — zoom lives only in the `App.vue`
  global handler (`⌘/Ctrl + − 0`, Ctrl/⌘+wheel). Do not re-add Zoom chips.
- **Close (✕) buttons** always use the `.icon-btn danger commit-close-btn` style (red ring +
  tinted background, hover intensifies — see `.commit-close-btn` in `styles.css`). Reuse that
  class on any close/dismiss ✕ button in panels and modals; never invent a one-off close style.
  The circle and the ✕ are drawn by the `CloseXIcon.vue` component (single SVG, always
  concentric) — don't swap it back for a plain `<i-lucide-x>` icon.

## Keyboard shortcuts

- `SHORTCUTS` (`src/renderer/src/utils/shortcuts.ts`) is the help table in
  `ShortcutsModal.vue`, shown in this order: Fetch, Pull, Push, Open repo,
  Clone repo, Close tab, Search commits, Open settings, Command palette, Show shortcuts — with
  dividers under the header, after Push, and after Command palette. Every
  entry there must have a real handler. The global `keydown` handler in
  `App.vue` owns the app-level combos; `DiffView.vue` owns find-in-diff
  (`Ctrl/⌘+F` while a diff is open, `Enter` in its search box for next
  match). When adding a shortcut, add the entry to `SHORTCUTS` (with
  `mac`/`win` keys) and wire the handler.
- Sync defaults (`SYNC_SHORTCUT_DEFAULTS`): Push `Ctrl+ArrowUp`, Pull
  `Ctrl+ArrowDown`, Fetch `Ctrl+Shift+ArrowDown`. `eventToCombo()` normalizes
  events to canonical combos (`Cmd` counts as `Ctrl`); `formatCombo()` renders
  arrows (`ArrowUp` → `↑`) for `kbd` display and TabBar tooltips,
  `formatComboMac()` renders the macOS column (`Ctrl` → `⌘`).
- Customizable shortcuts (`CUSTOM_SHORTCUT_IDS` in Settings → Shortcuts tab):
  Fetch, Pull, Push, Open repo, Clone repo, Search commits, Open settings, Command
  palette. Click Change… under macOS or Windows then press keys (`Esc` cancels, capture listener
  while recording), combos must include `Ctrl`/`Cmd` (`isValidSyncCombo`),
  conflicts with fixed combos (`Ctrl+=, -, 0` zoom, `Ctrl+W` close tab) or other customized ids
  on the same platform are rejected (`isReservedCombo`). `?` and zoom stay fixed.
  Overrides live in `ui.shortcutOverrides` as `{ [id]: { mac?, win? } }` (persisted, invalid or
  default-equal values are pruned, legacy single-string values migrate to both platforms) with `getShortcut(id, platform?)` /
  `setShortcut(id, combo, platform?)` / `resetShortcuts` plus a Default button (confirmed). `ShortcutsModal.vue`
  shows effective values per platform for customized ids. Settings lists each shortcut in
  macOS (`⌘`) / Windows columns with a separate Change… button each; Command palette keeps double-Shift fixed.
- App.vue sync handling skips while typing in inputs (where `Ctrl+Arrows`
  are word jumps), while the command palette is open (owns Arrows), with no
  repo, or while busy. Customizable shortcuts match canonical combos, so
  `Ctrl` and `⌘` both work.
- Current set: Fetch `Ctrl+Shift+↓`, Pull `Ctrl+↓`, Push `Ctrl+↑`,
  Command palette `Ctrl+P`/double-Shift, Open repo `Ctrl+O`, Clone repo `Ctrl+N`, Close tab
  `Ctrl+W` (fixed, works while typing),
  Settings `Ctrl+,`, Search `Ctrl+F` on Windows / `⌘F` on macOS (commit
  history; diff search when a diff is open), Shortcuts modal `?` (outside
  text inputs), commit via `⌘↵`/`Ctrl+↵` on the summary textarea, confirm
  dialogs `Enter`/`Esc`, app zoom `⌘/Ctrl +` `−` `0` and Ctrl/⌘+wheel,
  `Esc` to close diff/deselect.
- Busy gate: while `uiTransient.busy` is set, shortcuts are ignored — except app zoom
  and close tab, which are intentionally handled above the gate in `App.vue`
  (close tab still no-ops on busy and on unknown indexes via its own guards).
  The native Close-window `CmdOrCtrl+W` accelerator is rebound to
  `CmdOrCtrl+Shift+W` in `setupMenu()` (`main/index.ts`) so `Ctrl/Cmd+W`
  reaches the renderer.

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
- **Availability gate**: `canGenerate` in `FilePanel.vue` is false during merge/rebase/cherry-pick
  conflict flows (the panel shows conflict actions then) — the command-palette one-shot
  path shares this gate.
- **Commit-box indicator**: `FilePanel.vue` shows the short model name plus a mode dot
  (green = Generate only, orange = Auto Commit, red = Auto Commit & Push); the full
  `provider: model` label lives in the `title` tooltip.
- **Conflict labels + view**: `repoStore.oursLabel` is the current branch during any conflict
  flow, `theirsLabel` is the merge source or cherry-picked short hash (fallbacks
  `current`/`incoming`); any conflict state clears `selectedCommit`/`selectedStash`/
  `selectedFile` so `FilePanel` returns to workdir Changes. Continue/abort buttons
  share equal width and truncate long labels via `.conflict-label` ellipsis.
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
- **Countdown + pause** (toast close button in `App.vue`, styles in `modern-ui.css`): the
  `.toast-close` button draws a progress ring (`.toast-ring-progress`, dash offset from
  `t.progress`) with the remaining whole seconds (`.toast-close-count`, `countdownSeconds()` =
  `ceil(progress * durationMs / 1000)`) centered over it; hovering the toast pauses the
  countdown (`pauseToast`/`resumeToast` shift the deadline) and hovering the close button swaps
  the digit for the X. The digit is an absolute overlay (`.toast-close-count` `inset: 0` +
  `place-items: center`) so it stays concentric with the ring — a plain flow child drifts
  off-center. Keep its swap as a plain opacity fade; a blur filter made the digit look soft on
  low-clarity Windows displays (removed on purpose).
- **Undo toasts** (`utils/undo.ts` → `notifyUndoable`): commit/amend, revert, squash, soft/mixed reset,
  rebase (native + interactive), cherry-pick, merge, and stash delete journal their pre-op state in
  `main/git.ts` (per-repo stacks, cap 10, cleared on `closeRepo`) and offer an Undo button (`.toast-action` in `App.vue`) on the shared toast duration
  `toastDurationSec` default (Settings → General → Notifications, default 10s; per-toast `durationMs` can still override it). Undo resolves through an id-guarded
  `git:undo` IPC call so a stale toast can't undo a newer action. Rules: journal only fully
  recoverable ops — hard reset and anything already pushed are excluded (no entry = no
  button, plain toast); history-rewriting ops journal only from a clean tree (dirty tree = plain
  toast, and interactive rebase refuses to start dirty); destructive restores re-check dirtiness
  at undo time so a retry stays possible; cross-branch fast-forward merges use a `branchTip`
  entry restored via compare-and-swap `update-ref`; undo paths must `bumpStashList()` because `StashPanel` loads outside
  `refresh()`. Squash reuses the `commit` undo kind (`reset --soft headBefore` restores the
  range, the tree is identical) — do not add a new undo kind for it. Conflict flows
  (merge/cherry-pick/rebase continuations) are owned by abort — never journal them.

## Reflog

- Recovery net beyond the undo toast window: `listReflog(limit)` / `restoreReflog(ref)` in
  `main/git.ts` (`reflog:list` / `reflog:restore` IPC, `window.api.reflog` / `restoreReflog`,
  `ReflogEntry` in `shared/types.ts`). Unborn branches have no reflog — git exits non-zero,
  so `listReflog` catches and returns `[]` (modal shows "No reflog entries", never a raw fatal).
- Modal (`ReflogModal.vue`, styles in `modern-ui.css` `.reflog-*`): timeline rail with
  per-action node/badge colors via `actionKind()` (commit/reset/checkout/rebase/merge/
  cherry/revert/branch), day-grouped sticky headers, relative time (`formatCommitDate`),
  Restore per row behind `confirmDialog`. Opened from the command palette (`Reflog` item,
  repo-gated); visibility flag is `repoStore.reflogOpen`.
- Rules: restore requires a clean tree (dirty = disabled buttons + warning, no auto-stash);
  the restore itself journals a hard `reset` entry so it stays undoable (with the usual
  dirty-tree retry guard).

## Squash

- Squash is HEAD-range only: `getSquashPlan(target)` / `squashCommits(base, message)` in
  `main/git.ts` via `reset --soft base` + one commit (`squash:plan` / `squash:run` IPC,
  `squashPlan` / `squashCommits` on `window.api`, `SquashPlan` in `shared/types.ts`).
  Middle-slice squash is deliberately unsupported — it would need commit replay.
- Selection (`GraphView.vue`): `Shift+click` extends a range from the last pick (or the open
  commit); plain click / `Esc` / right-click elsewhere clears. The scope is always
  HEAD..oldest pick with gaps auto-filled, so skipping is structurally impossible — never add
  a control that breaks contiguity. The context menu (`CommitContextMenu.vue`,
  `squashCount`) only shows Squash when the scope has ≥2 commits.
- Modal (`SquashModal.vue`, styles in `modern-ui.css` `.squash-*`): lists the exact range
  newest-first with HEAD / keeps-message badges, defaults the message to the oldest subject
  with the FilePanel-style soft length counter, and blocks on a dirty worktree.

## Conventions

- **Never commit on your own.** Only commit when the user explicitly asks (e.g. "commit").
- Vue SFCs use 4-space indentation inside `<script setup>`; all imports are explicit
  (`vue`/`pinia`, stores/utils, `~icons/...` via `unplugin-icons`) — no auto-import plugins.
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
