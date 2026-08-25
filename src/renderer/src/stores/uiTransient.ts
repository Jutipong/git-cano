type ToastKind = 'success' | 'error' | 'warning' | 'info'

interface ToastMessage {
    message: string
    type: ToastKind
}

let toastTimer: ReturnType<typeof setTimeout> | null = null

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
    const toast = ref<ToastMessage | null>(null)

    function notify(message: string, type?: ToastKind) {
        toast.value = { message, type: type ?? inferToastKind(message) }
        if (toastTimer) clearTimeout(toastTimer)
        toastTimer = setTimeout(() => (toast.value = null), 4000)
    }

    return {
        searchQuery,
        toast,
        notify,
    }
})
