import { nextTick, onBeforeUnmount, watch } from 'vue'

interface MenuKeyboardOptions {
    active: () => boolean
    container: { readonly value: HTMLElement | null }
    onClose: () => void
    /** Return true when the key was consumed (e.g. an open submenu should close first). */
    onEscape?: () => boolean
    onArrowRight?: (item: HTMLElement) => boolean
    onArrowLeft?: (item: HTMLElement) => boolean
    restoreFocus?: { readonly value: HTMLElement | null }
}

const stack: symbol[] = []

function itemsIn(container: HTMLElement | null): HTMLElement[] {
    if (!container) return []
    const items = Array.from(container.querySelectorAll<HTMLElement>('button, input, [role="menuitem"]')).filter(
        item => !item.hasAttribute('disabled') && item.getClientRects().length > 0
    )
    for (const item of items) if (item.tagName === 'BUTTON') item.setAttribute('role', 'menuitem')
    return items
}

function focusItem(item: HTMLElement | null | undefined): void {
    item?.focus({ preventScroll: true })
}

/**
 * Keyboard plumbing for popup menus: focus the first enabled item, cycle with Arrow keys,
 * Home/End, close on Escape/Tab, and (optionally) hand ArrowLeft/Right to a submenu owner.
 */
export function useMenuKeyboard(options: MenuKeyboardOptions): void {
    const id = Symbol('menu')
    let open = false
    let restoreTarget: HTMLElement | null = null

    function isTop(): boolean {
        return stack[stack.length - 1] === id
    }

    function onKeydown(event: KeyboardEvent): void {
        if (!open || !isTop()) return
        const container = options.container.value
        if (!container) return
        const active = document.activeElement instanceof HTMLElement ? document.activeElement : null
        const items = itemsIn(container)

        if (event.key === 'Escape') {
            if (options.onEscape?.()) {
                event.preventDefault()
                event.stopPropagation()
                return
            }
            event.preventDefault()
            event.stopPropagation()
            options.onClose()
            return
        }
        if (event.key === 'Tab') {
            event.preventDefault()
            event.stopPropagation()
            options.onClose()
            return
        }
        if (event.key === 'ArrowRight') {
            if (active && options.onArrowRight?.(active)) {
                event.preventDefault()
                event.stopPropagation()
            }
            return
        }
        if (event.key === 'ArrowLeft') {
            if (active && options.onArrowLeft?.(active)) {
                event.preventDefault()
                event.stopPropagation()
            }
            return
        }
        if (!items.length) return

        const index = active ? items.indexOf(active) : -1
        let next: HTMLElement | null = null
        if (event.key === 'ArrowDown') next = items[(index + 1 + items.length) % items.length]
        else if (event.key === 'ArrowUp') next = items[(index - 1 + items.length) % items.length]
        else if (event.key === 'Home') next = items[0]
        else if (event.key === 'End') next = items[items.length - 1]
        else return

        event.preventDefault()
        event.stopPropagation()
        focusItem(next)
    }

    function attach(): void {
        if (open) return
        open = true
        stack.push(id)
        document.addEventListener('keydown', onKeydown, true)
    }

    function detach(): void {
        if (!open) return
        open = false
        const index = stack.lastIndexOf(id)
        if (index !== -1) stack.splice(index, 1)
        document.removeEventListener('keydown', onKeydown, true)
    }

    function restore(): void {
        const target = restoreTarget
        restoreTarget = null
        if (target?.isConnected && target.getClientRects().length > 0) focusItem(target)
    }

    watch(
        options.active,
        async active => {
            if (active) {
                restoreTarget =
                    options.restoreFocus?.value ??
                    (document.activeElement instanceof HTMLElement ? document.activeElement : null)
                attach()
                await nextTick()
                if (!open) return
                focusItem(itemsIn(options.container.value)[0])
            } else {
                const wasTop = isTop()
                detach()
                if (wasTop) restore()
            }
        },
        { immediate: true, flush: 'post' }
    )

    onBeforeUnmount(() => {
        const wasTop = isTop()
        detach()
        if (wasTop) restore()
    })
}
