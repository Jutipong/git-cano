export type Theme = 'dark' | 'light' | 'dark-simple'

export interface ThemeOption {
    value: Theme
    label: string
    description: string
    icon: 'moon' | 'sun'
}

const themeOptions: ThemeOption[] = [
    { value: 'dark', label: 'Dark', description: 'Easy on the eyes in low light', icon: 'moon' },
    { value: 'light', label: 'Light', description: 'Bright and clear', icon: 'sun' },
    { value: 'dark-simple', label: 'Simple Dark', description: 'HondryTravis Simple Dark palette', icon: 'moon' },
]

export const useUiStore = defineStore(
    'ui',
    () => {
        const theme = ref<Theme>('dark')
        const sidebarWidth = ref(244)
        const rightPanelWidth = ref(410)
        const summaryHeight = ref(140)
        const fileViewMode = ref<'tree' | 'flat'>('tree')
        const autoCommit = ref(false)
        const sidebarSections = ref<Record<'local' | 'tags' | 'remote' | 'stashes', boolean>>({
            local: true,
            tags: true,
            remote: true,
            stashes: true,
        })
        function toggleSection(key: 'local' | 'tags' | 'remote' | 'stashes') {
            sidebarSections.value[key] = !sidebarSections.value[key]
        }

        function setTheme(value: Theme) {
            theme.value = value
        }

        watchEffect(() => {
            document.documentElement.dataset.theme = theme.value
        })
        document.documentElement.dataset.theme = theme.value

        return {
            theme,
            themeOptions,
            sidebarWidth,
            rightPanelWidth,
            summaryHeight,
            fileViewMode,
            autoCommit,
            sidebarSections,
            toggleSection,
            setTheme,
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
                'autoCommit',
                'sidebarSections',
            ],
        },
    }
)
