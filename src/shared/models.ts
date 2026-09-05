import type { GoModel } from './types'

export function toGoModel(id: string): GoModel {
    // No display-name table: the provider is the single source of truth, so the
    // raw id is shown as-is (OpenRouter supplies its own names via API).
    return { id, name: id, ...(isFreeZenId(id) ? { free: true as const } : {}) }
}

/**
 * Detects free-tier Zen models from a live catalog id. The /models endpoints return ids only with no pricing flags — free models carry a
 * `-free` suffix (per official Zen docs pricing table); `big-pickle` is the documented exception (stealth model, free for a limited time,
 * no suffix).
 */
export function isFreeZenId(id: string): boolean {
    return id.endsWith('-free') || id === 'big-pickle'
}
