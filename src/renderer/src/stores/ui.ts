export type Theme = 'dark' | 'light' | 'dark-modern'

export type CommitColumn = 'author' | 'hash' | 'date'

export const COMMIT_COLUMN_DEFAULTS: Record<CommitColumn, boolean> = {
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
    { value: 'dark', label: 'Dark', description: 'Simple Dark palette', icon: 'moon' },
    { value: 'dark-modern', label: 'Dark Modern', description: 'VS Code Dark Modern palette', icon: 'moon' },
    { value: 'light', label: 'Light', description: 'Bright and clear', icon: 'sun' },
]

export const useUiStore = defineStore(
    'ui',
    () => {
        const theme = ref<Theme>('dark')
        watchEffect(() => {
            const savedTheme = theme.value as string
            if (savedTheme !== 'dark' && savedTheme !== 'light' && savedTheme !== 'dark-modern')
                theme.value = 'dark'
        })
        const sidebarWidth = ref(244)
        const rightPanelWidth = ref(410)
        const summaryHeight = ref(140)
        const fileViewMode = ref<'tree' | 'flat'>('tree')
        const fileFilterMode = ref<'changed' | 'all'>('changed')
        const diffViewMode = ref<'split' | 'inline'>('split')
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
        watchEffect(() => {
            for (const stale of ['graph', 'message'] as const) delete (commitColumns.value as Record<string, boolean>)[stale]
        })
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
            fileFilterMode,
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
                'fileFilterMode',
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
