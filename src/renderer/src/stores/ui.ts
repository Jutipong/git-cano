export type Theme = 'dark' | 'light' | 'dark-modern'

export type AiCommitMode = 'off' | 'commit' | 'commit-push'

export type CommitColumn = 'author' | 'hash' | 'date'

export const COMMIT_COLUMN_DEFAULTS: Record<CommitColumn, boolean> = {
    author: true,
    hash: false,
    date: true,
}

export const DEFAULT_THEME: Theme = 'dark'

export type DiffViewMode = 'split' | 'inline'
export const DEFAULT_DIFF_VIEW_MODE: DiffViewMode = 'split'

export const DEFAULT_SHOW_ENTIRE_FILE = false

export type FileViewMode = 'tree' | 'flat'
export const DEFAULT_FILE_VIEW_MODE: FileViewMode = 'tree'

/** Auto-refresh interval in seconds; 0 disables auto-refresh. */
export const DEFAULT_REFRESH_INTERVAL = 60

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
        const theme = ref<Theme>(DEFAULT_THEME)
        watchEffect(() => {
            const savedTheme = theme.value as string
            if (savedTheme !== 'dark' && savedTheme !== 'light' && savedTheme !== 'dark-modern')
                theme.value = DEFAULT_THEME
        })
        const sidebarWidth = ref(244)
        const rightPanelWidth = ref(410)
        const summaryHeight = ref(140)
        const fileViewMode = ref<FileViewMode>(DEFAULT_FILE_VIEW_MODE)
        const fileFilterMode = ref<'changed' | 'all'>('changed')
        const diffViewMode = ref<DiffViewMode>(DEFAULT_DIFF_VIEW_MODE)
        if (diffViewMode.value === ('hunk' as DiffViewMode)) diffViewMode.value = DEFAULT_DIFF_VIEW_MODE
        const showEntireFile = ref(DEFAULT_SHOW_ENTIRE_FILE)
        const aiCommitMode = ref<AiCommitMode>('off')
        const refreshInterval = ref(DEFAULT_REFRESH_INTERVAL)
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

        function resetGeneral() {
            theme.value = DEFAULT_THEME
            fileViewMode.value = DEFAULT_FILE_VIEW_MODE
            diffViewMode.value = DEFAULT_DIFF_VIEW_MODE
            showEntireFile.value = DEFAULT_SHOW_ENTIRE_FILE
            refreshInterval.value = DEFAULT_REFRESH_INTERVAL
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
            aiCommitMode,
            refreshInterval,
            sidebarSections,
            commitColumns,
            commitDateFormat,
            toggleSection,
            resetCommitColumns,
            resetGeneral,
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
                'aiCommitMode',
                'refreshInterval',
                'sidebarSections',
                'commitColumns',
                'commitDateFormat',
            ],
        },
    }
)
