<script setup lang="ts">
    import { nextTick } from 'vue'

    import { useAuthStore } from '../stores/auth'
    import { useRepoStore } from '../stores/repo'
    import { useUiStore } from '../stores/ui'
    import { formatDatePattern, formatShortDate } from '../utils/format'
    import CommitContextMenu, { type CommitMenuState } from './CommitContextMenu.vue'
    import GraphSettingsModal from './GraphSettingsModal.vue'

    import type { CommitNode } from '@shared/types'

    interface Props {
        commits: CommitNode[]
        hasMore: boolean
        commitOpen: boolean
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
        (e: 'revert', commit: CommitNode): void
        (e: 'reset-soft', commit: CommitNode): void
        (e: 'reset-hard', commit: CommitNode): void
    }>()

    const FIRST_LANE_COLOR = '#F55FA0'
    const COLORS = ['#58E06B', '#B790FF', '#FF8A3D', '#29A8FF', '#22E0D0', '#FFD60A', '#FF4D9E', '#8CFF4D', '#4DD2FF', '#E8FF4D']
    const laneW = 32
    const rowH = 28
    /* breathing room between the graph panel's left edge and the first lane */
    const GRAPH_PAD = 4

    const uiTransient = useUiTransientStore()
    const repoStore = useRepoStore()
    const ui = useUiStore()
    const selectedHash = ref<string | null>(null)
    const showSettings = ref(false)
    const menu = ref<CommitMenuState | null>(null)
    const dropTargetHash = ref<string | null>(null)
    const visibleRange = ref<[number, number]>([0, 60])
    const scrollEl = ref<HTMLElement | null>(null)
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

    function fullMessage(commit: CommitNode): string {
        return [commit.subject, commit.body].filter(Boolean).join('\n\n')
    }

    function onKeydown(event: KeyboardEvent) {
        if (event.key === 'Escape') expandedHash.value = null
    }
    onMounted(() => window.addEventListener('keydown', onKeydown))
    onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
    onBeforeUnmount(() => window.clearTimeout(tipTimer))

    const normalizedQuery = computed(() => uiTransient.searchQuery.trim().toLowerCase())
    const visibleCommits = computed(() =>
        normalizedQuery.value
            ? props.commits.filter(commit =>
                  `${commit.subject} ${commit.author} ${commit.hash} ${commit.refs.join(' ')}`.toLowerCase().includes(normalizedQuery.value)
              )
            : props.commits
    )
    const GRAPH_MIN_W = 120
    const graphW = computed(
        () => Math.max((visibleCommits.value.reduce((max, c) => Math.max(max, c.lane), 0) + 1) * laneW + 20, GRAPH_MIN_W) + GRAPH_PAD
    )
    const rowIndex = computed(() => new Map(visibleCommits.value.map((commit, index) => [commit.hash as string, index])))
    const totalHeight = computed(() => visibleCommits.value.length * rowH)
    const renderedCommits = computed(() => visibleCommits.value.slice(visibleRange.value[0], visibleRange.value[1]))
    /** Only the commits inside the visible window (+ overscan) get SVG nodes — tint/tick/edges. */
    const graphWindow = computed(() => {
        const [start, end] = visibleRange.value
        const from = Math.max(0, start - 5)
        const to = Math.min(visibleCommits.value.length, end + 5)
        return visibleCommits.value.slice(from, to).map((commit, offset) => ({ commit, index: from + offset }))
    })

    let loadMoreArmed = true
    function onScroll() {
        hideTip()
        const el = scrollEl.value
        if (!el) return
        const start = Math.max(0, Math.floor(el.scrollTop / rowH) - 15)
        const count = Math.ceil(el.clientHeight / rowH) + 30
        visibleRange.value = [start, start + count]
        const nearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - rowH * 10
        if (props.hasMore && nearBottom && loadMoreArmed) {
            loadMoreArmed = false
            emit('load-more')
        } else if (!nearBottom) {
            loadMoreArmed = true
        }
    }

    function openMenu(commit: CommitNode, event: MouseEvent) {
        select(commit)
        menu.value = { x: event.clientX, y: event.clientY, commit }
    }

    function select(commit: CommitNode) {
        selectedHash.value = commit.hash
        if (expandedHash.value && expandedHash.value !== commit.hash) expandedHash.value = null
        emit('select-commit', commit)
    }

    function nodeColor(commit: CommitNode) {
        return commit.lane === 0 ? FIRST_LANE_COLOR : COLORS[(commit.lane - 1) % COLORS.length]
    }
    function isMergeEdge(commit: CommitNode, parent: string) {
        return commit.parents.indexOf(parent) > 0
    }
    function nodeX(commit: CommitNode) {
        return GRAPH_PAD + commit.lane * laneW + laneW / 2
    }
    function nodeY(index: number) {
        return index * rowH + rowH / 2
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
    const REF_ORDER: Record<RefKind, number> = { head: 0, local: 1, remote: 2, tag: 3 }

    const knownRemotes = ref(new Set<string>())
    async function loadRemotes() {
        try {
            const list = await window.api.remotesFull()
            knownRemotes.value = new Set(list.map(r => r.name))
        } catch {
            knownRemotes.value = new Set()
        }
    }
    watch(() => repoStore.repo?.path, loadRemotes, { immediate: true })

    function refKind(ref: string): RefKind {
        if (ref.startsWith('tag:')) return 'tag'
        const name = ref.replace('HEAD -> ', '')
        if (name !== ref) return 'head'
        const slash = name.indexOf('/')
        if (slash > 0 && knownRemotes.value.has(name.slice(0, slash))) return 'remote'
        return 'local'
    }
    function refLabel(ref: string): string {
        return ref.startsWith('tag:') ? ref.slice(4).trim() : ref.replace('HEAD -> ', '')
    }
    function sortedRefs(commit: CommitNode): string[] {
        return [...commit.refs].sort((a, b) => REF_ORDER[refKind(a)] - REF_ORDER[refKind(b)])
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
        return COLORS[hashString(name) % COLORS.length]
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
        const color = nameColor(avatarKey(commit))
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
        el.scrollTop = Math.max(0, index * rowH - el.clientHeight / 2)
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
        :style="{ '--author-w': `${authorW}px`, '--date-w': `${dateW}px`, '--hash-w': `${hashW}px` }">
        <div class="graph-header">
            <span
                class="graph-graph-header"
                :style="{ width: `${graphW}px` }">
                <button
                    class="icon-btn graph-settings-btn"
                    title="Commit history settings"
                    @click="showSettings = true">
                    <i-lucide-settings
                        width="14"
                        height="14" />
                </button>
                GRAPH
            </span>
            <span class="graph-message-header">
                COMMIT MESSAGE
                <span class="commit-count"
                    >{{ normalizedQuery ? `${visibleCommits.length} of ${commits.length}` : commits.length }} commits</span
                >
                <i-lucide-loader-circle
                    v-if="repoStore.refreshingRepo"
                    class="spinning graph-refresh-spinner"
                    width="13"
                    height="13" />
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
                            :y="index * rowH + 1"
                            :width="Math.max(0, graphW - nodeX(commit))"
                            :height="rowH - 2"
                            rx="2"
                            :fill="nodeColor(commit)"
                            fill-opacity="0.1" />
                        <rect
                            class="lane-tick"
                            :x="graphW - 3"
                            :y="index * rowH + 1"
                            width="3"
                            :height="rowH - 2"
                            rx="1.5"
                            :fill="tickColor(commit)" />
                    </template>
                    <template
                        v-for="{ commit, index } in graphWindow"
                        :key="commit.hash">
                        <template
                            v-for="parent in commit.parents"
                            :key="`${commit.hash}:${parent}`">
                            <template
                                v-if="
                                    rowIndex.get(parent) !== undefined &&
                                    rowIndex.get(parent)! > index &&
                                    index <= visibleRange[1] + 5 &&
                                    rowIndex.get(parent)! >= visibleRange[0] - 5
                                ">
                                <path
                                    class="edge-glow"
                                    :class="{ merge: isMergeEdge(commit, parent) }"
                                    :d="edgePath(commit, parent, index, rowIndex.get(parent)!)"
                                    :stroke="edgeColor(commit, parent)"
                                    fill="none" />
                                <path
                                    class="edge-core"
                                    :class="{ merge: isMergeEdge(commit, parent) }"
                                    :d="edgePath(commit, parent, index, rowIndex.get(parent)!)"
                                    :stroke="edgeColor(commit, parent)"
                                    fill="none" />
                            </template>
                        </template>
                    </template>
                </svg>
                <div
                    :style="{ height: `${visibleRange[0] * rowH}px` }"
                    aria-hidden="true" />
                <div
                    v-for="commit in renderedCommits"
                    :key="commit.hash"
                    class="graph-row"
                    :class="{
                        selected: selectedHash === commit.hash,
                        'drop-target': dropTargetHash === commit.hash,
                        'msg-expanded': expandedHash === commit.hash,
                    }"
                    :style="{
                        height: `${rowH}px`,
                        '--graph-w': `${graphW}px`,
                        '--row-color': nodeColor(commit),
                    }"
                    draggable="true"
                    @click="select(commit)"
                    @contextmenu.prevent.stop="openMenu(commit, $event)"
                    @dragstart="$event.dataTransfer?.setData('text/plain', `commit:${commit.hash}`)"
                    @dragover="
                        $event => {
                            if ($event.dataTransfer?.types.includes('text/plain')) {
                                $event.preventDefault()
                                dropTargetHash = commit.hash
                            }
                        }
                    "
                    @dragleave="dropTargetHash = null">
                    <div
                        class="graph-cell"
                        :style="{ width: `${graphW}px` }">
                        <span
                            class="node-ring"
                            :class="{
                                selected: selectedHash === commit.hash,
                                'drop-target': dropTargetHash === commit.hash,
                            }"
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
                        <div class="cmp-meta">{{ [commit.author, formatDate(commit.date), commit.shortHash].join(' · ') }}</div>
                        <pre
                            class="cmp-message"
                            :style="{ maxHeight: `${expandedMaxH}px` }"
                            >{{ fullMessage(commit) }}</pre>
                    </div>
                </div>
                <div
                    :style="{ height: `${Math.max(0, (visibleCommits.length - visibleRange[1]) * rowH)}px` }"
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
        <div
            v-if="tip"
            ref="tipEl"
            class="avatar-tip"
            :style="{ left: `${tip.x}px`, top: `${tip.y}px` }">
            <strong>{{ tip.commit.author }}</strong>
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
            @revert="commit => emit('revert', commit)"
            @reset-soft="commit => emit('reset-soft', commit)"
            @reset-hard="commit => emit('reset-hard', commit)" />
        <GraphSettingsModal
            v-if="showSettings"
            @close="showSettings = false" />
    </main>
</template>
