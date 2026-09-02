/**
 * Shared helpers for windowed (virtual) list rendering where rows may have non-uniform heights (e.g. ConflictView's block-outline borders).
 * Row offsets come from a cumulative prefix array: prefix[i] = top offset of row i, prefix[n] = total content height.
 */

/** Cumulative offsets for row heights. */
export function buildPrefix(heights: ArrayLike<number>): Float64Array {
    const prefix = new Float64Array(heights.length + 1)
    for (let i = 0; i < heights.length; i++) prefix[i + 1] = prefix[i]! + heights[i]!
    return prefix
}

/** Index of the row containing vertical offset `y` (binary search over the prefix). */
export function indexAtOffset(prefix: ArrayLike<number>, y: number): number {
    let lo = 0
    let hi = prefix.length - 1
    let res = 0
    while (lo <= hi) {
        const mid = (lo + hi) >> 1
        if (prefix[mid]! <= y) {
            res = mid
            lo = mid + 1
        } else {
            hi = mid - 1
        }
    }
    return res
}

/** Visible window [start, end) plus spacer heights for a scroller at `scrollTop`. */
export function windowFor(prefix: ArrayLike<number>, scrollTop: number, viewportH: number, overscanPx: number, fallbackVh: number) {
    const total = prefix.length ? prefix[prefix.length - 1]! : 0
    if (!total) return { start: 0, end: 0, padTop: 0, padBottom: 0 }
    const vh = viewportH || fallbackVh
    const start = indexAtOffset(prefix, Math.max(0, scrollTop - overscanPx))
    const end = Math.min(prefix.length - 1, indexAtOffset(prefix, scrollTop + vh + overscanPx) + 1)
    return { start, end, padTop: prefix[start]!, padBottom: total - prefix[end]! }
}
