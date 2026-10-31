# src/renderer/src/components — AGENTS.md

Panel/modal component patterns. Loaded automatically when working under
`src/renderer/src/components`. App-level UI rules live in
`src/renderer/AGENTS.md`; store rules live in
`src/renderer/src/stores/AGENTS.md`.

## Context menus

- **Keyboard behaviour is shared**: every menu root is `role="menu"` and calls
  `useMenuKeyboard` (`utils/menuKeyboard.ts`) — no local document Escape listeners. The
  composable focuses the first item, cycles with Arrow Up/Down + Home/End, closes on
  Escape/Tab and restores focus. Submenu triggers need `aria-haspopup="menu"`,
  `:aria-expanded="submenuOpen"` and a `.keyboard-open` class (alongside `:hover`);
  ArrowRight opens/focuses the submenu, ArrowLeft/Escape closes it back to the trigger.
- **Context menus are per-feature SFCs**: `CommitContextMenu.vue` (graph commits),
  `LocalBranchContextMenu.vue` (local branches), `TagContextMenu.vue`,
  `StashContextMenu.vue`, `RepoTabContextMenu.vue`, `FileContextMenu.vue`. The shared
  `ContextMenu.vue` is only for generic dropdown menus (e.g. remote branches in the
  sidebar and the `OpenInButton.vue` short-label menu: Folder / Terminal / VS Code,
  plus Kiro / Visual Studio / Rider when installed). The command palette mirrors
  it through a repo-gated `Open in…` drill-in mode (same options/conditions, `ExternalLink`
  chip) rather than flattened rows
  and the same conditions; availability is cached per repo path for the session in
  `utils/openIn.ts` (`peekOpenInTargets` / `fetchOpenInTargets`) and shared with
  `OpenInButton.vue`, so the main-process scan runs once per repo.
  Open-in Folder /
  Terminal use the catppuccin `folder` icon and andrsrxn `terminal-square` in both places.
  Palette command items must `close()` before acting/emitting (mode switches like
  Repo…/Branch…/AI…/Open in… excepted) — otherwise the palette stays open over the next dialog.
  AI actions live behind an `AI…` drill-in mode (`Sparkles` chip), gated by `aiCanRun`.
  Typing at the outermost level additionally surfaces query-driven `Open in` / `Repositories` /
  `Branches` / `Workspaces` / `AI` / `Settings` sections (top hits only — the full lists stay in
  their drill-in modes; Settings is flat by design). The Settings rows are the Tools modal's tabs
  by name (`SETTINGS_TABS` in `utils/settingsTabs.ts`) and open it straight on the picked tab — the
  modal watches `props.initialTab` so an already-open modal follows a palette pick (the palette z-95
  opens over the modal). Each row also carries a `search: 'settings'` text, so typing setting(s)
  lists every tab.
  Follow the stash pattern: export a `*MenuState` interface from the component, pass it
  through a single `menu` prop, emit a typed event per action, and import icons directly
  inside the SFC — never grow `ContextMenu.vue`'s icon registry for feature-specific items.

## DiffView & diff rendering

- **DiffView overlay**: opens as a floating card over the tab bar + sidebar + graph when a
  file row is clicked (right pane stays interactive for switching files). It is rendered as a
  direct child of `.app` — **not** inside `.app-body` — because `.app-body` has
  `overflow: hidden` and would clip anything extending above it. Has fullscreen toggle and
  close (✕). In split mode each pane keeps its own horizontal scrollbar, synced both ways
  via `onPaneScrollX` — do not hide one side again.
- **Open in editor**: the DiffView header shows one-click editor buttons (the OS default —
  Notepad / system text editor — plus VS Code; Rider, Kiro and Notepad++/Nextpad++ when detected) for
  workdir, commit and stash diffs; `FileContextMenu` mirrors them as flat items. Both call
  `openFileInEditor`, which opens the single file (the repo path is only the launcher cwd),
  never the repo folder or a C# solution. Commit/stash views open the current working-tree copy,
  so the entries are hidden only when that file is known to be deleted from the worktree.
- **File preview** (`FilePreviewModal.vue`): read-only rendered view for `.md/.markdown/.mdown`
  (via `marked` + `DOMPurify`-sanitized `v-html`) and pretty-printed `.json` (regex token colors,
  raw fallback on parse failure). Opened from the file context menu (`Preview` item in
  `FileContextMenu.vue`) and from the **DiffView header** (`Preview` text button next to the view
  controls) — both gate on the shared `isPreviewablePath()` (`utils/preview.ts`), and the DiffView
  button additionally hides when the viewed revision no longer has the file (all-`del` diff body).
  Untracked files are previewable — the content comes from the working tree. The modal is mounted
  exactly like `DiffView` (direct child of
  `.app` with `diff-overlay` + fullscreen toggle). Content comes from the `file:content` /
  `file:commitContent` / `stash:fileContent` IPC trio in `main/git.ts` (1 MB cap, binary guard) —
  never from the diff lines. The modal stays mounted while open and reloads on any
  `file`/`commitHash`/`stashHash` prop change (seq-guarded); markdown links never navigate the app
  window — http(s) opens via `app:openExternal` in the OS browser, everything else stays inert.
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
  winning overlaps. Syntax token colors win inside add/del rows except inside word-level marks (marks use `var(--text)` with inner token spans inheriting, so dim tokens like comments stay readable). The row tint
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
- **Per-pane controls (split mode)**: each pane carries a top-right overlay with Copy all and Full
  width. Copy all fetches the full blob for that side's revision (workdir: index/worktree/HEAD;
  commit: `hash` / `hash^`; stash: stash / `hash^`) and copies it as-is — never the rendered diff
  rows, which may be capped or context-limited (reuses the 1 MB `FileContent` APIs, so binary,
  oversized and missing sides report an error). Full width hides the other pane and lets the chosen
  pane span 100%; pressing it again restores 50/50, switching sides swaps the expansion. Both reset
  on file switch, inline mode and `fullFileView`; the minimap draws the expanded side alone.
- **Large-view memory**: split mode resolves rows through a segment plan
  (`splitPlan` / `splitRowAt`, virtualized per visible row) instead of a `sideBySide`
  array over every line — do not reintroduce a full row array. Meta rows (diff header,
  truncation notice, snapshot marker) render as full-width separators in split mode so
  the `capDiffLines` truncation marker stays visible in both modes — keep that. Per-line
  tokenizer state is a compact typed-array store (`computeLineStates(...).context(i)`),
  not an object per line. Image diffs render `GitImage` bytes as blob URLs and must go
  through `revokeImages()` (reload + unmount). `file:diff` payloads are capped in main
  (`capDiffLines`, 20k lines) — the truncation marker is intentional.

## Commit graph

- **Commit graph virtualization** (`GraphView.vue`): SVG edges are collected in the
  `renderEdges` computed and drawn whenever the child→parent row span intersects the
  visible window (+5 rows overscan) — NOT only when both endpoints are on screen.
  Endpoint-based culling made long lane lines vanish mid-scroll; do not reintroduce it.
  Rows have variable heights via a prefix sum (`buildPrefix`/`indexAtOffset` in
  `utils/virtual.ts`): commits with more than 5 refs get a two-line 48px row
  (chips above the message), everything else is 30px — keep every Y computation
  (nodeY, tints, ticks, spacers, focus scroll) on the prefix, never `index * rowH`.
  The visible window is re-solved both from the container's live height (scroll +
  `ResizeObserver`) and from the data itself (a `visibleCommits.length` watcher).
  An empty commit list must never collapse the window: commits load after the first
  `ResizeObserver` callback at boot, and zeroing the range there left the graph blank
  until a window resize.
  The floating to-top button (`.to-top-btn`, styles in `styles.css`) appears after ~20
  rows of scroll in both the graph and the DiffView overlay (mounted in `.diff-main`
  with `right: 30px` to clear the minimap strip — `position: relative` on `.diff-main`
  in `modern-ui.css` is what anchors it). Both scroll back with the same rAF ease-out
  (160ms, cancels an in-flight animation, jumps instantly under 120px): GraphView's
  `animateScrollTo` mirrors DiffView's `animateBodyScrollTo` — keep them in sync.
  While a diff overlay covers the graph (DiffView / ConflictView / FileHistoryModal /
  BlameModal / FilePreviewModal), App.vue passes `hide-to-top` to GraphView so the graph button hides:
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
  (bold) and the body as a `<pre>` (shown only when `commit.body`/the lazy fetch has one).
  The body is lazy by design: the log ships only `hasBody` (`%<(1,trunc)%b`), and
  `bodies`/`loadBody()` fetch `%b` through `commitBody(hash, repoPath)` on expand —
  never add `%b` back to the log payload. Flips above
  the row via `.above` when there is not enough room below — keep that behavior.

## Terminal panel

- `TerminalPanel.vue` + `TerminalView.vue` render the bottom panel under the graph. `App.vue` mounts
  **one panel per repo that owns a shell**, keyed by repo path, and keeps them mounted for the whole
  session — a repo switch, a workspace switch or the show/hide toggle only hides them. Never key the
  panel by the active repo or by tab index: that would unmount an xterm, and its PTY would keep
  running with no buffer behind it.
- **Showing the panel returns the keyboard to the shell**: a hidden panel is `display: none`, which
  blurs the focused xterm textarea, so `App.vue` keeps keyed panel refs (`terminalPanels`) and calls
  the exposed `focusActive()` after `showTerminals` in the `Ctrl+` / palette / toolbar toggle — the
  shell is ready to type without a click. The maximize/restore toggle
  (`toggleTerminalExpand`) does the same, because its teleport move detaches the panel and would
  otherwise drop focus to `<body>` in both directions. Repo/workspace switches carry the keyboard
  too whenever the target repo's panel is already visible — even when the repo being left had no
  terminal open. A hidden panel is never shown for this, and the tab strip's own Arrow/Home/End
  navigation keeps focus on the pills instead of handing it to a shell.
- **Thai rendering is the whole point of this panel** — do not “optimise” it away:
  xterm 6's DOM renderer (never `addon-canvas`/`addon-webgl`, which do no Thai shaping),
  `Unicode11Addon` with `unicode.activeVersion = '11'` (needs `allowProposedApi: true` in xterm 6),
  `lineHeight: 1.0`, the font stack `'Consolas', 'Leelawadee UI', monospace` (default from
  `ui.terminalFontFamily` — Settings → Terminal → Text offers NF presets plus a custom face, and an
  uninstalled pick resolves back to this stack), and a
  `waitForFonts()` step before constructing the `Terminal` (xterm caches the cell size measured
  during construction, and a wrong cell size pushes every combining mark off its column). The
  `.xterm` padding lives on `.xterm`, never on `.terminal-host` — FitAddon subtracts `.xterm`'s own
  padding from the parent's height, so padding on the container clips the last row.
  xterm's DOM renderer puts an inline `overflow: hidden` on every row; `modern-ui.css` overrides it
  (`.xterm-rows > div` → `overflow-x: clip; overflow-y: visible`, `!important`) because a Thai tone
  mark stacked over an upper vowel (`ที่`, `น้ำ`) rises above the 1.0 cell and the clip erased it.
  Do not drop that override.
- **The grid is solved by `fitGrid()`, never by `fit.fit()` directly.** FitAddon keeps a scrollbar
  column set (`DEFAULT_SCROLL_BAR_WIDTH`, 14px) out of the width it proposes even though
  `modern-ui.css` hides the viewport scrollbar, so `fit.fit()` alone left the grid up to two columns
  short of the panel with a dead band along its right edge — a TUI that paints its own background
  (opencode's sidebar) shows that band as a differently-coloured strip and reads as a cut-off layout.
  `fitGrid()` keeps the addon's `rows` (its height maths has no such allowance) but derives `cols`
  from the painted `.xterm-screen` cell width, then forces a full repaint with the public `refresh()`
  (replacing the addon's private `_renderService.clear()`). Do not call `fit.fit()` as well: it
  proposes the 14px-narrower grid again on every refit, so the two would flip-flop — resizing and
  repainting the screen twice per fit.
- **Terminal text size is absolute against the UI font size, but still follows the app zoom.** Electron page
  zoom carries both the UI font scale and the explicit zoom, and xterm's cell metrics and mouse coordinates stay
  in the same CSS-pixel space. `TerminalView` therefore passes `terminalFontPx(ui.terminalFontSize, ui.fontScale)`
  to xterm: Settings → Terminal's px value is what the terminal actually paints at UI font sizes 12–16, and the
  user's app zoom still magnifies the whole window. **Never scale the app with CSS `zoom` on `<html>` again** —
  xterm's mouse service divides `getBoundingClientRect()` (scaled by CSS zoom) by canvas cell metrics (not
  scaled), so every click/drag in a mouse-tracking TUI (opencode, pi) drifts by the zoom factor. App zoom goes
  through `window.api.setZoomFactor` (`webFrame.setZoomFactor` in preload); `TerminalView` re-fits the terminal
  grid when `ui.zoom` changes. If the app zoom itself is ever meant to leave terminal text unscaled, that is a
  separate product decision.
- **A blinking caret is the TUI's repaint cadence, not a font property.** xterm draws the caret as a
  cell of the grid (block/bar/underline/outline, `cursorBlink: true` here) and blinks it with a 1s
  `step-end` CSS animation scoped to `.xterm-rows.focus` — so an unfocused terminal shows the steady
  `cursorInactiveStyle` outline instead. The animation restarts whenever xterm rebuilds that cell's
  span, and a TUI redraws the caret's row on every keystroke (and on every streamed frame), which is
  why the caret looks solid while typing and blinks when idle. Reported "some fonts don't blink" is
  the same thing one step removed: the font changes the TUI's layout/repaint (and colour-sequence)
  cadence, not the caret. Do not "fix" it with DOM hacks; per-font behaviour here is expected.
- `markBars()` (TerminalView) tags spans that are a pure run of `▀` with `.terminal-bar`, and
  `modern-ui.css` paints a solid half-height `currentColor` layer behind them. That layer closes
  both the 1px seam against the filled row above and the per-cell antialiased vertical seams
  (opencode's `╹▀▀▀…` footer otherwise reads as stripes). The same pass tags meter spans
  (`████░░░`, sys-status's sidebar bars) with `.terminal-block` + `--block-count`, whose full-height
  background covers only the filled `█` cells so the `░` track keeps its dither. Retag after
  `term.onRender` — xterm recycles and rewrites those spans on every refresh. Do not raise the
  rows' `line-height` to fix the top seam: the opencode block-art wordmark only tiles at xterm's
  cell-height line-height (a taller line box shifts the `█` strokes off the row boundaries and
  breaks the art).
- **Do not add `convertEol`.** ConPTY already emits CRLF, and the reference POC leaves it off: with
  the extra CR, TUI output (opencode/pi redraws) gets different cursor semantics. Measured without
  it: LF-only output still lands in one column (no staircase) and opencode's box/logo stay intact.
  Keep every xterm option identical to the POC unless the POC changes first.
- A panel that mounts while hidden has no box: fitting or resizing it then reports 0 cols/rows. Guard
  on `clientWidth/clientHeight` and re-fit when `visible` turns true. The view also re-fits for the
  first ~2s because Chromium measures the cell height again when a fallback font lands.
- **The shell is spawned before xterm is built**, and the chunks that arrive meanwhile are buffered in
  `pending` and written once the terminal is open. Waiting for the xterm chunk + `document.fonts.ready`
  _before_ spawning left a fresh panel blank for over a second. Keep the `waitForFonts()` gate for
  `new Terminal()` itself (xterm caches its cell size at construction, and a wrong size desyncs Thai
  marks), just not for the spawn.
- Because the bundled conpty.dll (see `src/main/AGENTS.md`) withholds a new shell's first screen for
  ~3 s, the view renders a dim `Starting shell…` line (`.terminal-starting`) until the first chunk
  arrives — without it the panel just looks broken for those seconds. Do not remove that hint to
  "clean up"; drop it only if the ConPTY choice ever changes.
- Tab label = the user's rename, else `<shell> <number>` where the number is bound to the tab when
  it is created (`nextTerminalNumber`) and never reassigned — reordering or closing a neighbour
  must not rename a live shell. Rename is a double-click on the label (inline input, Enter/blur
  commits, Esc cancels, blank restores the derived label). Reorder is drag-to-reorder with the live
  `dragover` swap used by the repo tabs, so the id (and its live shell) has to travel with the tab.
  The strip scrolls horizontally once the pills outgrow it (hidden scrollbar, the `.tab-scroll`
  treatment) and the active pill follows via `scrollIntoView` in the panel's activeId watcher.
- **The whole pill is the tab's click target, not its label** (as with the repo tabs): the label is a
  plain span, `@click`/`@dblclick`/`:title` sit on `.terminal-tab`, and `onTabClick`/`onTabDblClick`
  bail while that tab is being renamed — an unguarded `activate()` would pull the caret out of the
  inline rename input. The ✕ keeps `@click.stop` and is `pointer-events: none` until the pill is
  hovered (or the tab is active) so the invisible ✕ can't swallow a press meant for the tab; CSS
  reveals it and re-enables it in one rule. Do not move the handlers back onto the label — that left
  the pill's own width and height as dead zones.
- Header buttons sit in two `.segmented` pills (the diff header's group style): `[A− A+]` for the
  font stepper and `[hide · maximize · ✕]` for the panel (`.diff-header-actions`; both terminal
  pills take an 8px button gap — `.terminal-actions .segmented` — instead of the wider diff
  toolbars' 3px, with no divider between groups; the hide button carries `.terminal-hide-btn`, a
  permanent green tint like the ✕'s permanent red). Maximize teleports the panel into `.app`
  as `.terminal-overlay` (`top: 60px` keeps it under the repo tab bar,
  `right: calc(var(--right-panel-width) + 12px)` clears the Changes pane — Settings → Terminal →
  Full window sets `ui.terminalFullWidth`, which adds `.terminal-overlay-window` (`top: 6px`,
  `right: 6px`) so the overlay covers all three columns and the repo tab bar) and hides the graph — it carries
  `.icon-btn.active` while expanded. The **docked** strip always teleports to `.app` too and floats
  over the bottom of the columns — `.terminal-docked-wide` (`left/bottom: 6px`,
  `right: calc(var(--right-panel-width) + 12px)` — the default, Sidebar + Graph) or
  `.terminal-docked-full` (all three columns, with the setting on), height from `terminalStore`; the
  drag handle is `.terminal-splitter-wide` / `.terminal-splitter-full`, both riding `--terminal-height`
  on `.app`. Hide (`chevron-down`) only flips `hidden`: it never touches the
  shells and never resizes, so a full-height panel comes back as the overlay (same as the `Ctrl+` /
  palette toggle — `hideTerminals(path)` in `terminal.ts` keeps `expanded`); the minimize button is
  the only way back to the strip. The ✕ kills every shell of THIS
  repo. Both ✕s confirm through `ConfirmDialog`; only a shell that exits by itself does not. The
  strip shares the diff-view scale: 31px pills (tab, `+`, the two `.segmented` groups), 25px
  buttons with 15px icons inside them, a 12px mono tab label and a 120px tab minimum; the
  header's 10px side padding matches the xterm inset — keep those in step with the diff header
  instead of inventing a second compact scale.
- **Links open in the OS browser**: `@xterm/addon-web-links` handles plain-text URLs and the
  `linkHandler` terminal option covers OSC 8 hyperlinks; both call `openLink` (http(s) only) which
  routes through `app:openExternal`. Activation requires Ctrl/Cmd+click
  (`shouldActivateTerminalLink` in `utils/terminalLinks.ts`) — never enable plain-click activation,
  and never fall back to the addon's default `window.open` handler: it spawns an Electron window,
  not the user's browser.
- **Copy is app-implemented on top of the shell's interrupt key** (`terminalCopyDecision` in
  `utils/terminalCopy.ts` + `attachCustomKeyEventHandler` in `TerminalView.vue`): Ctrl+Shift+C always
  copies, a plain Ctrl+C on Windows/Linux copies only while text is selected (otherwise xterm's ETX
  interrupt stays untouched), and macOS uses Cmd+C without ever stealing Ctrl+C. A copy press calls
  `preventDefault()` and returns `false` so xterm writes no `0x03`, then clears the selection so the
  next Ctrl+C interrupts a running command again. Never bind a plain Ctrl+C to copy unconditionally —
  that takes the interrupt away from the shell.
- **Terminal tab shortcuts are fixed and capture-phase**: `Ctrl+T` opens a shell (`newTerminalTab` in
  `App.vue`, reached through `handleAppShortcut`), like Windows Terminal. `Ctrl+Tab` cycles to the
  next tab and `Ctrl+Shift+Tab` to the previous one, with `Alt+→` / `Alt+←` as the Windows-Terminal-style twin;
  all wrap at either end — scoped to a focused panel (the same `isTerminalPanelFocused()` guard as
  Ctrl+W / Alt+Enter) so they never hijack the gesture outside the terminal; the panel's activeId
  watcher hands the keyboard to the new shell. They must stay in the capture handler — xterm
  swallows the keys — which is also why a shell/TUI never sees them (deliberate exception to the
  "keep shell combos in the bubble handler" rule). The Alt combos are handled **only** inside the
  panel: everywhere else the app leaves them untouched so text fields keep Option+Arrow word motion.
  A missing tab, a single tab and the per-repo cap (Settings → Terminal → Tabs, default 4) are
  silent no-ops (no toast); a hidden panel is shown first. The combos are reserved in
  `isReservedCombo` and documented in `SHORTCUTS`.
- **Ctrl+W follows the keyboard**: while focus is inside a terminal panel (`isTerminalPanelFocused()`
  in `App.vue`, consulted by the capture-phase twin), Ctrl+W closes the repo's active terminal tab
  through the same confirm as its ✕ — a cancelled confirm hands focus back to the shell, so the next
  Ctrl+W still targets the terminal instead of falling through to the repo tab. Focus anywhere else
  keeps the existing bubble-phase behavior (close the active repo tab). The panel announces this
  state with a teal edge (`.terminal-panel:focus-within` in `modern-ui.css`); keep that CSS condition
  in step with the JS check, or the edge stops predicting what Ctrl+W will do.
- **Alt+Enter toggles full height only while the panel has focus**: `handleAppShortcut` matches it
  behind the same `isTerminalPanelFocused()` guard as Ctrl+W, so the graph, text inputs and any other
  Alt+Enter habit keep the key; with a shell focused it is captured before xterm and toggles
  `toggleTerminalExpand`, which hands focus back to the shell like the header button. The header
  buttons carry the combo in their tooltips (`Full height (Alt+Enter)` / `Exit full height
(Alt+Enter)`) — e2e locators match those titles, so update both together.
- **Kill every terminal is palette-only — no panel button, no shortcut.** It ends shells of repos that
  are not even on screen, so it has exactly one home: the `Terminal: kill all` palette item, behind
  a confirm. Do not add a header button or a shortcut back.

## Shared component patterns

- **Close (✕) buttons** always use the `.icon-btn danger commit-close-btn` style (red ring +
  tinted background, hover intensifies — see `.commit-close-btn` in `styles.css`). Reuse that
  class on any close/dismiss ✕ button in panels and modals; never invent a one-off close style.
  The circle and the ✕ are drawn by the `CloseXIcon.vue` component (single SVG, always
  concentric) — don't swap it back for a plain `<i-lucide-x>` icon. Its `.close-x-svg` is
  `position: absolute; inset: 0`, so any new parent must be a positioned box (`position: relative`,
  as `.commit-close-btn` is) or the invisible ring stretches over the whole panel and swallows every
  click. A tiny variant must keep that positioned parent (`.commit-close-btn`) or pin the icon with
  `.close-x-svg { position: static; width/height: N }`.
- **Button loading state** always swaps the icon for a compact `ThinkSpinner` (`v-if` on the busy
  flag / `v-else` the icon — `compact` inherits the button color), never spins the icon itself
  with `.spinning`. Precedents: `TabBar.vue` sync buttons, `FilePanel.vue` commit + refresh buttons,
  `Sidebar.vue` tags refresh button.
- **Modal text inputs** take focus programmatically: `v-if` modals (`TagCreateModal.vue`,
  `StashCreateModal.vue`, `CloneRepoModal.vue`) use `useTemplateRef` + `nextTick(() => el?.focus())`
  in `onMounted` — native `autofocus` alone only focuses the first open, never the reopen.
  Persistently-mounted store modals (`PromptDialog.vue`, `ConfirmDialog.vue`, `ErrorDialog.vue`)
  focus via `watch(..., { flush: 'post' })` instead.
- **A template ref inside `v-for` is collected as an array** (the compiler emits `ref_for: true` and
  Vue writes `[element]` into the ref), so a single `ref="name"` in a loop makes
  `ref.value?.focus()` throw "… is not a function" — the box renders but never gets the caret.
  Use a keyed function ref (`:ref="el => (inputs[key] = el as HTMLInputElement | null)"` →
  `inputs.value[key]`), as `TerminalPanel.vue` (`views`, `renameInputs`) and `WorkspaceButton.vue`
  (`renameInputs`) do. Do not "fix" this by indexing `ref.value[0]` — the ref carries no stable type.
- **Create-form modals share the confirm family**: `TagCreateModal.vue`, `StashCreateModal.vue`
  and `PromptDialog.vue` (branch create) all use `.confirm-dialog-overlay` + `.confirm-dialog`
    - `.confirm-dialog-header.flow` (icon + title + optional `chip`/`prompt-chip` context) +
      `.confirm-dialog-body` + `.confirm-dialog-actions` at `400px` (via `.tag-confirm` or
      `:has(.prompt-input)`). Do not build new forms on `.rebase-modal`/`.tag-modal-body`.
      `AppRadio` in a `v-for` must bind `:value="opt.value"` — without it no option ever matches
      and clicks emit the garbage value `"on"`. The local-changes choice lives in persisted
      `ui.localChangesMode` (default `stash`), shared by branch create and switch.
      The global `.busy-overlay` (z-80) sits **below** `.confirm-dialog-overlay` (z-90), so a create
      modal that stays open during `withBusy` must show its own loading: swap the primary button's
      icon for a compact `ThinkSpinner` with a phase label (`Creating…`/`Pushing…`/`Saving…`) and
      disable its inputs (plus `AppCheckbox` via its `disabled` prop) — never raise the busy overlay,
      it would bury `ErrorDialog` (also z-90).
- **Settings-family modals keep their own structure**: `ToolsModal.vue` (720px, teal identity,
  dense `btn small` buttons, section cards) and `GraphSettingsModal.vue` (400px) stay on
  `.rebase-modal`/`.modal-overlay` — only the create forms use the confirm family. Their text
  inputs/selects still speak the same pill language (`7px 12px`, `var(--radius-pill)`), header
  icons are `17px`, and the readonly column checks match the `18px` checkbox boxes. Its tab strip is
  a single non-wrapping row of equal-width pills (`flex: 1 1 0`), six tabs (Appearance / General /
  Remotes / AI / Terminal / Shortcuts) measuring ~110px each in the ~680px strip, so a seventh tab
  needs a measured width check, not a guess — and its key/label belongs in `SETTINGS_TABS`
  (`utils/settingsTabs.ts`), the single source of truth shared by the store's `toolsTab`, the modal
  strip and the palette's Settings rows. `repoStore.toolsTab` is a **one-shot deep-link** for those
  palette rows: `closeTools` in `App.vue` clears it back to `'appearance'` on every close (Esc / ✕),
  so a plain open (`Ctrl+,` / the sidebar gear / the palette's plain Settings row) always starts on
  Appearance instead of the last palette pick — never treat it as "remember the last tab".
- **Settings (`ToolsModal.vue`) has no Zoom control** — zoom lives only in the `App.vue`
  global handler (`⌘/Ctrl + − 0`, Ctrl/⌘+wheel). Do not re-add Zoom chips.
