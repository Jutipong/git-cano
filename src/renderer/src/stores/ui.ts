export const useUiStore = defineStore(
    'ui',
    () => {
        const theme = ref<'dark' | 'light'>('dark')
        const sidebarWidth = ref(244)
        const rightPanelWidth = ref(410)
        const summaryHeight = ref(140)
        const fileViewMode = ref<'tree' | 'flat'>('tree')
        const sidebarSections = ref<Record<'local' | 'tags' | 'remote' | 'stashes', boolean>>({
            local: true,
            tags: true,
            remote: true,
            stashes: true,
        })
        function toggleSection(key: 'local' | 'tags' | 'remote' | 'stashes') {
            sidebarSections.value[key] = !sidebarSections.value[key]
        }

        function toggleTheme() {
            theme.value = theme.value === 'dark' ? 'light' : 'dark'
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
            fileViewMode,
            sidebarSections,
            toggleSection,
            toggleTheme,
        }
    },
    {
        persist: {
            pick: [
                'theme',
                'sidebarWidth',
                'rightPanelWidth',
                'summaryHeight',
                'fileViewMode',
                'sidebarSections',
            ],
        },
    }
)
