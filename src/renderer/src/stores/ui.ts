let toastTimer: ReturnType<typeof setTimeout> | null = null

export const useUiStore = defineStore(
    'ui',
    () => {
        const theme = ref<'dark' | 'light'>('dark')
        const sidebarWidth = ref(244)
        const rightPanelWidth = ref(410)
        const commitDetailsHeight = ref(210)
        const summaryHeight = ref(192)
        const searchQuery = ref('')
        const toast = ref<string | null>(null)

        function notify(message: string) {
            toast.value = message
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
            commitDetailsHeight,
            summaryHeight,
            searchQuery,
            toast,
            notify,
            toggleTheme,
        }
    },
    {
        persist: { pick: ['theme', 'sidebarWidth', 'rightPanelWidth', 'commitDetailsHeight', 'summaryHeight'] },
    }
)
