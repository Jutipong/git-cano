# src/renderer — AGENTS.md

Renderer (Vue 3 SFCs + plain HTML/CSS) rules. Loaded automatically when working
under `src/renderer`. The root `AGENTS.md` holds the always-on rules
(architecture, commands, conventions); component-level patterns live in
`src/renderer/src/components/AGENTS.md` and store rules in
`src/renderer/src/stores/AGENTS.md`.

## UI model (app level)

- **Tab bar** (top): capsule-shaped repository tabs (`TabBar.vue`); the open-repo trigger
  (`OpenRepoMenu.vue`) uses a catppuccin `folder-include` icon and repo search uses
  catppuccin `search` — the open popup appears instantly with no pop/rotate animation.
  Its rows use catppuccin `folder-open` (local) / `folder-git` (clone). The `Open in`
  trigger (`OpenInButton.vue`) is a text-only button with no chevron and tighter padding.
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
- **Commit selection** affects Changes/DiffView but there is no separate details panel —
  do not reintroduce one; extend the Changes panel instead.
- **Cherry-pick safety**: both the commit context menu (`Cherry-pick onto HEAD`) and dragging a
  commit onto a branch use the shared `cherryPickOnto()` flow in `App.vue`. It checks
  `RepoStatus.files` (staged, unstaged, and untracked) before the dry-run; if dirty, it must stop
  without changing the repository and show a blocking prompt to stash or commit manually. Do not
  auto-stash, discard, or add a continue-anyway path here. Once clean, run `cherryPickCheck()`,
  confirm, checkout a different target only after confirmation, then cherry-pick and refresh.
- **Branch merge safety**: dragging a source branch onto a target branch, or right-clicking a
  non-current local branch → `Merge <branch> into <current>` (`LocalBranchContextMenu.vue` →
  `emit('merge-branch')` → `App.vue`), uses the shared
  `mergeBranchOnto()` flow in `App.vue`. It checks `RepoStatus.files` before
  `mergeCheckConflicts()`; dirty worktrees stop without changing the repository and show the same
  manual stash/commit prompt as cherry-pick. `mergeInto()` repeats the clean-worktree guard in the
  main process as defense-in-depth; do not auto-stash, discard, or add a continue-anyway path.
  After confirmation, execute the merge, refresh, and keep the existing conflict/Undo handling.
- Panel sizes live in the ui store and persist to localStorage; new resizable regions should
  follow the same pattern (`ref` + `persist.pick` + mousedown drag handler).
- **The app shell must stay mounted while a workspace switch is in flight**: `switchWorkspace`
  empties `tabs` before it reopens the destination, so `repo` goes null mid-switch. `App.vue`
  therefore renders the shell on `repo || switchingWorkspace` and hides it with `v-show="!!repo"`
  — a plain `v-if="repo"` unmounts the subtree, which throws away the Changes panel's
  commit-message draft and the graph's scroll position every time the user switches workspace.
  Anything inside that subtree must read `repo` defensively (`repo?.files ?? []`, `Sidebar` is
  `v-if="repo"`, `FilePanel.loadAllFiles()` bails when there is no active repo) — keep it that way
  rather than tightening the guard back to `v-if="repo"`.
- **Splash & loading covers**: every minimum-visible hold goes through `useMinVisible`
  (`utils/minVisible.ts`, `{ showDelayMs?, minVisibleMs }`). The splash's enter must stay instant —
  `.splash-enter-active { transition: none }` with no `.splash-enter-from` opacity: the boot splash
  is the first paint and never animates in, so the 450ms fade-in only ever ran on switches, where a
  fast switch interrupts it and exposes the teardown (tabs wiped → empty state) through a half-faded
  veil. `App.vue` runs `useMinVisible(() => !booted)` and `useMinVisible(() => switchingWorkspace)`
  against the shared `SPLASH_MIN_MS` (`utils/splash.ts`, 1000ms), so `switchWorkspace` releases the
  flag as soon as the work is done (guards unblock promptly) while the cover stays for the minimum;
  the "Loading repository…" overlay uses the same composable with `showDelayMs: 150` /
  `minVisibleMs: 400`, so cached tab switches never flash it. `.splash-leave-active` keeps the 450ms
  fade plus `pointer-events: none` (the app is ready underneath), and the empty state is hidden while
  switching (`v-if="!repo && !switchingWorkspace"`). Do not re-add the enter fade or bind these
  overlays to their raw source booleans.
- **Styling** has two layers: `styles.css` (base) and `modern-ui.css` (loaded after, overrides
  look & feel). Put visual tweaks in `modern-ui.css`. Keep cards/panels/modals at a consistent
  `12px` radius; rows/buttons use pill (`999px`) shapes — except the `terminal` theme, which
  intentionally uses square corners (`--radius-card/pill: 0`), bracket titles, scanlines baked
  into the backdrop (not an overlay layer), and a `12px` background grid. Terminal palette is
  dusty navy with blue accents (see the `terminal` `ThemeOption` description in `ui.ts`);
  its graph lanes live in `GraphView.vue` (`TERMINAL_COLORS` + `TERMINAL_FIRST_LANE_COLOR`,
  8 entries, must stay mutually distinct). Dark palettes use `color-mix` for tints; light is a
  warm-gray base — keep both legible on low-clarity Windows displays.
- **Windows-only settings hide on macOS/Linux**: General → Performance status accelerators render
  only when `isWindows` (`utils/shortcuts.ts`), and main forces them off outside win32
  (`setStatusAccelerators()` in `main/git.ts`). A persisted `true` must never take effect there —
  gate new Windows-only toggles the same way instead of leaving them visible-but-inert.

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
  the digit for the X. The digit is an SVG `<text>` inside the same `.toast-ring`
  (`x/y=11`, `text-anchor=middle`, `dominant-baseline=central`) so it shares one
  coordinate system with the ring — the old HTML absolute overlay drifted on macOS
  because SF vs Segoe UI line-box metrics differ. Keep the ring upright by rotating
  only `.toast-ring-progress` (`transform-box: fill-box`), never the whole SVG.
  Keep its swap as a plain opacity fade; a blur filter made the digit look soft on
  low-clarity Windows displays (removed on purpose).
- **Undo toasts**: the Undo button (`.toast-action` in `App.vue`) appears when `notifyUndoable`
  (`utils/undo.ts`) returns an entry; journalling rules live in `src/main/AGENTS.md`. Duration is
  the shared `toastDurationSec` default (Settings → General → Notifications, default 10s; a
  per-toast `durationMs` can still override it).

## Updates UI (renderer)

- Update checks hit `GET repos/Jutipong/git-cano/releases/latest` from the renderer
  (CSP `connect-src` in `src/renderer/index.html` must keep allowing `api.github.com`).
  `updater.checkForUpdate()` compares `tag_name` against `window.api.getVersion()`
  (leading `v` stripped, numeric segments, release beats prerelease).
- Sidebar update button (`Sidebar.vue`, green `.update-version-btn`) renders on
  `available` (`lucide:circle-arrow-up` = Download), `downloading` (spinner
  with % title) and `downloaded` (`lucide:rotate-cw` = restart to install) — never on
  version-loaded alone; its divider is gated the same way. On macOS and in dev
  (`updateCanAuto() === false`) the button opens the GitHub release page directly
  (`updater.openRelease()` → `update:openRelease`) — no Settings detour, so nothing may
  deep-link `repoStore.toolsTab = 'general'`; the Updates section is reached via
  Settings → General like any other tab. (Windows in-app download/install lives in
  `src/main/AGENTS.md`.)
- Cadence lives in `ui.updateCheckHours` (`0` = manual only, default 2); `App.vue`
  schedules one silent check 30s after launch plus the interval, rescheduled on change.
  `checkForUpdate()` never clobbers an in-flight download or a staged install.
- **What's new modal** (`ChangelogModal.vue`, styles in `modern-ui.css` `.changelog-*`):
  the persisted `ui.lastSeenVersion` is compared against `window.api.getVersion()` on
  launch — a mismatch on a non-empty value means the app was just updated, so
  `updater.changelogOpen` flips and the modal opens once. A blank value is a fresh
  install and must never open it. Notes come from the GitHub release body
  (`loadChangelog()` → `releases/tags/v<version>`, cached per version, failure leaves
  `notes` null and the modal says so — never an `ErrorDialog`). `changelogOpen` is the
  single flag behind all three entry points: the auto-open, Settings → General →
  Updates, and the native Window menu. Body text is rendered as plain text inside a
  `pre-wrap` block via `utils/changelog.ts` `stripMarkdown()` — never `v-html`, never add
  a markdown library. Its footer follows the app-standard action row (`.changelog-actions`:
  `border-top` separator, `align-items: center`, plain `btn` + `btn primary`) — do not go
  back to `btn small`, the 27px pill squeezes the 13px icon out of alignment with the label.
