/**
 * Burst-aware localStorage adapter for pinia-plugin-persistedstate.
 *
 * The plugin writes the whole picked state on every store mutation, and panel splitters mutate a
 * persisted size on every mousemove — a drag produced a `JSON.stringify` + synchronous
 * `localStorage.setItem` per frame, which stutters on low-end Windows machines. Drag handlers wrap
 * their gesture in `beginPersistenceBurst()` / `endPersistenceBurst()` so the burst collapses to a
 * single write of the final value. Everything outside a burst keeps the plugin's original
 * write-through behaviour, so there is no delayed-write window for any other setting.
 */
const pending = new Map<string, string>()
let burstDepth = 0

export interface PersistStorage {
    getItem: (key: string) => string | null
    setItem: (key: string, value: string) => void
}

/** Start coalescing writes — call on mousedown of a drag gesture. */
export function beginPersistenceBurst(): void {
    burstDepth++
}

/** End the gesture and write the final snapshot once. */
export function endPersistenceBurst(): void {
    if (burstDepth > 0) burstDepth--
    if (burstDepth > 0 || pending.size === 0) return
    try {
        for (const [key, value] of pending) localStorage.setItem(key, value)
    } catch {}
    pending.clear()
}

export const persistStorage: PersistStorage = {
    // A queued snapshot is newer than what storage holds — return it so a re-hydrate can't roll back.
    getItem: key => pending.get(key) ?? localStorage.getItem(key),
    setItem: (key, value) => {
        if (burstDepth > 0) {
            pending.set(key, value)
            return
        }
        try {
            localStorage.setItem(key, value)
        } catch {}
    },
}
