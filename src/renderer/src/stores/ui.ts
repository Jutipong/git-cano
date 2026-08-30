export type Theme = 'dark-simple' | 'light'

export type CommitColumn = 'graph' | 'message' | 'author' | 'hash' | 'date'

export const COMMIT_COLUMN_DEFAULTS: Record<CommitColumn, boolean> = {
    graph: true,
    message: true,
    author: true,
    hash: false,
    date: true,
}

export interface ThemeOption {
    value: Theme
    label: string
    description: string
    icon: 'moon' | 'sun'
}

const themeOptions: ThemeOption[] = [
    { value: 'dark-simple', label: 'Simple Dark', description: 'HondryTravis Simple Dark palette', icon: 'moon' },
    { value: 'light', label: 'Light', description: 'Bright and clear', icon: 'sun' },
]

export const useUiStore = defineStore(
    'ui',
    () => {
        const theme = ref<Theme>('dark-simple')
        // 'dark'/'dracula' themes were removed — normalize any persisted value.
        // Runs in a watchEffect because the persist plugin hydrates localStorage
        // after this setup function has already executed.
        watchEffect(() => {
            const savedTheme = theme.value as string
            if (savedTheme !== 'dark-simple' && savedTheme !== 'light') theme.value = 'dark-simple'
        })
        const sidebarWidth = ref(244)
        const rightPanelWidth = ref(410)
        const summaryHeight = ref(140)
        const fileViewMode = ref<'tree' | 'flat'>('tree')
        const diffViewMode = ref<'split' | 'inline'>('split')
        // 'hunk' mode was removed — migrate any persisted value
        if (diffViewMode.value === ('hunk' as 'inline')) diffViewMode.value = 'inline'
        const showEntireFile = ref(false)
        const autoCommit = ref(false)
        const sidebarSections = ref<Record<'local' | 'tags' | 'remote' | 'stashes', boolean>>({
            local: true,
            tags: true,
            remote: true,
            stashes: true,
        })
        const commitColumns = ref<Record<CommitColumn, boolean>>({ ...COMMIT_COLUMN_DEFAULTS })
        const commitDateFormat = ref('dd/MM/yyyy HH:mm')

        function toggleSection(key: 'local' | 'tags' | 'remote' | 'stashes') {
            sidebarSections.value[key] = !sidebarSections.value[key]
        }

        function resetCommitColumns() {
            commitColumns.value = { ...COMMIT_COLUMN_DEFAULTS }
            commitDateFormat.value = 'dd/MM/yyyy HH:mm'
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
            diffViewMode,
            showEntireFile,
            autoCommit,
            sidebarSections,
            commitColumns,
            commitDateFormat,
            toggleSection,
            resetCommitColumns,
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
                'diffViewMode',
                'showEntireFile',
                'autoCommit',
                'sidebarSections',
                'commitColumns',
                'commitDateFormat',
            ],
        },
    }
)
