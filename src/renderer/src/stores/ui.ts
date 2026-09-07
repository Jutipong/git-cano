export type Theme = 'dark' | 'light' | 'dark-modern' | 'dark-neon' | 'terminal'

export type AiCommitMode = 'off' | 'commit' | 'commit-push'

export const REPO_TAB_COLOR_OPTIONS = [
    { value: 'red', label: 'Red', hex: '#ff3b30' },
    { value: 'orange', label: 'Orange', hex: '#ff9f0a' },
    { value: 'yellow', label: 'Yellow', hex: '#ffd60a' },
    { value: 'green', label: 'Green', hex: '#32d74b' },
    { value: 'blue', label: 'Blue', hex: '#0a84ff' },
    { value: 'pink', label: 'Pink', hex: '#ff2d92' },
    { value: 'purple', label: 'Purple', hex: '#bf5af2' },
] as const

export type RepoTabColor = (typeof REPO_TAB_COLOR_OPTIONS)[number]['value']

export type CommitColumn = 'author' | 'hash' | 'date'

export const COMMIT_COLUMN_DEFAULTS: Record<CommitColumn, boolean> = {
    author: false,
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
export const ZOOM_OPTIONS = [70, 80, 90, 100, 110, 125, 140, 150]
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
    { value: 'dark', label: 'Dark', description: 'Deep navy with vivid blue accents', icon: 'moon' },
    { value: 'dark-modern', label: 'Dark Modern', description: 'Deep black with VS Code accents', icon: 'moon' },
    { value: 'dark-neon', label: 'Dark Neon', description: 'Pitch black with vivid neon accents', icon: 'moon' },
    { value: 'terminal', label: 'Terminal', description: 'Dusty navy TUI with blue accents', icon: 'moon' },
    { value: 'light', label: 'Light', description: 'Bright and clear', icon: 'sun' },
]

export const useUiStore = defineStore(
    'ui',
    () => {
        const theme = ref<Theme>(DEFAULT_THEME)
        watchEffect(() => {
            const savedTheme = theme.value as string
            if (
                savedTheme !== 'dark' &&
                savedTheme !== 'light' &&
                savedTheme !== 'dark-modern' &&
                savedTheme !== 'dark-neon' &&
                savedTheme !== 'terminal'
            )
                theme.value = DEFAULT_THEME
        })
        const sidebarWidth = ref(280)
        const rightPanelWidth = ref(360)
        const summaryHeight = ref(140)
        /** Height (%) of the OUTPUT pane in ConflictView. */
        const conflictOutputHeight = ref(38)
        const fileViewMode = ref<FileViewMode>(DEFAULT_FILE_VIEW_MODE)
        const fileFilterMode = ref<'changed' | 'all'>('changed')
        const diffViewMode = ref<DiffViewMode>(DEFAULT_DIFF_VIEW_MODE)
        if (diffViewMode.value === ('hunk' as DiffViewMode)) diffViewMode.value = DEFAULT_DIFF_VIEW_MODE
        const showEntireFile = ref(DEFAULT_SHOW_ENTIRE_FILE)
        const aiCommitMode = ref<AiCommitMode>('off')
        const formatBeforeGenerate = ref(DEFAULT_FORMAT_BEFORE_GENERATE)
        /**
         * One-shot AI run requested from the command palette ('off' | 'commit' | 'commit-push') — FilePanel consumes and clears it. Not
         * persisted.
         */
        const aiRunRequest = ref<AiCommitMode | null>(null)
        /** Push a newly created tag to origin (Create tag modal checkbox). */
        const tagPushToOrigin = ref(false)
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
        const repoTabColors = ref<Record<string, string>>({})
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

        /** Step through ZOOM_OPTIONS one slot (Ctrl+= / Ctrl+- / Ctrl+wheel). */
        function stepZoom(direction: number) {
            const idx = ZOOM_OPTIONS.indexOf(zoom.value)
            zoom.value = ZOOM_OPTIONS[Math.min(ZOOM_OPTIONS.length - 1, Math.max(0, idx + direction))]
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

        function setRepoTabColor(path: string, hex: string | null) {
            const next = { ...repoTabColors.value }
            if (hex) next[path] = hex
            else delete next[path]
            repoTabColors.value = next
        }

        function resetAppearance() {
            theme.value = DEFAULT_THEME
            fontSize.value = DEFAULT_FONT_SIZE
            zoom.value = DEFAULT_ZOOM
        }

        function resetGeneral() {
            refreshInterval.value = DEFAULT_REFRESH_INTERVAL
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
            conflictOutputHeight,
            fileViewMode,
            fileFilterMode,
            diffViewMode,
            showEntireFile,
            aiCommitMode,
            formatBeforeGenerate,
            aiRunRequest,
            tagPushToOrigin,
            refreshInterval,
            fontSize,
            zoom,
            stepZoom,
            codeFontSize,
            zoomCodeFontSize,
            repoTabColors,
            sidebarSections,
            commitColumns,
            commitDateFormat,
            toggleSection,
            resetCommitColumns,
            resetAppearance,
            resetGeneral,
            setTheme,
            setRepoTabColor,
        }
    },
    {
        persist: {
            pick: [
                'theme',
                'sidebarWidth',
                'rightPanelWidth',
                'summaryHeight',
                'conflictOutputHeight',
                'fileViewMode',
                'fileFilterMode',
                'diffViewMode',
                'showEntireFile',
                'aiCommitMode',
                'formatBeforeGenerate',
                'tagPushToOrigin',
                'refreshInterval',
                'fontSize',
                'zoom',
                'codeFontSize',
                'repoTabColors',
                'sidebarSections',
                'commitColumns',
                'commitDateFormat',
            ],
        },
    }
)
