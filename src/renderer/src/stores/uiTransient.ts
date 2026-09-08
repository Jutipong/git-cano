export type ToastKind = 'success' | 'error' | 'warning' | 'info' | 'fetch' | 'pull' | 'push' | 'stash'

export interface ToastAction {
    label: string
    act: () => void
}

export interface NotifyOptions {
    asToast?: boolean
    /** Per-toast lifetime in ms (default TOAST_DURATION) — drives both expiry and the progress ring. */
    durationMs?: number
    /** Optional action button (e.g. Undo) rendered inside the toast. */
    action?: ToastAction
}

interface ToastMessage {
    id: number
    message: string
    type: ToastKind
    progress: number
    deadline: number
    durationMs: number
    action: ToastAction | null
}

let toastTicker: ReturnType<typeof setInterval> | null = null
let nextToastId = 0

export const TOAST_DURATION = 10000
/** Undo toasts linger longer so the action stays reachable. */
export const UNDO_TOAST_DURATION = 15000
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
    const busy = ref<string | null>(null)
    const stashListTick = ref(0)
    let busyCount = 0

    function bumpStashList() {
        stashListTick.value++
    }

    function stopToastTicker() {
        if (toastTicker) clearInterval(toastTicker)
        toastTicker = null
    }

    function ensureToastTicker() {
        if (toastTicker) return
        toastTicker = setInterval(() => {
            const now = Date.now()
            toasts.value = toasts.value.filter(t => {
                t.progress = Math.max(0, (t.deadline - now) / t.durationMs)
                return t.progress > 0
            })
            if (!toasts.value.length) stopToastTicker()
        }, TOAST_TICK_MS)
    }

    function dismissToast(id: number) {
        toasts.value = toasts.value.filter(t => t.id !== id)
    }

    function runToastAction(id: number) {
        const found = toasts.value.find(t => t.id === id)
        if (!found?.action) return
        dismissToast(id)
        found.action.act()
    }

    function notify(message: string, type?: ToastKind, opts?: NotifyOptions) {
        const kind = type ?? inferToastKind(message)
        if (kind === 'error' && !opts?.asToast) {
            errorDialog.value = message
            return
        }
        const durationMs = opts?.durationMs ?? TOAST_DURATION
        toasts.value.push({
            id: ++nextToastId,
            message,
            type: kind,
            progress: 1,
            deadline: Date.now() + durationMs,
            durationMs,
            action: opts?.action ?? null,
        })
        ensureToastTicker()
    }

    function closeErrorDialog() {
        errorDialog.value = null
    }

    async function withBusy<T>(fn: () => Promise<T>, label = 'Working…'): Promise<T> {
        busy.value = label
        busyCount++
        try {
            return await fn()
        } finally {
            if (--busyCount === 0) busy.value = null
        }
    }

    return {
        searchQuery,
        toasts,
        errorDialog,
        busy,
        stashListTick,
        bumpStashList,
        notify,
        dismissToast,
        runToastAction,
        closeErrorDialog,
        withBusy,
    }
})
