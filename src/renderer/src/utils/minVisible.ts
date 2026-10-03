import { onScopeDispose, ref, watch } from 'vue'

export interface MinVisibleOptions {
    /** Hold the source back this long before showing anything — work that finishes sooner never flashes. Default 0 (show immediately). */
    showDelayMs?: number
    /** Once shown, stay visible at least this long — even when the source goes false sooner. */
    minVisibleMs: number
}

/**
 * Stabilizes a fast-changing boolean source for display: nothing shows until it has stayed true for
 * `showDelayMs`, and once shown it remains visible for at least `minVisibleMs` (measured from the
 * moment it appeared). A source that turns true again while the minimum is running keeps the flag
 * up continuously — the hold is never restarted from scratch.
 */
export function useMinVisible(source: () => boolean, options: MinVisibleOptions) {
    const showDelayMs = options.showDelayMs ?? 0
    const minVisibleMs = options.minVisibleMs
    const visible = ref(false)
    let shownAt = 0
    let showTimer: ReturnType<typeof setTimeout> | null = null
    let hideTimer: ReturnType<typeof setTimeout> | null = null

    function clearShow() {
        if (showTimer) {
            clearTimeout(showTimer)
            showTimer = null
        }
    }

    function clearHide() {
        if (hideTimer) {
            clearTimeout(hideTimer)
            hideTimer = null
        }
    }

    watch(
        source,
        value => {
            if (value) {
                clearHide()
                if (visible.value || showTimer) return
                if (showDelayMs <= 0) {
                    shownAt = Date.now()
                    visible.value = true
                    return
                }
                showTimer = setTimeout(() => {
                    showTimer = null
                    shownAt = Date.now()
                    visible.value = true
                }, showDelayMs)
                return
            }
            clearShow()
            if (!visible.value) return
            const remaining = minVisibleMs - (Date.now() - shownAt)
            if (remaining <= 0) {
                visible.value = false
                return
            }
            clearHide()
            hideTimer = setTimeout(() => {
                hideTimer = null
                visible.value = false
            }, remaining)
        },
        { immediate: true }
    )

    onScopeDispose(() => {
        clearShow()
        clearHide()
    })

    return visible
}
