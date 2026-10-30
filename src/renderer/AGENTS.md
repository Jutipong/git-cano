# src/renderer — AGENTS.md

Renderer (Vue 3 SFCs + plain HTML/CSS) rules. Loaded automatically when working
under `src/renderer`. The root `AGENTS.md` holds the always-on rules
(architecture, commands, conventions); component-level patterns live in
`src/renderer/src/components/AGENTS.md` and store rules in
`src/renderer/src/stores/AGENTS.md`.

## UI model (app level)

- **Tab bar** (top): capsule-shaped repository tabs (`TabBar.vue`); the open-repo trigger
  (`OpenRepoMenu.vue`) uses a lucide `folder-plus` icon — the open popup appears
  instantly with no pop/rotate animation.
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
- **Terminal panel**: a bottom panel under the graph, toggled by the toolbar button next to the
  commit-search settings icon (`GraphView.vue` `.graph-terminal-btn`, same spot as before v1.4.0).
  First press spawns the active repo's shell, every press after that hides/shows it — killing is the
  ✕ buttons' job alone. `App.vue` mounts one `TerminalPanel` per repo that owns a shell, keyed by
  repo path, and keeps it mounted across repo switches, workspace switches and the toggle, so a
  shell you left behind is still there (and still running) when you come back. The graph is only
  hidden while a panel is expanded (teleported to `.app`, under the repo tab bar); the overlay
  clears the Changes pane by default, and Settings → Terminal → Full window (`ui.terminalFullWidth`)
  only widens it — the expanded overlay then spans all three columns and rises over the repo tab
  bar (`.terminal-overlay-window`). The **docked strip always floats** over the bottom of the
  columns instead of nesting inside the graph column: `.terminal-docked-wide` (the default) spans
  the Sidebar + Graph columns, Full window adds `.terminal-docked-full` for all three columns, and
  the drag handle (`.terminal-splitter-wide` / `-full`, riding `--terminal-height` on `.app`)
  follows the strip's width. **Hiding never
  resizes**: `hideTerminals(path)` keeps the full-height state, so every gesture that hides the panel
  (`Ctrl+` / palette / the header's chevron — the toolbar button is unreachable while expanded, the
  overlay hides the graph) shows it back exactly as it was; only the header's minimize button leaves
  full mode. Showing the panel (`Ctrl+` / palette / toolbar) and the maximize/restore toggle
  always hand the keyboard back to the active shell (`TerminalPanel.focusActive()` — the teleport
  move would otherwise drop focus to `<body>`) — a repo/workspace switch only makes a panel
  visible and must not steal focus. Drag the
  `.terminal-splitter` for height (persisted per session, resets to 300px on launch).
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
  `12px` radius; rows/buttons use pill (`999px`) shapes. Dark palettes use `color-mix` for tints;
  light is a warm-gray base — keep both legible on low-clarity Windows displays.
- **Windows-only settings hide on macOS/Linux**: General → Performance status accelerators render
  only when `isWindows` (`utils/shortcuts.ts`), and main forces them off outside win32
  (`setStatusAccelerators()` in `main/git.ts`). Settings → Terminal hides its shell section the same
  way (Command Prompt / Windows PowerShell / PowerShell 7 render only when `isWindows`; elsewhere the
  terminal always spawns `$SHELL`, and PowerShell 7 — the default — falls back to Command Prompt where
  pwsh is not installed). A persisted `true` must never take effect
  there — gate new Windows-only toggles the same way instead of leaving them visible-but-inert.

## Design tokens & style guard

- Theme colors live in the `:root[data-theme='…']` blocks of `styles.css` — the single
  source of truth. `modern-ui.css` only holds component overrides; never add a theme-token
  declaration there. Use `var(--…)` for every color in selectors; raw hex belongs only in a
  token declaration (a line starting with `--`). Shared, theme-independent tokens sit in the
  `:root` block at the end of those theme blocks: spacing (`--space-1…7` = 4/6/8/10/12/16/24px), type
  (`--font-xs…2xl` = 10/11/12/13/14/16/18px), radius (`--radius-xs/sm/md` = 4/6/8px
  plus the existing `--radius-card`/`--radius-pill`), motion
  (`--duration-fast`/`--duration`/`--duration-slow`), focus
  (`--focus-ring`/`--focus-offset`, overridden by the retro/win9x themes) and
  z-index layers below.
- New font sizes use the scale above. Legacy sizes outside it (8, 9, 9.5, 10.5, 11.5,
  12.5, 15, 34) are frozen: do not add more, but do not round the existing ones either —
  the dense layouts depend on them.
- Global stacking layers use the tokens: fullscreen 60, popover 60 / submenu 61, toast 70,
  busy 80, dialog 90, overlay (command palette, tooltips) 95, splash 200, fixed menu 1000.
  Values 1–50 stay component-local; add a new global layer only by updating both the token
  block and this list.
- `pnpm check:styles` (chained into `pnpm lint`) ratchets the drift: raw hex, raw
  `rgba()`/`hsl()` color functions outside a token declaration, and off-scale numeric font
  sizes may never increase per file. Safe cleanup lowers the counts; refresh the baseline with
  `node scripts/check-styles.mjs --update` only after they went down, and include
  `scripts/style-baseline.json` in the change. `--update` refuses to raise a count
  (`--force` is only for a deliberate migration). Do not raise a baseline to land a new
  one-off value — use a token or add a real scale entry instead.
- Raw colour literals are allowed only for: syntax-token palettes (`.tok-*`, markdown/JSON
  preview), win9x/light-retro bevel and shadow values, checkerboard/transparency patterns,
  and fixed white/dark text on a deliberately coloured surface. A reusable theme colour or
  surface tint must be a `--token` in `styles.css`.
- Visual consistency fixes are bounded: only duplicated inconsistencies, accessibility
  (invisible focus, contrast below 4.5:1), clear alignment/clipping bugs, or exact
  token replacements. They need approval before landing and must be checked across all
  themes; do not fold palette, layout, font-weight or animation changes into a token pass.

## Keyboard navigation

- **Commit graph** (`GraphView.vue`): `.graph-scroll` is the single tab stop
  (`role="listbox"` + `aria-activedescendant`); rows are `role="option"` with
  `aria-selected`. Arrow Up/Down, Home/End and PageUp/PageDown move the selection,
  Enter/Space select, `t` toggles the full message, and Shift+F10 / the ContextMenu key
  opens the commit menu at the selected row. Keep the inline `.msg-toggle` at
  `tabindex="-1"` so the graph stays one tab stop; mouse clicks still work. Focus is shown
  by the selected row, not a panel border — do not add an outline to `.graph-scroll:focus-visible`.
  The teal focus edge belongs to the terminal panel (`.terminal-panel:focus-within`) only.
- **Popup menus**: `useMenuKeyboard` (`utils/menuKeyboard.ts`) focuses the first enabled
  item, handles Arrow Up/Down, Home/End, Escape and Tab, and restores focus to the
  trigger. Every menu root is `role="menu"`; item roles are tagged at open time. Submenu
  triggers carry `aria-haspopup`/`aria-expanded`, use `.keyboard-open` (in addition to
  `:hover`) to show, ArrowRight opens and focuses the first submenu item, ArrowLeft/Escape
  closes it. Do not add per-menu document Escape listeners next to the composable.
- **Tabs**: repo tabs (`TabBar.vue`), terminal tabs (`TerminalPanel.vue`) and Settings tabs
  (`ToolsModal.vue`) are `role="tablist"` / `role="tab"` with `aria-selected` and a roving
  tabindex (active 0, the rest -1). Arrow Left/Right and Home/End move and activate the tab.
  Tab close buttons stay `tabindex="-1"` (Ctrl+W closes the active tab); Settings content is
  a `role="tabpanel"` tied to the active tab.
- **List rows**: sidebar branches/tags, stashes, the Changes file list, Reflog and file
  History use `handleListKeydown` (`utils/listKeyboard.ts`). The list container is the single
  tab stop (`role="listbox"`); rows are `tabindex="-1"`. Arrow Up/Down/Home/End focus rows,
  Enter/Space replay the row click, Shift+F10 / ContextMenu replays its contextmenu handler.
  The file tree's Left/Right collapse/expand a focused folder. Do not make every row a tab stop.
- **Splitters**: sidebar/changes `.panel-splitter` and `.terminal-splitter` are
  `role="separator"` with `aria-orientation` and `aria-value*`. Arrows resize by 10px,
  Shift+Arrow by 40px, Home/End jump to the bounds; mouse dragging stays unchanged.
- **Focus rings are limited to text inputs and links** (product decision): only `input`,
  `textarea`, `select` and `a[href]` get the global `:focus-visible` ring. Buttons, tabs,
  popup menus, list rows and splitters intentionally have no visible focus cue; their
  hover/active/selected states carry the UI. The terminal panel keeps its `:focus-within`
  teal edge. Never reintroduce a global `*:focus-visible` outline. Chromeless inputs inside
  a styled field (`.palette-input`, `.commit-search input`, `.workspace-add-input`,
  `.terminal-tab-rename`) suppress the outline and use the field border instead; the
  command palette's field is a pill like the create-branch prompt input.

## Keyboard shortcuts

- `SHORTCUTS` (`src/renderer/src/utils/shortcuts.ts`) is the help table in
  `ShortcutsModal.vue`, grouped by `SHORTCUT_GROUPS` in this order: Sync (Fetch,
  Pull, Push), Repository (Open repo, Clone repo, Close tab / terminal), Terminal
  (Toggle terminal, New terminal tab, Terminal tab 1…9, Terminal full height),
  General (Search commits, Open settings, Command palette, Show shortcuts) — with
  a divider under the header and a titled section per group. Every
  entry there must have a real handler. The global `keydown` handler in
  `App.vue` owns the app-level combos; `DiffView.vue` owns find-in-diff
  (`Ctrl/⌘+F` while a diff is open, `Enter` in its search box for next
  match). When adding a shortcut, add the entry to `SHORTCUTS` (with
  `group` + `mac`/`win` keys) and wire the handler.
- Sync defaults (`SYNC_SHORTCUT_DEFAULTS`): Push `Ctrl+ArrowUp`, Pull
  `Ctrl+ArrowDown`, Fetch `Ctrl+Shift+ArrowDown`. `eventToCombo()` normalizes
  events to canonical combos (`Cmd` counts as `Ctrl`); `formatCombo()` renders
  arrows (`ArrowUp` → `↑`) for `kbd` display and TabBar tooltips,
  `formatComboMac()` renders the macOS column (`Ctrl` → `⌘`).
- Customizable shortcuts (`CUSTOM_SHORTCUT_IDS` in Settings → Shortcuts tab):
  Fetch, Pull, Push, Open repo, Clone repo, Search commits, Open settings, Command
  palette, Toggle terminal. Click Change… under macOS or Windows then press keys
  (`Esc` cancels, capture listener while recording), combos must include `Ctrl`/`Cmd` (`isValidSyncCombo`),
  conflicts with fixed combos (`Ctrl+=, -, 0` zoom, `Ctrl+W` close tab / terminal tab,
  terminal tabs `Ctrl+T` / `Ctrl+1…9` / `Ctrl+Tab` / `Ctrl+Shift+Tab`, `Alt+Enter` terminal full height) or other customized ids
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
  `Ctrl+W` (fixed, works while typing — closes the active terminal tab, behind the same confirm as
  its ✕, while the keyboard is inside a terminal panel, otherwise the active repo tab behind the
  repo-close confirm; the panel's teal top edge via `:focus-within` marks that first case),
  Toggle terminal `Ctrl+` (spawns the active repo's first shell, then show/hide — never kills;
  killing every shell is palette-only `Terminal: kill all`, behind a confirm),
  New terminal tab `Ctrl+T` and terminal tab jump `Ctrl+1…9` (fixed, capture-phase; a missing
  tab/jump past the end and the per-repo cap — Settings → Terminal → Tabs, default 4 — are silent no-ops),
  Next terminal tab `Ctrl+Tab` / Previous `Ctrl+Shift+Tab` (fixed, capture-phase; cycle with wrap
  only while the keyboard is inside a terminal panel, like Ctrl+W / Alt+Enter — a single tab is a
  silent no-op),
  Terminal full height `Alt+Enter` (fixed, capture-phase; toggles the overlay only while the
  keyboard is inside a terminal panel — with focus anywhere else the key falls through untouched;
  the header buttons' tooltips carry the combo),
  Settings `Ctrl+,`, Search `Ctrl+F` on Windows / `⌘F` on macOS (commit
  history; diff search when a diff is open), Shortcuts modal `?` (outside
  text inputs), commit via `⌘↵`/`Ctrl+↵` on the summary textarea, confirm
  dialogs `Enter`/`Esc`, app zoom `⌘/Ctrl +` `−` `0` and Ctrl/⌘+wheel,
  `Esc` to close diff/deselect.
- **App shortcuts run twice on purpose**: `App.vue` registers the bubble-phase `keydown` handler and
  a capture-phase twin (`onKeyDownCapture`) that runs `handleAppShortcut()` for the app-level combos
  (open repo, clone, settings, palette, terminal toggle, terminal tabs, Ctrl+Tab / Ctrl+Shift+Tab / Ctrl+W / Alt+Enter into a
  focused terminal, commit search). The capture gate routes Ctrl/Cmd **and** Alt — only the exact app
  combos act, every other Alt key still reaches the shell. xterm stops
  propagation of character keys, so without the capture listener every one of those combos dies while
  a shell has the keyboard. The capture handler calls `stopPropagation()` after acting, so the bubble
  copy never double-fires. Keep combos the shell owns (Ctrl+Arrows sync, `Esc`, plain typing) out of
  `handleAppShortcut` — they stay in the bubble handler so readline and TUIs still receive them. The
  deliberate exceptions are Ctrl+T / Ctrl+1…9, Ctrl+W (closes the shell's tab behind a confirm) and
  Alt+Enter (toggles full height) while the terminal panel is focused: they belong to the app like in
  Windows Terminal, so a focused TUI never sees them there (it loses readline's delete-word for Ctrl+W
  and the `ESC+CR` Alt+Enter may carry for TUIs).
- **Double-Shift stays in the bubble handler**: it must not fire while typing in text fields
  (`input` / `textarea` / `contenteditable`), or capital letters would open the palette. The xterm
  helper textarea is the one exemption (`.terminal-panel .xterm`), so the palette opens from a
  focused shell like Ctrl+P does. The pending tap's reset lives in the **capture** twin: xterm
  cancels (stopPropagation) character keys, so the bubble handler never sees letters typed in the
  shell — without the capture reset, fast capitals would leave the tap armed and fire the palette.
  `lastShiftTap` lives with the keydown handlers in `App.vue`.
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
  (`updater.openRelease()` → `update:openRelease`) — no Settings detour, so the update flow
  must not deep-link `repoStore.toolsTab = 'general'`; the Updates section is reached via
  Settings → General like any other tab. (Palette Settings rows are explicit user picks,
  not a detour — see `components/AGENTS.md`.) Windows in-app download/install lives in
  `src/main/AGENTS.md`.
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
