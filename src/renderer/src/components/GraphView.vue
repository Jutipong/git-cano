<script setup lang="ts">
    import { nextTick, watch, computed, onBeforeUnmount, onMounted, ref } from 'vue'
    import ILucideArrowUp from '~icons/lucide/arrow-up'
    import ILucideChevronDown from '~icons/lucide/chevron-down'
    import ILucideChevronRight from '~icons/lucide/chevron-right'
    import ILucideCombine from '~icons/lucide/combine'
    import ILucideCrosshair from '~icons/lucide/crosshair'
    import ILucideGitBranch from '~icons/lucide/git-branch'
    import ILucideGlobe2 from '~icons/lucide/globe2'
    import ILucideSearch from '~icons/lucide/search'
    import ILucideSettings from '~icons/lucide/settings'
    import ILucideTag from '~icons/lucide/tag'

    import { useAuthStore } from '../stores/auth'
    import { useRepoStore } from '../stores/repo'
    import { useUiStore } from '../stores/ui'
    import { useUiTransientStore } from '../stores/uiTransient'
    import { formatDatePattern, formatShortDate } from '../utils/format'
    import { buildPrefix, indexAtOffset } from '../utils/virtual'
    import CloseXIcon from './CloseXIcon.vue'
    import CommitContextMenu, { type CommitMenuState } from './CommitContextMenu.vue'
    import GraphSettingsModal from './GraphSettingsModal.vue'
    import ThinkSpinner from './ThinkSpinner.vue'

    import type { CommitNode } from '@shared/types'

    interface Props {
        commits: CommitNode[]
        hasMore: boolean
        commitOpen: boolean
        /** True while a diff overlay (DiffView / ConflictView / FileHistory / Blame) covers the graph. */
        hideToTop?: boolean
    }

    const props = defineProps<Props>()
    const auth = useAuthStore()
    const emit = defineEmits<{
        (e: 'select-commit', commit: CommitNode): void
        (e: 'load-more'): void
        (e: 'checkout', commit: CommitNode): void
        (e: 'create-branch', commit: CommitNode): void
        (e: 'create-tag', commit: CommitNode): void
        (e: 'cherry-pick', commit: CommitNode): void
        (e: 'squash', commit: CommitNode): void
        (e: 'revert', commit: CommitNode): void
        (e: 'reset-soft', commit: CommitNode): void
        (e: 'reset-hard', commit: CommitNode): void
    }>()

    const FIRST_LANE_COLOR = '#F05272'
    /* Shared hue families: lanes/chips are calmer, avatars are the vivid accent. */
    const COLORS = ['#5CDA72', '#E276E6', '#F08A46', '#45B0E6', '#EE6871', '#9B82E0', '#31D0B3', '#D36DDD']
    /** Slightly toned palette for the terminal theme. */
    const TERMINAL_FIRST_LANE_COLOR = '#F06C82'
    const TERMINAL_COLORS = ['#69D987', '#C58AE0', '#ED9A64', '#68C4E9', '#88A9E6', '#9E91E3', '#55D6B9', '#DF91C3']
    /** Deep dusty palette for the light-retro theme — dim paper needs darker tones to tell lanes apart. 8 entries, mutually distinct. */
    const LIGHT_RETRO_FIRST_LANE_COLOR = '#1A1A1A'
    const LIGHT_RETRO_COLORS = ['#2E5B33', '#8E2F22', '#2F5875', '#6E4A15', '#54455F', '#4A4A4A', '#1F6B5E', '#713C4D']
    /* Vivid avatar colors: deliberately spaced apart and without yellow. */
    const AVATAR_COLORS = ['#FF4D6D', '#FF8A3D', '#58E06B', '#22D3A7', '#29A8FF', '#6B7CFF', '#A855F7', '#E879F9']
    /** Dusty avatars to match the light-retro lane palette. */
    const LIGHT_RETRO_AVATAR_COLORS = ['#2E5B33', '#8E2F22', '#2F5875', '#6E4A15', '#54455F', '#333333', '#1F6B5E', '#713C4D']
    const laneW = 32
    const rowH = 30
    const rowHChip = 48
    const TWO_LINE_CHIP_COUNT = 5
    /* breathing room between the graph panel's left edge and the first lane */
    const GRAPH_PAD = 4

    const uiTransient = useUiTransientStore()
    const repoStore = useRepoStore()
    const ui = useUiStore()
    const selectedHash = ref<string | null>(null)
    const showSettings = ref(false)
    const menu = ref<CommitMenuState | null>(null)
    const visibleRange = ref<[number, number]>([0, 60])
    const scrollEl = ref<HTMLElement | null>(null)
    const sbw = ref(0)
    function updateSbw() {
        const el = scrollEl.value
        sbw.value = el ? Math.max(0, el.offsetWidth - el.clientWidth) : 0
    }
    const expandedHash = ref<string | null>(null)

    const expandedAbove = ref(false)
    const expandedMaxH = ref(240)

    function toggleMessage(hash: string, event: MouseEvent) {
        if (expandedHash.value === hash) {
            expandedHash.value = null
            return
        }
        // open toward whichever side has more room so the popover never falls off the graph
        const container = scrollEl.value
        const row = (event.currentTarget as HTMLElement | null)?.closest('.graph-row')
        if (container && row) {
            const rect = container.getBoundingClientRect()
            const rowRect = row.getBoundingClientRect()
            const spaceBelow = rect.bottom - rowRect.bottom
            const spaceAbove = rowRect.top - rect.top
            expandedAbove.value = spaceBelow < spaceAbove
            expandedMaxH.value = Math.round(Math.max(96, Math.min(240, Math.max(spaceBelow, spaceAbove) - 44)))
        }
        expandedHash.value = hash
    }

    function onKeydown(event: KeyboardEvent) {
        if (event.key === 'Escape') {
            expandedHash.value = null
            clearSquashPicks()
        }
    }
    onMounted(() => window.addEventListener('keydown', onKeydown))
    // window resize alone misses in-app layout changes (zoom, panel drags),
    // so observe the scroll container itself with a resize fallback
    let sbwObserver: ResizeObserver | null = null
    onMounted(() => {
        updateSbw()
        if (typeof ResizeObserver !== 'undefined' && scrollEl.value) {
            sbwObserver = new ResizeObserver(updateSbw)
            sbwObserver.observe(scrollEl.value)
        } else {
            window.addEventListener('resize', updateSbw)
        }
    })
    onBeforeUnmount(() => {
        sbwObserver?.disconnect()
        window.removeEventListener('resize', updateSbw)
    })
    onBeforeUnmount(() => {
        window.removeEventListener('keydown', onKeydown)
        if (scrollAnimation) cancelAnimationFrame(scrollAnimation)
    })
    onBeforeUnmount(() => window.clearTimeout(tipTimer))

    const normalizedQuery = computed(() => uiTransient.searchQuery.trim().toLowerCase())
    const visibleCommits = computed(() =>
        normalizedQuery.value
            ? props.commits.filter(commit =>
                  `${commit.subject} ${commit.author} ${commit.hash} ${commit.refs.join(' ')}`.toLowerCase().includes(normalizedQuery.value)
              )
            : props.commits
    )
    const GRAPH_MIN_W = 80
    const graphW = computed(
        () => Math.max((visibleCommits.value.reduce((max, c) => Math.max(max, c.lane), 0) + 1) * laneW + 4, GRAPH_MIN_W) + GRAPH_PAD
    )
    const rowIndex = computed(() => new Map(visibleCommits.value.map((commit, index) => [commit.hash as string, index])))
    function isTwoLine(commit: CommitNode): boolean {
        return commit.refs.length > TWO_LINE_CHIP_COUNT
    }
    function rowHeightFor(commit: CommitNode): number {
        return isTwoLine(commit) ? rowHChip : rowH
    }
    const rowHeights = computed(() => visibleCommits.value.map(rowHeightFor))
    const rowPrefix = computed(() => buildPrefix(rowHeights.value))
    const totalHeight = computed(() => rowPrefix.value[rowPrefix.value.length - 1] ?? 0)
    watch(totalHeight, () => nextTick(updateSbw))
    const padTop = computed(() => rowPrefix.value[visibleRange.value[0]] ?? 0)
    const padBottom = computed(() => totalHeight.value - (rowPrefix.value[visibleRange.value[1]] ?? totalHeight.value))
    function rowTop(index: number): number {
        return rowPrefix.value[index] ?? 0
    }
    function rowHeightAt(index: number): number {
        return rowHeights.value[index] ?? rowH
    }
    const renderedCommits = computed(() => visibleCommits.value.slice(visibleRange.value[0], visibleRange.value[1]))
    /** Only the commits inside the visible window (+ overscan) get SVG nodes — tint/tick/edges. */
    const graphWindow = computed(() => {
        const [start, end] = visibleRange.value
        const from = Math.max(0, start - 5)
        const to = Math.min(visibleCommits.value.length, end + 5)
        return visibleCommits.value.slice(from, to).map((commit, offset) => ({ commit, index: from + offset }))
    })
    /**
     * Edges whose row span intersects the visible window (+ overscan). Judged by span, not by both endpoints being on screen, so long lane
     * lines stay drawn while both ends are scrolled off.
     */
    const EDGE_OVERSCAN = 5
    const renderEdges = computed(() => {
        const [start, end] = visibleRange.value
        const lo = start - EDGE_OVERSCAN
        const hi = end + EDGE_OVERSCAN
        const edges: { commit: CommitNode; parent: string; childIndex: number; parentIndex: number }[] = []
        const rows = visibleCommits.value
        for (let childIndex = 0; childIndex < rows.length; childIndex++) {
            const commit = rows[childIndex]!
            for (const parent of commit.parents) {
                const parentIndex = rowIndex.value.get(parent)
                if (parentIndex === undefined || parentIndex <= childIndex) continue
                if (childIndex > hi || parentIndex < lo) continue
                edges.push({ commit, parent, childIndex, parentIndex })
            }
        }
        return edges
    })

    let loadMoreArmed = true
    const showToTop = ref(false)
    function onScroll() {
        hideTip()
        const el = scrollEl.value
        if (!el) return
        showToTop.value = el.scrollTop > rowH * 20
        const prefix = rowPrefix.value
        const n = visibleCommits.value.length
        if (!prefix.length || n === 0) {
            visibleRange.value = [0, 0]
        } else {
            const atTop = indexAtOffset(prefix, el.scrollTop)
            const atBottom = indexAtOffset(prefix, el.scrollTop + el.clientHeight)
            visibleRange.value = [Math.max(0, atTop - 15), Math.min(n, atBottom + 1 + 15)]
        }
        const nearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - rowH * 10
        if (props.hasMore && nearBottom && loadMoreArmed) {
            loadMoreArmed = false
            emit('load-more')
        } else if (!nearBottom) {
            loadMoreArmed = true
        }
    }

    /** Same easing as DiffView's animateBodyScrollTo so both to-top buttons feel identical. */
    let scrollAnimation: number | null = null
    function animateScrollTo(target: number) {
        const el = scrollEl.value
        if (!el) return
        const from = el.scrollTop
        const distance = target - from
        if (Math.abs(distance) < 4) return
        if (scrollAnimation) cancelAnimationFrame(scrollAnimation)
        if (Math.abs(distance) < 120) {
            el.scrollTo({ top: target })
            return
        }
        const duration = 160
        const start = performance.now()
        const step = (now: number) => {
            const t = Math.min((now - start) / duration, 1)
            const eased = 1 - Math.pow(1 - t, 3)
            el.scrollTo({ top: from + distance * eased })
            scrollAnimation = t < 1 ? requestAnimationFrame(step) : null
        }
        scrollAnimation = requestAnimationFrame(step)
    }

    function scrollToTop() {
        animateScrollTo(0)
    }

    function openMenu(commit: CommitNode, event: MouseEvent) {
        select(commit)
        const clickedIdx = fullRowIndex.value.get(commit.hash) ?? -1
        if (squashOldestIdx.value >= 0 && clickedIdx >= 0 && clickedIdx <= squashOldestIdx.value) {
            const oldest = props.commits[squashOldestIdx.value]!
            menu.value = { x: event.clientX, y: event.clientY, commit: oldest, squashCount: squashOldestIdx.value + 1 }
        } else {
            clearSquashPicks()
            menu.value = { x: event.clientX, y: event.clientY, commit, squashCount: clickedIdx + 1 }
        }
    }

    /** Multi-select for squash: Shift+click extends a range from the last pick (or the */
    /** Open commit). The scope is always HEAD..oldest pick with gaps auto-filled, so */
    /** Skipping commits is structurally impossible. */
    const squashPicks = ref<string[]>([])
    const fullRowIndex = computed(() => new Map(props.commits.map((commit, index) => [commit.hash as string, index])))
    const squashOldestIdx = computed(() => {
        let max = -1
        for (const hash of squashPicks.value) {
            const index = fullRowIndex.value.get(hash)
            if (index !== undefined && index > max) max = index
        }
        return max
    })
    const squashCount = computed(() => (squashOldestIdx.value >= 0 ? squashOldestIdx.value + 1 : 0))

    function inSquashScope(commit: CommitNode): boolean {
        if (squashOldestIdx.value < 0) return false
        const index = fullRowIndex.value.get(commit.hash)
        return index !== undefined && index <= squashOldestIdx.value
    }

    function rangeSquashPick(commit: CommitNode) {
        if (uiTransient.busy) return
        const anchorHash = squashPicks.value.at(-1) ?? selectedHash.value
        const anchorIdx = anchorHash ? (fullRowIndex.value.get(anchorHash) ?? -1) : -1
        const targetIdx = fullRowIndex.value.get(commit.hash) ?? -1
        if (anchorIdx < 0 || targetIdx < 0) {
            if (!squashPicks.value.includes(commit.hash)) squashPicks.value = [...squashPicks.value, commit.hash]
            return
        }
        const span = new Set(squashPicks.value)
        const [lo, hi] = anchorIdx < targetIdx ? [anchorIdx, targetIdx] : [targetIdx, anchorIdx]
        for (let index = lo; index <= hi; index++) span.add(props.commits[index]!.hash)
        squashPicks.value = [...span]
    }

    function clearSquashPicks() {
        squashPicks.value = []
    }

    function onRowClick(commit: CommitNode, event: MouseEvent) {
        if (event.shiftKey) {
            rangeSquashPick(commit)
            return
        }
        clearSquashPicks()
        select(commit)
    }

    function onMenuSquash(commit: CommitNode) {
        clearSquashPicks()
        emit('squash', commit)
    }

    watch(
        () => props.commits,
        () => {
            if (!squashPicks.value.length) return
            const alive = new Set(props.commits.map(commit => commit.hash))
            const kept = squashPicks.value.filter(hash => alive.has(hash))
            if (kept.length !== squashPicks.value.length) squashPicks.value = kept
        }
    )

    function select(commit: CommitNode) {
        selectedHash.value = commit.hash
        if (expandedHash.value && expandedHash.value !== commit.hash) expandedHash.value = null
        emit('select-commit', commit)
    }

    /** Graph rows are drag sources only (sidebar branches are the drop targets) — no drop handling here. */
    function startCommitDrag(commit: CommitNode, event: DragEvent) {
        if (uiTransient.busy) {
            event.preventDefault()
            return
        }
        if (event.dataTransfer) {
            event.dataTransfer.effectAllowed = 'copy'
            event.dataTransfer.setData('text/plain', `commit:${commit.hash}`)
        }
    }

    function lanePalette(): string[] {
        if (ui.theme === 'terminal') return TERMINAL_COLORS
        if (ui.theme === 'light-retro') return LIGHT_RETRO_COLORS
        return COLORS
    }

    function avatarPalette(): string[] {
        return ui.theme === 'light-retro' ? LIGHT_RETRO_AVATAR_COLORS : AVATAR_COLORS
    }

    function nodeColor(commit: CommitNode) {
        if (commit.lane === 0) {
            if (ui.theme === 'terminal') return TERMINAL_FIRST_LANE_COLOR
            if (ui.theme === 'light-retro') return LIGHT_RETRO_FIRST_LANE_COLOR
            return FIRST_LANE_COLOR
        }
        const palette = lanePalette()
        return palette[(commit.lane - 1) % palette.length]
    }
    function isMergeEdge(commit: CommitNode, parent: string) {
        return commit.parents.indexOf(parent) > 0
    }
    function nodeX(commit: CommitNode) {
        return GRAPH_PAD + commit.lane * laneW + laneW / 2
    }
    function nodeY(index: number) {
        return rowTop(index) + rowHeightAt(index) / 2
    }
    function edgeD(childIndex: number, parentIndex: number): string {
        const cx = nodeX(visibleCommits.value[childIndex])
        const cy = nodeY(childIndex)
        const px = nodeX(visibleCommits.value[parentIndex])
        const py = nodeY(parentIndex)
        const gap = py - cy
        const ease = Math.min(gap * 0.5, rowH * 2.5)
        return `M ${cx} ${cy} C ${cx} ${cy + ease}, ${px} ${py - ease}, ${px} ${py}`
    }
    function rejoinEdgeD(childIndex: number, parentIndex: number): string {
        const cx = nodeX(visibleCommits.value[childIndex])
        const cy = nodeY(childIndex)
        const px = nodeX(visibleCommits.value[parentIndex])
        const py = nodeY(parentIndex)
        const r = Math.min((py - cy) * 0.5, Math.abs(px - cx), rowH * 2.5)
        return `M ${cx} ${cy} L ${cx} ${py - r} Q ${cx} ${py} ${px} ${py}`
    }
    function shortReturnEdgeD(childIndex: number, parentIndex: number): string {
        const cx = nodeX(visibleCommits.value[childIndex])
        const cy = nodeY(childIndex)
        const px = nodeX(visibleCommits.value[parentIndex])
        const py = nodeY(parentIndex)
        const r = Math.min(10, Math.abs(px - cx) / 2, (py - cy) / 2)
        const dir = cx > px ? 1 : -1
        return `M ${cx} ${cy} L ${cx} ${py - r} Q ${cx} ${py} ${cx - dir * r} ${py} L ${px} ${py}`
    }
    function mergeEdgeD(childIndex: number, parentIndex: number): string {
        const cx = nodeX(visibleCommits.value[childIndex])
        const cy = nodeY(childIndex)
        const px = nodeX(visibleCommits.value[parentIndex])
        const py = nodeY(parentIndex)
        if (px === cx) return `M ${cx} ${cy} L ${px} ${py}`
        const r = Math.min(10, Math.abs(px - cx) / 2, (py - cy) / 2)
        const dir = px > cx ? 1 : -1
        return `M ${cx} ${cy} L ${px - dir * r} ${cy} Q ${px} ${cy} ${px} ${cy + r} L ${px} ${py}`
    }
    function edgePath(commit: CommitNode, parent: string, childIndex: number, parentIndex: number): string {
        if (isMergeEdge(commit, parent)) return mergeEdgeD(childIndex, parentIndex)
        const gap = nodeY(parentIndex) - nodeY(childIndex)
        const childX = nodeX(visibleCommits.value[childIndex])
        const parentX = nodeX(visibleCommits.value[parentIndex])
        if (parentX < childX) return shortReturnEdgeD(childIndex, parentIndex)
        return gap > rowH * 5 ? rejoinEdgeD(childIndex, parentIndex) : edgeD(childIndex, parentIndex)
    }
    function edgeColor(commit: CommitNode, parent: string): string {
        const parentIndex = rowIndex.value.get(parent)
        const parentCommit = parentIndex === undefined ? undefined : visibleCommits.value[parentIndex]
        return isMergeEdge(commit, parent) && parentCommit ? nodeColor(parentCommit) : nodeColor(commit)
    }
    function formatDate(iso: string): string {
        return formatShortDate(iso)
    }
    const commitDatePattern = computed(() => ui.commitDateFormat.trim() || 'dd/MM/yyyy HH:mm')

    const AUTHOR_MIN_W = 88
    const AUTHOR_MAX_W = 220
    const DATE_MIN_W = 76
    const HASH_MIN_W = 48
    const cssFont = (name: string, fallback: string): string =>
        getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
    const UI_FONT = cssFont('--font-ui', '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif')
    const MONO_FONT = cssFont('--font-mono', '"SF Mono", Menlo, monospace')
    const measureCtx = document.createElement('canvas').getContext('2d')
    const measureCache = new Map<string, number>()
    function measureText(text: string, size: number, font = UI_FONT): number {
        const key = `${size}px ${font}|${text}`
        const cached = measureCache.get(key)
        if (cached !== undefined) return cached
        let width: number
        if (!measureCtx) width = Math.ceil(text.length * size * 0.62)
        else {
            measureCtx.font = `${size}px ${font}`
            width = Math.ceil(measureCtx.measureText(text).width)
        }
        measureCache.set(key, width)
        return width
    }
    const authorW = computed(() => {
        let widest = 0
        for (const author of new Set(visibleCommits.value.map(commit => commit.author))) {
            widest = Math.max(widest, measureText(author, 13))
        }
        return Math.round(Math.min(AUTHOR_MAX_W, Math.max(AUTHOR_MIN_W, widest + 8)))
    })
    const dateW = computed(() => {
        let widest = 0
        for (const date of new Set(visibleCommits.value.map(commit => formatDatePattern(commit.date, commitDatePattern.value)))) {
            widest = Math.max(widest, measureText(date, 11))
        }
        return Math.round(Math.min(130, Math.max(DATE_MIN_W, widest + 8)))
    })
    const hashW = computed(() => {
        const sample = visibleCommits.value[0]?.shortHash ?? 'abcdef12345'
        return Math.round(Math.max(HASH_MIN_W, measureText(sample, 11, MONO_FONT) + 10))
    })
    function contrastText(hex: string): string {
        if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return '#f5f7fa'
        const r = parseInt(hex.slice(1, 3), 16)
        const g = parseInt(hex.slice(3, 5), 16)
        const b = parseInt(hex.slice(5, 7), 16)
        const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
        return luminance > 150 ? '#122d2c' : '#f5f7fa'
    }

    type RefKind = 'head' | 'local' | 'remote' | 'tag'
    const REF_GROUP: Record<RefKind, number> = { head: 2, tag: 0, local: 2, remote: 2 }

    function refKind(ref: string): RefKind {
        if (ref.startsWith('tag:')) return 'tag'
        if (ref.startsWith('HEAD -> ')) return 'head'
        if (ref.startsWith('remote:')) return 'remote'
        return 'local'
    }
    function refLabel(ref: string): string {
        if (ref.startsWith('tag:')) return ref.slice(4).trim()
        if (ref.startsWith('HEAD -> ')) return ref.slice('HEAD -> '.length)
        if (ref.startsWith('remote:')) return ref.slice('remote:'.length)
        return ref
    }
    function refBase(ref: string): string {
        const name = refLabel(ref)
        if (refKind(ref) !== 'remote') return name
        const slash = name.indexOf('/')
        return slash > 0 ? name.slice(slash + 1) : name
    }
    function sortedRefs(commit: CommitNode): string[] {
        return [...commit.refs].sort((a, b) => {
            const ka = refKind(a)
            const kb = refKind(b)
            const ga = REF_GROUP[ka]
            const gb = REF_GROUP[kb]
            if (ga !== gb) return ga - gb
            if (ka === 'tag') return refLabel(a).localeCompare(refLabel(b))
            const base = refBase(a).localeCompare(refBase(b))
            if (base !== 0) return base
            if (ka !== kb) {
                if (ka === 'remote' || kb === 'remote') return ka === 'remote' ? -1 : 1
                return ka === 'head' ? -1 : 1
            }
            return refLabel(a).localeCompare(refLabel(b))
        })
    }
    function chipColor(ref: string): string {
        const kind = refKind(ref)
        if (kind === 'tag') return 'var(--orange)'
        const name = refLabel(ref)
        return nameColor(kind === 'remote' ? name.slice(name.lastIndexOf('/') + 1) : name)
    }

    function hashString(s: string): number {
        let h = 0
        for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
        return h
    }
    function nameColor(name: string): string {
        const palette = lanePalette()
        return palette[hashString(name) % palette.length]
    }
    const avatarAssignments = new Map<string, number>()
    watch(
        () => repoStore.repo?.path,
        () => avatarAssignments.clear()
    )

    function circularDistance(a: number, b: number): number {
        const distance = Math.abs(a - b)
        return Math.min(distance, AVATAR_COLORS.length - distance)
    }

    /* Give visible authors different palette slots instead of letting hashes pick similar hues. */
    function avatarColor(name: string): string {
        const existing = avatarAssignments.get(name)
        if (existing !== undefined) return AVATAR_COLORS[existing]

        const preferred = hashString(name) % AVATAR_COLORS.length
        const used = [...avatarAssignments.values()]
        let selected = preferred
        if (used.length > 0 && used.length < AVATAR_COLORS.length) {
            selected = AVATAR_COLORS.map((_, index) => index)
                .filter(index => !used.includes(index))
                .sort((a, b) => {
                    const separationA = Math.min(...used.map(index => circularDistance(a, index)))
                    const separationB = Math.min(...used.map(index => circularDistance(b, index)))
                    if (separationA !== separationB) return separationB - separationA
                    return circularDistance(a, preferred) - circularDistance(b, preferred)
                })[0]
        }
        avatarAssignments.set(name, selected)
        return AVATAR_COLORS[selected]
    }

    /* row tick: lane color, slightly darkened */
    function tickColor(commit: CommitNode): string {
        return `color-mix(in srgb, ${nodeColor(commit)} 80%, black)`
    }

    function hasAvatar(commit: CommitNode): boolean {
        return auth.isGithubUser(commit.author, commit.authorEmail) && !!auth.githubUser?.avatarUrl
    }

    function avatarKey(commit: CommitNode): string {
        return commit.author || commit.authorEmail || ''
    }

    function avatarInitial(commit: CommitNode): string {
        return avatarKey(commit).trim().slice(0, 1).toUpperCase()
    }

    function avatarStyle(commit: CommitNode) {
        const color = avatarColor(avatarKey(commit))
        return {
            left: `${nodeX(commit)}px`,
            '--avatar-color': color,
            '--avatar-fg': contrastText(color),
            '--node-color': nodeColor(commit),
        }
    }

    const tip = ref<{ commit: CommitNode; x: number; y: number } | null>(null)
    const tipEl = ref<HTMLElement | null>(null)
    let tipTimer: number | undefined

    function scheduleTip(content: { commit: CommitNode }, event: MouseEvent) {
        const { clientX, clientY } = event
        window.clearTimeout(tipTimer)
        tipTimer = window.setTimeout(() => {
            tip.value = { ...content, x: clientX + 14, y: clientY + 14 }
            // re-clamp with the card's real size once it has rendered
            nextTick(() => {
                const el = tipEl.value
                if (!el || !tip.value) return
                tip.value = {
                    ...content,
                    x: Math.max(8, Math.min(clientX + 14, window.innerWidth - el.offsetWidth - 8)),
                    y: Math.max(8, Math.min(clientY + 14, window.innerHeight - el.offsetHeight - 8)),
                }
            })
        }, 500)
    }

    function hideTip() {
        window.clearTimeout(tipTimer)
        tip.value = null
    }

    function showAvatarTip(commit: CommitNode, event: MouseEvent) {
        scheduleTip({ commit }, event)
    }

    interface SubjectPart {
        text: string
        hit: boolean
    }
    function subjectParts(subject: string): SubjectPart[] {
        const q = normalizedQuery.value
        if (!q) return [{ text: subject, hit: false }]
        const lower = subject.toLowerCase()
        const parts: SubjectPart[] = []
        let from = 0
        for (let at = lower.indexOf(q); at !== -1; at = lower.indexOf(q, from)) {
            if (at > from) parts.push({ text: subject.slice(from, at), hit: false })
            parts.push({ text: subject.slice(at, at + q.length), hit: true })
            from = at + q.length
        }
        if (from < subject.length) parts.push({ text: subject.slice(from), hit: false })
        return parts
    }

    watch([() => repoStore.pendingFocusHash, rowIndex], ([hash]) => {
        if (!hash) return
        const index = rowIndex.value.get(hash)
        const el = scrollEl.value
        if (!el) return
        if (index === undefined) {
            if (props.hasMore) emit('load-more')
            else repoStore.pendingFocusHash = null
            return
        }
        el.scrollTop = Math.max(0, rowTop(index) + rowHeightAt(index) / 2 - el.clientHeight / 2)
        onScroll()
        select(visibleCommits.value[index])
        repoStore.pendingFocusHash = null
    })

    watch(
        () => props.commitOpen,
        open => {
            if (!open) selectedHash.value = null
        }
    )
</script>

<template>
    <main
        class="graph-view"
        :style="{ '--author-w': `${authorW}px`, '--date-w': `${dateW}px`, '--hash-w': `${hashW}px`, '--sbw': `${sbw}px` }">
        <div class="graph-header">
            <span
                class="graph-graph-header"
                :style="{ width: `${graphW}px` }">
                GRAPH
            </span>
            <span class="graph-message-header">
                COMMIT MESSAGE
                <span class="commit-count"
                    >{{ normalizedQuery ? `${visibleCommits.length} of ${commits.length}` : commits.length }} commits</span
                >
                <span
                    v-if="repoStore.soloBranch"
                    class="solo-chip"
                    :title="`Showing only ${repoStore.soloBranch}`">
                    <i-lucide-crosshair
                        width="11"
                        height="11" />
                    Solo: {{ repoStore.soloBranch }}
                    <button
                        class="icon-btn danger commit-close-btn solo-clear"
                        title="Unsolo (show all branches)"
                        @click="repoStore.setSolo(null)">
                        <CloseXIcon />
                    </button>
                </span>
                <span
                    v-if="squashCount > 1"
                    class="solo-chip"
                    title="Shift+click to select a range — right-click to squash">
                    <i-lucide-combine
                        width="11"
                        height="11" />
                    Squash {{ squashCount }}
                    <button
                        class="icon-btn danger commit-close-btn solo-clear"
                        title="Clear squash selection"
                        @click="clearSquashPicks()">
                        <CloseXIcon />
                    </button>
                </span>
                <ThinkSpinner
                    v-if="repoStore.refreshingRepo"
                    compact
                    class="graph-refresh-spinner" />
                <label
                    class="commit-search"
                    title="Search commits">
                    <i-lucide-search
                        width="13"
                        height="13" />
                    <input
                        v-model="uiTransient.searchQuery"
                        placeholder="Search commits" />
                    <button
                        v-if="uiTransient.searchQuery"
                        type="button"
                        class="search-clear"
                        @click="uiTransient.searchQuery = ''">
                        ×
                    </button>
                </label>
                <button
                    class="icon-btn graph-settings-btn"
                    title="Commit history settings"
                    @click="showSettings = true">
                    <i-lucide-settings
                        width="14"
                        height="14" />
                </button>
            </span>
            <span
                v-if="ui.commitColumns.author"
                class="graph-author-header"
                >AUTHOR</span
            >
            <span
                v-if="ui.commitColumns.hash"
                class="graph-hash-header"
                >HASH</span
            >
            <span
                v-if="ui.commitColumns.date"
                class="graph-date-header"
                >DATE</span
            >
        </div>
        <div
            ref="scrollEl"
            class="graph-scroll"
            @scroll.passive="onScroll">
            <template v-if="totalHeight > 0">
                <svg
                    class="graph-canvas"
                    :width="graphW"
                    :height="totalHeight"
                    aria-hidden="true">
                    <template
                        v-for="{ commit, index } in graphWindow"
                        :key="`tint-${commit.hash}`">
                        <rect
                            class="lane-tint"
                            :x="nodeX(commit)"
                            :y="rowTop(index) + 1"
                            :width="Math.max(0, graphW - nodeX(commit))"
                            :height="rowHeightAt(index) - 2"
                            rx="2"
                            :fill="nodeColor(commit)"
                            fill-opacity="0.1" />
                        <rect
                            class="lane-tick"
                            :x="graphW - 3"
                            :y="rowTop(index) + 1"
                            width="3"
                            :height="rowHeightAt(index) - 2"
                            rx="1.5"
                            :fill="tickColor(commit)" />
                    </template>
                    <template
                        v-for="{ commit, parent, childIndex, parentIndex } in renderEdges"
                        :key="`${commit.hash}:${parent}`">
                        <path
                            class="edge-glow"
                            :class="{ merge: isMergeEdge(commit, parent) }"
                            :d="edgePath(commit, parent, childIndex, parentIndex)"
                            :stroke="edgeColor(commit, parent)"
                            fill="none" />
                        <path
                            class="edge-core"
                            :class="{ merge: isMergeEdge(commit, parent) }"
                            :d="edgePath(commit, parent, childIndex, parentIndex)"
                            :stroke="edgeColor(commit, parent)"
                            fill="none" />
                    </template>
                </svg>
                <div
                    :style="{ height: `${padTop}px` }"
                    aria-hidden="true" />
                <div
                    v-for="commit in renderedCommits"
                    :key="commit.hash"
                    class="graph-row"
                    :class="{
                        selected: selectedHash === commit.hash,
                        'msg-expanded': expandedHash === commit.hash,
                        'squash-in-scope': inSquashScope(commit),
                        'has-chips': isTwoLine(commit),
                    }"
                    :style="{
                        height: `${rowHeightFor(commit)}px`,
                        '--graph-w': `${graphW}px`,
                        '--row-color': nodeColor(commit),
                    }"
                    draggable="true"
                    @click="event => onRowClick(commit, event)"
                    @contextmenu.prevent.stop="openMenu(commit, $event)"
                    @dragstart="event => startCommitDrag(commit, event)">
                    <div
                        class="graph-cell"
                        :style="{ width: `${graphW}px` }">
                        <span
                            class="node-ring"
                            :class="{ selected: selectedHash === commit.hash }"
                            :style="avatarStyle(commit)"></span>
                        <span
                            class="node-avatar"
                            :class="{ selected: selectedHash === commit.hash, photo: hasAvatar(commit), icon: !hasAvatar(commit) }"
                            :style="avatarStyle(commit)"
                            @mouseenter="event => showAvatarTip(commit, event)"
                            @mouseleave="hideTip"
                            ><img
                                v-if="hasAvatar(commit)"
                                class="author-avatar-img"
                                :src="auth.githubUser?.avatarUrl"
                                :alt="commit.author" />
                            <template v-else>{{ avatarInitial(commit) }}</template></span
                        >
                    </div>
                    <span class="commit-subject">
                        <span
                            v-if="commit.refs.length"
                            class="subject-chips">
                            <span
                                v-for="ref in sortedRefs(commit)"
                                :key="ref"
                                class="ref-chip"
                                :class="refKind(ref)"
                                :title="refLabel(ref)"
                                :style="{
                                    '--chip-color': chipColor(ref),
                                    '--chip-fg': contrastText(chipColor(ref)),
                                }">
                                <i-lucide-git-branch
                                    v-if="refKind(ref) === 'head' || refKind(ref) === 'local'"
                                    width="9"
                                    height="9" />
                                <i-lucide-globe2
                                    v-else-if="refKind(ref) === 'remote'"
                                    width="9"
                                    height="9" />
                                <i-lucide-tag
                                    v-else
                                    width="9"
                                    height="9" />
                                {{ refLabel(ref) }}
                            </span>
                        </span>
                        <span class="subject-line">
                            <span class="subject-text"
                                ><template
                                    v-for="(part, pi) in subjectParts(commit.subject)"
                                    :key="pi"
                                    ><mark
                                        v-if="part.hit"
                                        class="search-hit"
                                        >{{ part.text }}</mark
                                    ><template v-else>{{ part.text }}</template></template
                                ></span
                            >
                            <button
                                v-if="commit.body"
                                class="msg-toggle"
                                :title="expandedHash === commit.hash ? 'Collapse message' : 'Show full message'"
                                @click.stop="toggleMessage(commit.hash, $event)">
                                <i-lucide-chevron-down
                                    v-if="expandedHash === commit.hash"
                                    width="13"
                                    height="13" />
                                <i-lucide-chevron-right
                                    v-else
                                    width="13"
                                    height="13" />
                            </button>
                        </span>
                    </span>
                    <span
                        v-if="ui.commitColumns.author"
                        class="commit-author">
                        <span class="author-name">{{ commit.author }}</span>
                    </span>
                    <span
                        v-if="ui.commitColumns.hash"
                        class="commit-hash"
                        >{{ commit.shortHash }}</span
                    >
                    <span
                        v-if="ui.commitColumns.date"
                        class="commit-date"
                        >{{ formatDatePattern(commit.date, commitDatePattern) }}</span
                    >
                    <div
                        v-if="expandedHash === commit.hash"
                        class="commit-msg-popover"
                        :class="{ above: expandedAbove }"
                        @click.stop>
                        <div class="cmp-meta">
                            <strong class="cmp-author">{{ commit.author }}</strong>
                            <span class="cmp-date">{{ formatDate(commit.date) }}</span>
                            <span class="cmp-hash">{{ commit.shortHash }}</span>
                        </div>
                        <div class="cmp-subject">{{ commit.subject }}</div>
                        <pre
                            v-if="commit.body"
                            class="cmp-message"
                            :style="{ maxHeight: `${expandedMaxH}px` }"
                            >{{ commit.body }}</pre>
                    </div>
                </div>
                <div
                    :style="{ height: `${padBottom}px` }"
                    aria-hidden="true" />
            </template>
            <div
                v-if="visibleCommits.length === 0"
                class="graph-empty">
                {{ normalizedQuery ? 'No matching commits' : 'No commits found in this repository' }}
            </div>
            <div
                v-if="hasMore && !normalizedQuery"
                class="graph-load-more">
                <button
                    class="btn small"
                    @click="emit('load-more')">
                    Load more commits
                </button>
            </div>
        </div>
        <button
            v-if="showToTop && !props.hideToTop"
            class="to-top-btn"
            title="Back to top"
            @click="scrollToTop">
            <i-lucide-arrow-up
                width="16"
                height="16" />
        </button>
        <div
            v-if="tip"
            ref="tipEl"
            class="avatar-tip"
            :style="{ left: `${tip.x}px`, top: `${tip.y}px` }">
            <span
                v-if="tip.commit.refs.length"
                class="subject-chips avatar-tip-chips">
                <span
                    v-for="ref in sortedRefs(tip.commit)"
                    :key="ref"
                    class="ref-chip"
                    :class="refKind(ref)"
                    :style="{
                        '--chip-color': chipColor(ref),
                        '--chip-fg': contrastText(chipColor(ref)),
                    }">
                    <i-lucide-git-branch
                        v-if="refKind(ref) === 'head' || refKind(ref) === 'local'"
                        width="9"
                        height="9" />
                    <i-lucide-globe2
                        v-else-if="refKind(ref) === 'remote'"
                        width="9"
                        height="9" />
                    <i-lucide-tag
                        v-else
                        width="9"
                        height="9" />
                    {{ refLabel(ref) }}
                </span>
            </span>
            <span class="avatar-tip-author">
                <span
                    class="avatar-tip-dot"
                    :style="{ background: avatarColor(tip.commit.author) }"
                    >{{ avatarInitial(tip.commit) }}</span
                >
                <strong>{{ tip.commit.author }}</strong>
            </span>
            <span
                v-if="tip.commit.authorEmail"
                class="avatar-tip-email"
                >{{ tip.commit.authorEmail }}</span
            >
            <span class="avatar-tip-date">{{ formatDatePattern(tip.commit.date, commitDatePattern) }}</span>
        </div>
        <CommitContextMenu
            :menu="menu"
            @close="menu = null"
            @checkout="commit => emit('checkout', commit)"
            @create-branch="commit => emit('create-branch', commit)"
            @create-tag="commit => emit('create-tag', commit)"
            @cherry-pick="commit => emit('cherry-pick', commit)"
            @squash="onMenuSquash"
            @revert="commit => emit('revert', commit)"
            @reset-soft="commit => emit('reset-soft', commit)"
            @reset-hard="commit => emit('reset-hard', commit)" />
        <GraphSettingsModal
            v-if="showSettings"
            @close="showSettings = false" />
    </main>
</template>
