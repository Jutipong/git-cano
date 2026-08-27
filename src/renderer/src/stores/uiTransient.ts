// semantic kinds plus action accents so a toast can pick up the color of the button that triggered it
export type ToastKind = 'success' | 'error' | 'warning' | 'info' | 'fetch' | 'pull' | 'push' | 'stash'

interface ToastMessage {
    id: number
    message: string
    type: ToastKind
    // 1 → just shown, 0 → about to disappear; drives the countdown ring
    progress: number
    deadline: number
}

let toastTicker: ReturnType<typeof setInterval> | null = null
let nextToastId = 0

// how long a toast stays on screen, and how often the countdown ring updates
export const TOAST_DURATION = 6000
const TOAST_TICK_MS = 50

function inferToastKind(message: string): ToastKind {
    const value = message.toLowerCase()

    if (/error|failed|failure|fatal|cannot|invalid|unable|denied|rejected|not found|conflict|couldn.t|can.t/.test(value)) {
        return 'error'
    }
    if (/warning|discard|abort|aborted|enter .* first|nothing to|no .* found|clean/.test(value)) {
        return 'warning'
    }
    if (
        /success|completed|created|fetched|pulled|pushed|staged|unstaged|merged|resolved|checked out|copied|refreshed|continued|reverted|cherry-picked|reset|committed|theme/.test(
            value
        )
    ) {
        return 'success'
    }
    return 'info'
}

export const useUiTransientStore = defineStore('uiTransient', () => {
    const searchQuery = ref('')
    const toasts = ref<ToastMessage[]>([])
    const errorDialog = ref<string | null>(null)

    function stopToastTicker() {
        if (toastTicker) clearInterval(toastTicker)
        toastTicker = null
    }

    function ensureToastTicker() {
        if (toastTicker) return
        toastTicker = setInterval(() => {
            const now = Date.now()
            toasts.value = toasts.value.filter(t => {
                t.progress = Math.max(0, (t.deadline - now) / TOAST_DURATION)
                return t.progress > 0
            })
            if (!toasts.value.length) stopToastTicker()
        }, TOAST_TICK_MS)
    }

    function dismissToast(id: number) {
        toasts.value = toasts.value.filter(t => t.id !== id)
    }

    function notify(message: string, type?: ToastKind) {
        const kind = type ?? inferToastKind(message)
        if (kind === 'error') {
            // errors go to a dedicated dialog so the message can be read clearly
            errorDialog.value = message // last error wins
            return
        }
        toasts.value.push({
            id: ++nextToastId,
            message,
            type: kind,
            progress: 1,
            deadline: Date.now() + TOAST_DURATION,
        })
        ensureToastTicker()
    }

    function closeErrorDialog() {
        errorDialog.value = null
    }

    return {
        searchQuery,
        toasts,
        errorDialog,
        notify,
        dismissToast,
        closeErrorDialog,
    }
})
