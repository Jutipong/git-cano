/**
 * Unmerged paths are reported by `git status --porcelain` as an XY code per file. Only the codes with a `U` side were
 * recognised before, so an add/add or both-deleted conflict (`AA` / `DD`) looked like an ordinary staged change and the
 * Changes panel offered no way to resolve it. Keep the full unmerged set here so both the panel and the repo store agree.
 */
const UNMERGED_CODES = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'])

export function isConflicted(file: { staged: string; unstaged: string }): boolean {
    return UNMERGED_CODES.has(`${file.staged}${file.unstaged}`)
}
