# src/renderer/src/stores — AGENTS.md

Pinia store rules. Loaded automatically when working under
`src/renderer/src/stores`. Overall architecture lives in the root `AGENTS.md`;
app-level UI rules live in `src/renderer/AGENTS.md`.

## Store responsibilities

- `repo.ts` — repo tabs, selected commit/file/stash, commit files, branches/tags,
  solo state, and all repository loading.
- `ui.ts` — persisted UI state (theme, font size, zoom, panel widths/heights,
  shortcut overrides, update cadence, AI mode, blame lens). Panel sizes persist to
  localStorage; new resizable regions follow the same pattern (`ref` + `persist.pick`
  + mousedown drag handler).
- `updater.ts` — shared update-check state (NOT persisted: every launch starts `idle`
  so the sidebar update button stays hidden until a check finds a newer release).
- `workspace.ts` — named workspaces, each with its own persisted repo-tab session
  (paths + active tab).
- `uiTransient.ts` — the single owner of ALL toast/error feedback (see
  `src/renderer/AGENTS.md`).
- `terminal.ts` — the terminal panel's shells, keyed by repo path (memory-only, never persisted):
  tab list + label/rename/reorder, which tab shows, hidden/expanded state, panel height, and the
  close / kill-all actions that ask the main process to kill PTYs. Panel lifetime rules are load
  bearing: closing the REPO TAB kills that repo's shells (`repo.ts closeTab` calls
  `closeRepoTerminals`), while a workspace switch must not — it only recycles git instances.
  Terminal preferences (`ui.terminalShell`, `ui.terminalFontSize`) are persisted in `ui.ts`, but
  live terminal sessions are not.

## Repository loading and performance

- `repo.ts` loads local repository data (status, history, branches, and remote existence) before
  marking the repo as loaded. Local tags + remote tag status are opt-in (`refresh(..., withTags)`
  via `refreshWithTags()`): tab switches always include them, as do tag mutations and fetch/pull —
  everything else skips them so routine refreshes spawn no tag commands.
- Remote tag status is network-bound and must stay outside the awaited refresh batch.
  `loadRemoteTags()` runs it in the background, keeps a loading state for the TAGS section, and
  ignores results from an inactive repo.
- `listRemoteTags()` uses a separate `plainGit()` instance so the background network request does
  not block local Git commands. Do not add a cache or put this request back into the main refresh
  `Promise.all()` without a deliberate product decision.
- Workspace switches close only repositories that are not present in the destination workspace,
  open target repositories concurrently, and pass the already-computed active-repo status into
  `selectTab()` to avoid a duplicate `git status`.
- Keep the local loading indicators honest: local tags and remote tag status have separate loading
  states, and local tags should remain visible while remote status is loading.
