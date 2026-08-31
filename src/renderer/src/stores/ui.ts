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

/** Auto-refresh interval options, in minutes. */
export const REFRESH_INTERVAL_OPTIONS = [3, 5, 10, 15, 20, 24, 30]
export const DEFAULT_REFRESH_INTERVAL = 5

/** Run the repo formatter (when it has .oxfmtrc.json) before AI commit-message generation. */
export const DEFAULT_FORMAT_BEFORE_GENERATE = false

/** App-wide UI font size options (applied via CSS zoom relative to the base size). */
export const FONT_SIZE_OPTIONS = [12, 13, 14, 15, 16]
export const DEFAULT_FONT_SIZE = 14

/** Overall UI zoom options, in percent. Composes with font size around the base scale. */
export const ZOOM_OPTIONS = [80, 90, 100, 110, 125, 150]
export const DEFAULT_ZOOM = 100

/** Code viewer font size (Blame / File History diff) — adjustable with Ctrl+wheel. */
export const CODE_FONT_SIZE_MIN = 9
export const CODE_FONT_SIZE_MAX = 20
export const DEFAULT_CODE_FONT_SIZE = 14
/** First shipped default — migrated to DEFAULT_CODE_FONT_SIZE on load. */
const LEGACY_CODE_FONT_SIZE = 11

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
            if (savedTheme !== 'dark' && savedTheme !== 'light' && savedTheme !== 'dark-modern') theme.value = DEFAULT_THEME
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
        const formatBeforeGenerate = ref(DEFAULT_FORMAT_BEFORE_GENERATE)
        const refreshInterval = ref(DEFAULT_REFRESH_INTERVAL)
        watchEffect(() => {
            if (!REFRESH_INTERVAL_OPTIONS.includes(refreshInterval.value)) refreshInterval.value = DEFAULT_REFRESH_INTERVAL
        })
        const fontSize = ref(DEFAULT_FONT_SIZE)
        watchEffect(() => {
            if (!FONT_SIZE_OPTIONS.includes(fontSize.value)) fontSize.value = DEFAULT_FONT_SIZE
        })
        const zoom = ref(DEFAULT_ZOOM)
        watchEffect(() => {
            if (!ZOOM_OPTIONS.includes(zoom.value)) zoom.value = DEFAULT_ZOOM
        })
        const codeFontSize = ref(DEFAULT_CODE_FONT_SIZE)
        // migrate the first shipped default so existing persisted stores pick up the new default
        if (codeFontSize.value === LEGACY_CODE_FONT_SIZE) codeFontSize.value = DEFAULT_CODE_FONT_SIZE
        watchEffect(() => {
            if (codeFontSize.value < CODE_FONT_SIZE_MIN || codeFontSize.value > CODE_FONT_SIZE_MAX) {
                codeFontSize.value = DEFAULT_CODE_FONT_SIZE
            }
        })

        /** Ctrl+wheel zoom for code viewers — delta from the wheel event (+1 / -1). */
        function zoomCodeFontSize(delta: number) {
            codeFontSize.value = Math.min(CODE_FONT_SIZE_MAX, Math.max(CODE_FONT_SIZE_MIN, codeFontSize.value + delta))
        }
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
            refreshInterval.value = DEFAULT_REFRESH_INTERVAL
            fontSize.value = DEFAULT_FONT_SIZE
            zoom.value = DEFAULT_ZOOM
        }

        watchEffect(() => {
            document.documentElement.dataset.theme = theme.value
        })
        document.documentElement.dataset.theme = theme.value
        watchEffect(() => {
            const scale = (zoom.value / DEFAULT_ZOOM) * (fontSize.value / DEFAULT_FONT_SIZE)
            document.documentElement.style.zoom = String(scale)
        })

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
            formatBeforeGenerate,
            refreshInterval,
            fontSize,
            zoom,
            codeFontSize,
            zoomCodeFontSize,
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
                'formatBeforeGenerate',
                'refreshInterval',
                'fontSize',
                'zoom',
                'codeFontSize',
                'sidebarSections',
                'commitColumns',
                'commitDateFormat',
            ],
        },
    }
)
