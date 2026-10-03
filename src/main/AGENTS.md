# src/main — AGENTS.md

Main-process rules. Loaded automatically when working under `src/main`. The
root `AGENTS.md` holds the always-on rules (architecture, commands, conventions).

Data flow: renderer → `window.api` (preload IPC) → `main/index.ts` handlers →
`src/main/git.ts` → simple-git. Never call git from the renderer.

## Git environment (simple-git)

`src/main/git.ts` injects credentials/config per command (`authGitEnv()` via `withAuthEnv`). simple-git v4
adds an environment guard that rejects any injected `git_*` key not listed in
`SAFE_UNSAFE_OPTIONS.allowEnvironment` ("blocked by the environment guard") — the older `unsafe.*` flags
cover a different check and are not a substitute. Current keys: `GIT_SSH_COMMAND`,
`GIT_CONFIG_COUNT` / `GIT_CONFIG_KEY_0` / `GIT_CONFIG_VALUE_0`, `GIT_EDITOR`,
`GIT_SEQUENCE_EDITOR` (the interactive-rebase helper). Both `createGit()` and
`plainGit()` share `SAFE_UNSAFE_OPTIONS`; when adding a new injected env var, add it there too.

The guard also blocks guarded **ambient** vars (EDITOR, VISUAL, PAGER, PREFIX, GIT_CONFIG*…), and
`baseEnv()` injects the whole process env — so any of them present on the user's machine makes
`git status` throw "blocked by the environment guard" and `openRepo()` report "not a git
repository". `GUARDED_AMBIENT_ENV_KEYS` strips them before every git call; do not remove it (the
full guarded list lives in `@simple-git/argv-parser`). Keep that strip inside `baseEnv()` — without
it repos stop opening for anyone with `EDITOR`/`VISUAL` set.

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
- **OpenCode Go session header**: every Go request sends `x-opencode-session` (one
  `randomUUID()` per generate call, reused across the effort-fallback retries) plus a
  `git-cano/<version>` user agent — Go's docs require non-OpenCode clients to identify
  the conversation for routing and prompt caching. Dropping either one makes Go fail with
  "Request is missing x-opencode-session". OpenRouter requests keep their own
  `HTTP-Referer` / `X-Title` headers instead.
- **Budgets**: commit generation uses 512 output tokens; on a persistent length cutoff
  (after the `minimal → low → none` effort fallbacks) it retries once with a doubled
  budget (cap 2048). `testConnection()` uses production-like conditions (128 tokens,
  empty replies rejected) so a pass means real generation likely works.
- **Context hygiene** (`getChangesContext()`): untracked previews skip binary files
  (NUL-byte probe) and files >256KB with an `(content omitted)` marker; prompt
  truncation (`truncateForPrompt()`) cuts on a line boundary. Empty model replies are
  logged raw to the log file but shown to the user as a clean message.
  `cleanModelMessage()` strips fences plus one layer of surrounding quotes/backticks.
- **Model catalogs**: OpenCode Go lists exactly the Go catalog (`GO_MODELS_URL`); the Zen
  catalog is deliberately never merged in — its free lineup is blocked for third-party
  clients (403 "only from within OpenCode") and would not route through the Go endpoint.
  Free-tier detection (`-free` suffix) lives only in `isFreeZenId()` (`shared/models.ts`)
  — never re-implement it. Offline fallback is per-provider (`lastKnownModels(provider)` —
  OpenRouter falls back to its own persisted list, not `[]`).
- **Format-before-generate** (`formatRepoIfConfigured()`): the formatter only touches
  the worktree, so it runs only for scope `'all'` (auto commit modes, where a later
  `stageAll()` picks the formatted result up). For `'staged'` (Generate Only) it is
  skipped — formatting would dirty the worktree without ever reaching the message,
  and Generate Only must not touch the index.
- `COMMIT_SYSTEM_PROMPT` enforces one-line Conventional Commits output; keep it terse.

## Undo journaling

Undo toasts (`utils/undo.ts` → `notifyUndoable` in the renderer) journal their pre-op state in
`main/git.ts`: commit/amend, revert, squash, soft/mixed reset, rebase (native + interactive),
cherry-pick, merge, and stash delete. State is kept in per-repo stacks, cap 10, cleared on
`closeRepo`. Undo resolves through an id-guarded `git:undo` IPC call so a stale toast can't undo a
newer action.

Rules: journal only fully recoverable ops — hard reset and anything already pushed are excluded
(no entry = no Undo button, plain toast); history-rewriting ops journal only from a clean tree
(dirty tree = plain toast, and interactive rebase refuses to start dirty); destructive restores
re-check dirtiness at undo time so a retry stays possible; cross-branch fast-forward merges use a
`branchTip` entry restored via compare-and-swap `update-ref`; undo paths must `bumpStashList()`
because `StashPanel` loads outside `refresh()`. Squash reuses the `commit` undo kind (`reset --soft
headBefore` restores the range, the tree is identical) — do not add a new undo kind for it. Conflict
flows (merge/cherry-pick/rebase continuations) are owned by abort — never journal them.

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

## Interactive rebase

- The engine is the real `git rebase -i` (`startInteractiveRebase(baseRef, entries)` in
  `main/git.ts`, `rebase:start` IPC → `window.api.rebaseStart`). Do NOT go back to replaying
  commits with `cherry-pick` — that could not squash/fixup and replayed the whole plan on resume.
- Repo pinning: `RebaseEditor.vue` captures `repoStore.repo?.path` when it opens and passes it to
  `rebase:plan` / `rebase:start`; main resolves it via `getRepoFor(dir)`. The modal can outlive a
  tab switch, so the rebase must never target whichever repo is active at Start time.
- `startInteractiveRebase` refuses to run while another rebase/merge/cherry-pick is open
  (`rebase-merge`/`rebase-apply`/`MERGE_HEAD`/`CHERRY_PICK_HEAD`) — otherwise `git rebase -i`
  fails and the pause-detection would misreport it as a paused rebase.
- The todo is written by us: a Node helper runs through `ELECTRON_RUN_AS_NODE` as both
  `GIT_SEQUENCE_EDITOR` (writes `git-rebase-todo`) and `GIT_EDITOR` (writes the reword/squash
  message). It reads the plan JSON (`.git/git-cano-rebase-plan.json`) via the `GITCANO_REBASE_PLAN`
  env var — never name it `GIT_*`, simple-git's environment guard strips/blocks those.
  `GIT_SEQUENCE_EDITOR` must stay in `SAFE_UNSAFE_OPTIONS.allowEnvironment`.
- The message helper parses COMMIT_EDITMSG's "Last command(s) done" block and keeps the last
  `reword|squash` line: a squash followed by fixup(s) opens the editor once and the block ends with
  the fixup, so the last command is not the one carrying the message.
- Conflict and `edit` pauses are detected by `rebase-merge`/`rebase-apply` existing after the call;
  they are NOT an error — the rebase stays in progress and the Changes panel (`FilePanel.vue`,
  which already handles `repoState.rebasing`) resolves/continues/aborts it. A failure with no rebase
  state is a real error (plan cleaned up + thrown).
- `edit` pauses with no conflicts: `FilePanel.vue` shows the commit box plus an Amend button
  (`amendStoppedCommit` → `commitWithAmend(msg, true)`), because `git rebase --continue` on staged
  changes makes a new commit, not an amend.
- `split` was removed — `git rebase -i` has no such command. Offered commands: pick / reword /
  squash / fixup / edit / drop.
- `getRebasePlan` lists `--no-merges baseRef..HEAD`; merges are dropped by the rebase, matching
  git's default (no `--rebase-merges`).
- Undo is journaled only on completion: the interactive rebase records `origHead` in
  `interactiveRebases` and pushes a hard `reset` entry when it finishes (in `start` or in
  `rebase:continue`). `rebaseContinue` returns `{ completed, undoable }` so FilePanel offers Undo
  only for the interactive rebase, never for a pull-rebase completion.
- `RebaseEditor.vue` is a planner only: it emits `done` (completed → App shows the Undo toast) or
  `paused` (conflicts/edit → modal closes, warning toast, FilePanel takes over).

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
- The scope is measured on the current branch's **HEAD chain** (`headChain` / `chainIndex` in
  `GraphView.vue`: from HEAD following `parents[0]`), never the raw graph index. `getLog` lists
  every ref (`--branches --remotes --tags`), so row 0 is not necessarily HEAD — index-based
  counting let HEAD / other-branch rows offer Squash, which then failed in `getSquashPlan`
  ("Select an older commit" / "Only commits on the current branch can be squashed"). Commits
  off the chain (including merged-branch commits) get no Squash, matching the merge rejection.
- Modal (`SquashModal.vue`, styles in `modern-ui.css` `.squash-*`): lists the exact range
  newest-first with HEAD / keeps-message badges, defaults the message to the oldest subject
  with the FilePanel-style soft length counter, and blocks on a dirty worktree.

## Updates & releases (main process)

- In-app download/install (`downloading` → `downloaded`) works only in the installed
  Windows build: `src/main/updater.ts` wraps `electron-updater` (`autoDownload: false`,
  progress/error events forwarded as `update:progress` / `update:downloaded` /
  `update:error`), exposed via `update:*` IPC (`preload/index.ts`, typed in
  `shared/types.ts`). `isAutoUpdateSupported()` is win32 + packaged;
  everything else falls back to `update:openRelease`.
- The native Window menu is hand-written in `setupMenu()` (`main/index.ts`) on both
  platforms, because the stock `windowMenu` role can't be extended; it holds only
  What's new and About Git Cano → the repo. macOS's app menu is hand-written too, with
  `{ role: 'about', visible: false }` to hide the stock About dialog. On Windows/Linux
  the Close role stays as a `visible: false` item purely to keep the
  `Cmd/Ctrl+Shift+W` close-window accelerator registered — dropping it outright would
  take the shortcut with it.
- Release flow per version: bump `package.json` version → `pnpm dist:win` (Windows:
  Setup `.exe` via NSIS) / `pnpm dist:mac` (Mac, arm64 dmg) →
  `git tag v<version>` → GitHub Release from that tag with the `release/` assets
  uploaded (`release/` is gitignored, never committed). The `latest.yml` next to the
  Setup `.exe` is required — it is the electron-updater feed. Unsigned macOS builds stay
  manual-download (SmartScreen/Gatekeeper bypass stays in README).
