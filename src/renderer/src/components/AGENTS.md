# src/renderer/src/components — AGENTS.md

Panel/modal component patterns. Loaded automatically when working under
`src/renderer/src/components`. App-level UI rules live in
`src/renderer/AGENTS.md`; store rules live in
`src/renderer/src/stores/AGENTS.md`.

## Context menus

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
  Terminal use catppuccin `folder` / `bash` icons in both places.
  Palette command items must `close()` before acting/emitting (mode switches like
  Repo…/Branch…/AI…/Open in… excepted) — otherwise the palette stays open over the next dialog.
  AI actions live behind an `AI…` drill-in mode (`Sparkles` chip), gated by `aiCanRun`.
  Typing at the outermost level additionally surfaces query-driven `Open in` / `Repositories` /
  `Branches` / `Workspaces` / `AI` sections (top hits only — the full lists stay in their drill-in modes).
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
- `markBars()` (TerminalView) tags spans that are a pure run of `▀` with `.terminal-bar`, and
  `modern-ui.css` paints a solid half-height `currentColor` layer behind them. That layer closes
  both the 1px seam against the filled row above and the per-cell antialiased vertical seams
  (opencode's `╹▀▀▀…` footer otherwise reads as stripes). Retag after `term.onRender` — xterm
  recycles and rewrites those spans on every refresh. Do not raise the rows' `line-height` to fix
  the top seam: the opencode block-art wordmark only tiles at xterm's cell-height line-height (a
  taller line box shifts the `█` strokes off the row boundaries and breaks the art).
- **Do not add `convertEol`.** ConPTY already emits CRLF, and the reference POC leaves it off: with
  the extra CR, TUI output (opencode/pi redraws) gets different cursor semantics. Measured without
  it: LF-only output still lands in one column (no staircase) and opencode's box/logo stay intact.
  Keep every xterm option identical to the POC unless the POC changes first.
- A panel that mounts while hidden has no box: fitting or resizing it then reports 0 cols/rows. Guard
  on `clientWidth/clientHeight` and re-fit when `visible` turns true. The view also re-fits for the
  first ~2s because Chromium measures the cell height again when a fallback font lands.
- **The shell is spawned before xterm is built**, and the chunks that arrive meanwhile are buffered in
  `pending` and written once the terminal is open. Waiting for the xterm chunk + `document.fonts.ready`
  *before* spawning left a fresh panel blank for over a second. Keep the `waitForFonts()` gate for
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
- Header buttons sit in two `.segmented` pills (the diff header's group style): `[A− A+]` for the
  font stepper and `[hide · maximize · ✕]` for the panel (`.diff-header-actions`, same `gap: 6px`
  and divider-free grouping as diff-view). Maximize teleports the panel into `.app`
  as `.terminal-overlay` (`top: 60px` keeps it under the repo tab bar,
  `right: rightPanelWidth + 12px` clears the Changes pane) and hides the graph — it carries
  `.icon-btn.active` while expanded. Hide (`chevron-down`) collapses the panel back into the graph
  toolbar button / `Ctrl+` / palette and never touches the shells; the ✕ kills every shell of THIS
  repo. Both ✕s confirm through `ConfirmDialog`; only a shell that exits by itself does not. The
  strip shares the diff-view scale: 31px pills (tab, `+`, the two `.segmented` groups), 25px
  buttons with 15px icons inside them, a 12px mono tab label and an 88px tab minimum; the
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
  + `.confirm-dialog-header.flow` (icon + title + optional `chip`/`prompt-chip` context) +
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
  needs a measured width check, not a guess.
- **Settings (`ToolsModal.vue`) has no Zoom control** — zoom lives only in the `App.vue`
  global handler (`⌘/Ctrl + − 0`, Ctrl/⌘+wheel). Do not re-add Zoom chips.
