let toastTimer: ReturnType<typeof setTimeout> | null = null

type ToastKind = 'success' | 'error' | 'warning' | 'info'

interface ToastMessage {
    message: string
    type: ToastKind
}

function inferToastKind(message: string): ToastKind {
    const value = message.toLowerCase()

    if (/error|failed|failure|fatal|cannot|invalid|unable|denied|rejected|not found|conflict|couldn.t|can.t/.test(value)) {
        return 'error'
    }
    if (/warning|discard|abort|aborted|enter .* first|nothing to|no .* found|clean/.test(value)) {
        return 'warning'
    }
    if (/success|completed|created|fetched|pulled|pushed|staged|unstaged|merged|resolved|checked out|copied|refreshed|continued|reverted|cherry-picked|reset|committed|theme/.test(value)) {
        return 'success'
    }
    return 'info'
}

export const useUiStore = defineStore(
    'ui',
    () => {
        const theme = ref<'dark' | 'light'>('dark')
        const sidebarWidth = ref(244)
        const rightPanelWidth = ref(410)
        const summaryHeight = ref(180)
        const searchQuery = ref('')
        const toast = ref<ToastMessage | null>(null)

        function notify(message: string, type?: ToastKind) {
            toast.value = { message, type: type ?? inferToastKind(message) }
            if (toastTimer) clearTimeout(toastTimer)
            toastTimer = setTimeout(() => (toast.value = null), 4000)
        }

        function toggleTheme() {
            theme.value = theme.value === 'dark' ? 'light' : 'dark'
            notify(`${theme.value === 'dark' ? 'Dark' : 'Light'} theme`)
        }

        watchEffect(() => {
            document.documentElement.dataset.theme = theme.value
        })
        document.documentElement.dataset.theme = theme.value

        return {
            theme,
            sidebarWidth,
            rightPanelWidth,
            summaryHeight,
            searchQuery,
            toast,
            notify,
            toggleTheme,
        }
    },
    {
        persist: { pick: ['theme', 'sidebarWidth', 'rightPanelWidth', 'summaryHeight'] },
    }
)
