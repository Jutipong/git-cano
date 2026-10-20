import { nextTick, onBeforeUnmount, watch } from 'vue'

interface ModalA11yOptions {
    /** Reactive "this modal is open" getter. */
    active: () => boolean
    /** The dialog box itself (not the backdrop). It needs `tabindex="-1"`. */
    container: { readonly value: HTMLElement | null }
    /** Element to focus on open; falls back to the first focusable inside the container. */
    initialFocus?: { readonly value: HTMLElement | null }
    /** Escape handler. Only the topmost modal receives it. */
    onClose?: () => void
}

const FOCUSABLE = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
].join(',')

/** Open modals, bottom → top. Only the last entry owns Tab/Escape. */
const stack: symbol[] = []

/**
 * Last focused element outside the current focus target. Dialogs opened by an async action lose
 * the trigger's focus when the action disables it, so `document.activeElement` is <body> by the
 * time the dialog mounts; this tracker keeps the button that started the action.
 */
let lastFocused: HTMLElement | null = null

if (typeof document !== 'undefined') {
    document.addEventListener(
        'focusin',
        event => {
            const target = event.target
            if (target instanceof HTMLElement && target !== document.body) lastFocused = target
        },
        true
    )
}

function focusableIn(container: HTMLElement | null): HTMLElement[] {
    if (!container) return []
    return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        element => element.getClientRects().length > 0 && element.getAttribute('aria-hidden') !== 'true'
    )
}

function focusElement(element: HTMLElement | null | undefined): void {
    element?.focus({ preventScroll: true })
}

/**
 * Keyboard/screen-reader plumbing shared by every dialog: save + restore focus, trap Tab,
 * close the topmost modal on Escape, and let stacked modals (palette over settings, confirm
 * over a create form) hand focus back to the dialog underneath.
 */
export function useModalA11y(options: ModalA11yOptions): void {
    const id = Symbol('modal')
    let open = false
    let restoreFocus: HTMLElement | null = null

    function isTop(): boolean {
        return stack[stack.length - 1] === id
    }

    function onKeydown(event: KeyboardEvent): void {
        if (!open || !isTop()) return
        if (event.key === 'Escape') {
            if (!options.onClose) return
            event.preventDefault()
            event.stopPropagation()
            options.onClose()
            return
        }
        if (event.key !== 'Tab') return

        const container = options.container.value
        if (!container) return
        const focusables = focusableIn(container)
        if (!focusables.length) {
            event.preventDefault()
            focusElement(container)
            return
        }

        const active = document.activeElement instanceof HTMLElement ? document.activeElement : null
        const index = active ? focusables.indexOf(active) : -1
        if (index === -1) {
            event.preventDefault()
            focusElement(event.shiftKey ? focusables[focusables.length - 1] : focusables[0])
            return
        }
        if (event.shiftKey && index === 0) {
            event.preventDefault()
            focusElement(focusables[focusables.length - 1])
        } else if (!event.shiftKey && index === focusables.length - 1) {
            event.preventDefault()
            focusElement(focusables[0])
        }
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
        const target = restoreFocus
        restoreFocus = null
        if (target?.isConnected && target.getClientRects().length > 0) focusElement(target)
    }

    watch(
        options.active,
        async active => {
            if (active) {
                const current = document.activeElement
                restoreFocus = current instanceof HTMLElement && current !== document.body ? current : lastFocused
                attach()
                await nextTick()
                if (!open) return
                const target =
                    options.initialFocus?.value ?? focusableIn(options.container.value)[0] ?? options.container.value
                focusElement(target)
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
