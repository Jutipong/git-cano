/**
 * Pure PATH helpers for the built-in terminal — no node/electron imports so they stay
 * unit-testable (see `tests/unit/terminalPath.test.ts`). The main process (`src/main/terminal.ts`)
 * decides *which* candidate dirs exist and calls `mergePathValue` to prepend the missing ones.
 */

/** Key in an env record that holds PATH (case-insensitive) — preserves the original casing. */
export function pathKeyFor(keys: string[], fallback: string): string {
    const found = keys.find(key => key.toLowerCase() === 'path')
    return found ?? fallback
}

/** Normalizes one PATH entry for comparison — trims whitespace/separators, folds case on Windows. */
export function normalizePathEntry(entry: string, caseInsensitive: boolean): string {
    const trimmed = entry.trim().replace(/[\\/]+$/, '')
    return caseInsensitive ? trimmed.toLowerCase() : trimmed
}

/**
 * Prepends candidate dirs missing from an existing PATH value, in order, without duplicates.
 * Comparison is case-insensitive on Windows. Empty entries are dropped. Returns the joined value.
 */
export function mergePathValue(existing: string, candidates: string[], delimiter: string, caseInsensitive: boolean): string {
    const entries = existing ? existing.split(delimiter).filter(part => part.trim() !== '') : []
    const seen = new Set(entries.map(entry => normalizePathEntry(entry, caseInsensitive)))
    const missing: string[] = []
    for (const candidate of candidates) {
        if (!candidate || candidate.trim() === '') continue
        const norm = normalizePathEntry(candidate, caseInsensitive)
        if (seen.has(norm)) continue
        seen.add(norm)
        missing.push(candidate)
    }
    return [...missing, ...entries].join(delimiter)
}
