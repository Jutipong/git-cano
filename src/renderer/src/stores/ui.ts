export type Theme = 'dark' | 'light' | 'dark-modern'

export type CommitColumn = 'author' | 'hash' | 'date'
// 'graph' and 'message' are not part of this state — they're the commit history
// itself, so they're always shown and can never be hidden.

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
    { value: 'dark', label: 'Dark', description: 'HondryTravis Simple Dark palette', icon: 'moon' },
    { value: 'dark-modern', label: 'Dark Modern', description: 'VS Code Dark Modern palette', icon: 'moon' },
    { value: 'light', label: 'Light', description: 'Bright and clear', icon: 'sun' },
]

export const useUiStore = defineStore(
    'ui',
    () => {
        const theme = ref<Theme>('dark')
        // 'dracula' was removed and legacy 'dark-simple' was renamed to 'dark' —
        // normalize any persisted value. Runs in a watchEffect because the persist
        // plugin hydrates localStorage after this setup function has already executed.
        watchEffect(() => {
            const savedTheme = theme.value as string
            if (savedTheme !== 'dark' && savedTheme !== 'light' && savedTheme !== 'dark-modern')
                theme.value = 'dark'
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
        // 'graph'/'message' are no longer stored — strip any leftover keys that an
        // older session may have persisted. Runs in a watchEffect because the persist
        // plugin hydrates localStorage after setup has already executed.
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
