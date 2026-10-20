export interface ListKeyboardOptions {
    /** Defaults to clicking the row (the existing mouse behaviour). */
    onActivate?: (row: HTMLElement) => void
    /** Return true when the key was consumed (e.g. a tree row expanded). */
    onArrowRight?: (row: HTMLElement) => boolean
    onArrowLeft?: (row: HTMLElement) => boolean
}

function dispatchContextMenu(row: HTMLElement): void {
    const rect = row.getBoundingClientRect()
    row.dispatchEvent(
        new MouseEvent('contextmenu', {
            bubbles: true,
            cancelable: true,
            clientX: rect.left + 24,
            clientY: rect.top + 12,
        })
    )
}

/**
 * Roving keyboard navigation for clickable list rows. The container is the single tab stop;
 * rows are `tabindex="-1"` and get focus from the arrow keys. Enter/Space activate, and
 * Shift+F10 / the ContextMenu key replay the row's existing contextmenu handler.
 */
export function handleListKeydown(event: KeyboardEvent, selector: string, options: ListKeyboardOptions = {}): void {
    const container = event.currentTarget as HTMLElement | null
    if (!container) return
    const rows = Array.from(container.querySelectorAll<HTMLElement>(selector)).filter(
        row => row.getClientRects().length > 0
    )
    if (!rows.length) return
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const target = event.target instanceof HTMLElement ? event.target : null
    if (target?.closest('button, input, textarea, select, a')) return
    const index = active ? rows.indexOf(active) : -1

    if (event.key === 'ArrowRight') {
        if (active && options.onArrowRight?.(active)) event.preventDefault()
        return
    }
    if (event.key === 'ArrowLeft') {
        if (active && options.onArrowLeft?.(active)) event.preventDefault()
        return
    }
    if (event.key === 'Enter' || event.key === ' ') {
        if (!active) return
        event.preventDefault()
        if (options.onActivate) options.onActivate(active)
        else active.click()
        return
    }
    if (event.key === 'F10' && event.shiftKey) {
        if (!active) return
        event.preventDefault()
        dispatchContextMenu(active)
        return
    }
    if (event.key === 'ContextMenu') {
        if (!active) return
        event.preventDefault()
        dispatchContextMenu(active)
        return
    }

    let next: HTMLElement | undefined
    if (event.key === 'ArrowDown') next = rows[index < 0 ? 0 : Math.min(rows.length - 1, index + 1)]
    else if (event.key === 'ArrowUp') next = rows[index < 0 ? rows.length - 1 : Math.max(0, index - 1)]
    else if (event.key === 'Home') next = rows[0]
    else if (event.key === 'End') next = rows[rows.length - 1]
    else return

    event.preventDefault()
    next?.focus()
}
