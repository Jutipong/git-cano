# tests — AGENTS.md

Testing rules for the two layers. Overall architecture lives in the root `AGENTS.md`.

## Layers

- `tests/unit` — Vitest, `pnpm test:unit`. Pure logic only: no electron, no Vue component mounting.
  - Main-process parsers live in `src/main/parsers.ts` (no electron imports) for this reason; keep new pure
    helpers there or in `src/shared/` instead of inside `git.ts`.
  - Split-view row planning lives in `src/renderer/src/utils/diffPlan.ts` for the same reason.
  - `tests/unit/diffPlan.test.ts` is a parity fuzz against a reference implementation — when the row mapping
    changes intentionally (e.g. meta rows became separators), update the reference in the test too.
- `tests/e2e` — Playwright driving the **built** Electron app (`pnpm test:e2e` builds `out/` first).
  - `app.spec.ts` covers the memory/payload work (lazy commit bodies, diff caps, blob-URL images, split plan,
    tokenizer state, graph interactions, AI context cap).
  - `conflict.spec.ts` covers the conflict flow.
  - `fixtures.ts` creates throwaway repos in the OS temp dir (`globalSetup` writes a metadata file the specs load).
  - `launch.ts` is the only way to start the app in tests.

## E2E rules

- **Isolation is mandatory**: `launchApp()` passes `--user-data-dir=<temp>` (Electron maps both `userData` and
  `sessionData` to it). Do NOT try to isolate via the `APPDATA` env var — Electron ignores it and the run will
  overwrite the real `%APPDATA%\git-cano` profile (recent.json + workspace localStorage).
- Specs are `serial` and each spec file launches its own app; fixtures are shared per run, so do not commit in a
  repo another spec asserts on unless the spec owns that repo. Add new fixture repos in `fixtures.ts` instead.
- Use UI assertions for behavior and `window.api` for setup/verification:
  `(window as unknown as { api: any }).api.<call>()`. Never assert on renderer internals.
- Determinism: no network. The AI test uses a fake token and only asserts the call fails fast with bounded memory.
- `GIT_CANO_LOG_LEVEL=debug` is safe (baseEnv strips every `git*` key before spawning git). Any new `GIT_*` env
  injected into git must be added to `SAFE_UNSAFE_OPTIONS.allowEnvironment` first, or every spawn will throw.
- Selector conventions: `.repo-tab`, `.graph-row`, `.file-row`, `.diff-line` / `.split-pane`, `.diff-body`,
  `.conflict-view`, `.blame-lens-tip`, `.toast`. Prefer role/title-based locators for buttons.
- Playwright output goes to the OS temp dir (`GITCANO_E2E_ARTIFACTS` overrides); CI uploads it on failure.
- `retries: 1` and `forbidOnly` apply when `CI=true`.

## Memory benchmark

- `memory-bench.spec.ts` is skipped unless `GITCANO_BENCH=1`. It measures main heap/RSS plus renderer heap
  (CDP `Runtime.getHeapUsage` after a forced GC) across: commit clicks, a 5k-commit log, 100k/25k entire-file
  views, and a 3MB image diff. Fixtures `bulkRepo` / `hugeRepo` / `big.bmp` exist for it.
- Current build: `GITCANO_BENCH=1 pnpm exec playwright test tests/e2e/memory-bench.spec.ts`
- Another build (e.g. `git worktree add <dir> HEAD` then `pnpm install && pnpm build` in it): add
  `GITCANO_E2E_APP_DIR=<dir>` and `GITCANO_BENCH_LABEL=<name>`.
- The pre-`baseEnv`-sweep build cannot survive `GIT_CANO_LOG_LEVEL` (its guard blocks the `git*` env), so
  `launch.ts` drops that env whenever `appDir` is set.

## Commands

- `pnpm test:unit` / `pnpm test:unit:watch`
- `pnpm test:e2e` (builds first; ~25s locally)
- `pnpm test` — full gate before release
