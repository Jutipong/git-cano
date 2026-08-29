<script setup lang="ts">
    import CommitContextMenu, { type CommitMenuState } from './CommitContextMenu.vue'

    import { useRepoStore } from '../stores/repo'
    import { useUiStore } from '../stores/ui'
    import { formatDatePattern, formatShortDate } from '../utils/format'

    import GraphSettingsModal from './GraphSettingsModal.vue'

    import type { CommitNode } from '@shared/types'

    interface Props {
        commits: CommitNode[]
        hasMore: boolean
        commitOpen: boolean
    }

    const props = defineProps<Props>()
    const emit = defineEmits<{
        (e: 'select-commit', commit: CommitNode): void
        (e: 'close-commit'): void
        (e: 'load-more'): void
        (e: 'checkout', commit: CommitNode): void
        (e: 'create-branch', commit: CommitNode): void
        (e: 'create-tag', commit: CommitNode): void
        (e: 'cherry-pick', commit: CommitNode): void
        (e: 'revert', commit: CommitNode): void
        (e: 'reset-soft', commit: CommitNode): void
        (e: 'reset-hard', commit: CommitNode): void
    }>()

    // Signature colour for the first-parent (main) lane so the trunk reads as one line
    const FIRST_LANE_COLOR = '#4C9AFF'
    // 13 lane colours (vivid GitKraken-style) — alternating warm/cool so adjacent lanes
    // contrast, and deliberately NO orange (reserved for the tag chips) and no teal
    // (reserved for the first-parent lane above)
    const COLORS = [
        '#F062A4', '#8BC34A', '#B388FF', '#EF5350',
        '#26C6DA', '#FFD166', '#5C6BC0', '#66BB6A',
        '#EC407A', '#29B6F6', '#AB47BC', '#FFCA28',
        '#7E57C2',
    ]
    const laneW = 32
    const rowH = 28

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

    function toggleMessage(hash: string) {
        expandedHash.value = expandedHash.value === hash ? null : hash
    }

    function fullMessage(commit: CommitNode): string {
        return [commit.subject, commit.body].filter(Boolean).join('\n\n')
    }

    function onKeydown(event: KeyboardEvent) {
        if (event.key === 'Escape') expandedHash.value = null
    }
    onMounted(() => window.addEventListener('keydown', onKeydown))
    onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))

    const normalizedQuery = computed(() => uiTransient.searchQuery.trim().toLowerCase())
    const visibleCommits = computed(() =>
        normalizedQuery.value
            ? props.commits.filter(commit =>
                  `${commit.subject} ${commit.author} ${commit.hash} ${commit.refs.join(' ')}`.toLowerCase().includes(normalizedQuery.value)
              )
            : props.commits
    )
    // graph lane width collapses to 0 when the GRAPH column is hidden, so the
    // absolutely-positioned svg (edges + nodes) disappears with the header column
    const graphW = computed(() =>
        ui.commitColumns.graph
            ? Math.max((visibleCommits.value.reduce((max, c) => Math.max(max, c.lane), 0) + 1) * laneW + 20, 64)
            : 0
    )
    const rowIndex = computed(() => new Map(visibleCommits.value.map((commit, index) => [commit.hash as string, index])))
    const totalHeight = computed(() => visibleCommits.value.length * rowH)
    const renderedCommits = computed(() => visibleCommits.value.slice(visibleRange.value[0], visibleRange.value[1]))

    function onScroll() {
        const el = scrollEl.value
        if (!el) return
        const start = Math.max(0, Math.floor(el.scrollTop / rowH) - 15)
        const count = Math.ceil(el.clientHeight / rowH) + 30
        visibleRange.value = [start, start + count]
        if (props.hasMore && el.scrollTop + el.clientHeight >= el.scrollHeight - rowH * 10) emit('load-more')
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
    // a merge edge is any edge that leaves a non-first parent (the trunk keeps solid lines)
    function isMergeEdge(commit: CommitNode, parent: string) {
        return commit.parents.indexOf(parent) > 0
    }
    function nodeX(commit: CommitNode) {
        return commit.lane * laneW + laneW / 2
    }
    function nodeY(index: number) {
        return index * rowH + rowH / 2
    }
    // rounded-elbow merge: leaves the child vertically, curves in near the parent
    function edgeD(childIndex: number, parentIndex: number): string {
        const cx = nodeX(visibleCommits.value[childIndex])
        const cy = nodeY(childIndex)
        const px = nodeX(visibleCommits.value[parentIndex])
        const py = nodeY(parentIndex)
        const gap = py - cy
        // symmetric S-curve: spread the horizontal transition over up to ~2.5 rows per
        // side so long branch lines sweep in smoothly (Git Fork style) instead of hooking
        const ease = Math.min(gap * 0.5, rowH * 2.5)
        return `M ${cx} ${cy} C ${cx} ${cy + ease}, ${px} ${py - ease}, ${px} ${py}`
    }
    // long branch rejoin (side-branch rail falling back to the trunk many rows below):
    // run straight along the child's lane, then turn into the parent node with a single
    // quarter-turn near the bottom — Git Fork style. A plain S-curve over such a huge gap
    // would render as a shallow diagonal hugging the trunk for dozens of rows.
    function rejoinEdgeD(childIndex: number, parentIndex: number): string {
        const cx = nodeX(visibleCommits.value[childIndex])
        const cy = nodeY(childIndex)
        const px = nodeX(visibleCommits.value[parentIndex])
        const py = nodeY(parentIndex)
        const r = Math.min((py - cy) * 0.5, Math.abs(px - cx), rowH * 2.5)
        return `M ${cx} ${cy} L ${cx} ${py - r} Q ${cx} ${py} ${px} ${py}`
    }
    // short return to the trunk: leave the parent's row horizontally, then make
    // the same rounded turn as a merge edge before running up into the child node
    function shortReturnEdgeD(childIndex: number, parentIndex: number): string {
        const cx = nodeX(visibleCommits.value[childIndex])
        const cy = nodeY(childIndex)
        const px = nodeX(visibleCommits.value[parentIndex])
        const py = nodeY(parentIndex)
        const r = Math.min(10, Math.abs(px - cx) / 2, (py - cy) / 2)
        const dir = cx > px ? 1 : -1
        return `M ${cx} ${cy} L ${cx} ${py - r} Q ${cx} ${py} ${cx - dir * r} ${py} L ${px} ${py}`
    }
    // GitKraken-style merge: leaves the merge commit horizontally along its own row,
    // turns a rounded 90° corner onto the parent's lane, then drops straight into the
    // parent node — the parent's lane stays a clean vertical rail
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
        // Short returns leave the trunk row before making the same rounded turn
        // as the upper branch; the merge edge above remains unchanged.
        if (parentX < childX) return shortReturnEdgeD(childIndex, parentIndex)
        // past ~5 rows the S-curve flattens into a diagonal — switch to the rail + turn
        return gap > rowH * 5 ? rejoinEdgeD(childIndex, parentIndex) : edgeD(childIndex, parentIndex)
    }
    // merge edges take the parent lane's colour so the elbow + drop reads as one rail
    // with the branch line below; trunk edges keep the child's colour
    function edgeColor(commit: CommitNode, parent: string): string {
        const parentIndex = rowIndex.value.get(parent)
        const parentCommit = parentIndex === undefined ? undefined : visibleCommits.value[parentIndex]
        return isMergeEdge(commit, parent) && parentCommit ? nodeColor(parentCommit) : nodeColor(commit)
    }
    function formatDate(iso: string): string {
        return formatShortDate(iso)
    }
    // DATE column honours the user's token pattern; blank input falls back to the default
    const commitDatePattern = computed(() => ui.commitDateFormat.trim() || 'dd/MM/yyyy HH:mm')
    // pick a readable text colour on the solid chip fill (non-hex like "var(--orange)" → light)
    function contrastText(hex: string): string {
        if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return '#f5f7fa'
        const r = parseInt(hex.slice(1, 3), 16)
        const g = parseInt(hex.slice(3, 5), 16)
        const b = parseInt(hex.slice(5, 7), 16)
        const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
        return luminance > 150 ? '#122d2c' : '#f5f7fa'
    }

    /* ---- ref chips: kind detection, stable per-name colours, ordering ---- */

    type RefKind = 'head' | 'local' | 'remote' | 'tag'
    const REF_ORDER: Record<RefKind, number> = { head: 0, local: 1, remote: 2, tag: 3 }

    // remote names of the active repo, so "feature/x" locals aren't mistaken for remotes
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
    // stable colour per ref: hash the branch name (remotes colour after their branch,
    // so origin/main matches main) — a branch keeps its colour wherever it appears
    function chipColor(ref: string): string {
        const kind = refKind(ref)
        if (kind === 'tag') return 'var(--orange)'
        const name = refLabel(ref)
        return nameColor(kind === 'remote' ? name.slice(name.lastIndexOf('/') + 1) : name)
    }

    /* ---- stable colours / avatar for authors ---- */

    function hashString(s: string): number {
        let h = 0
        for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
        return h
    }
    function nameColor(name: string): string {
        return COLORS[hashString(name) % COLORS.length]
    }

    /* ---- search highlight inside the subject ---- */

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

    // scroll the graph to the commit a clicked sidebar branch points to, then select it
    watch(
        [() => repoStore.pendingFocusHash, rowIndex],
        ([hash]) => {
            if (!hash) return
            const index = rowIndex.value.get(hash)
            const el = scrollEl.value
            if (!el) return
            if (index === undefined) {
                // tip not in the loaded log window yet — keep the request alive and load more
                if (props.hasMore) emit('load-more')
                else repoStore.pendingFocusHash = null
                return
            }
            el.scrollTop = Math.max(0, index * rowH - el.clientHeight / 2)
            onScroll()
            select(visibleCommits.value[index])
            repoStore.pendingFocusHash = null
        }
    )
</script>

<template>
    <main class="graph-view">
        <div
            class="graph-toolbar"
            :class="{ 'commit-mode': props.commitOpen }">
            <div class="graph-title">
                <i-lucide-git-commit-horizontal
                    width="17"
                    height="17" />
                <strong>Commit history</strong>
                <span>{{ normalizedQuery ? `${visibleCommits.length} of ${commits.length}` : commits.length }} commits</span>
            </div>
            <label
                class="commit-search"
                title="Search commits">
                <i-lucide-search
                    width="15"
                    height="15" />
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
            <div class="spacer" />
            <button
                class="icon-btn graph-settings-btn"
                title="Commit history settings"
                @click="showSettings = true">
                <i-lucide-settings
                    width="14"
                    height="14" />
            </button>
            <button
                v-if="props.commitOpen"
                class="icon-btn danger commit-close-btn"
                title="Close commit details (show working directory)"
                @click="emit('close-commit')">
                <i-lucide-x
                    width="14"
                    height="14" />
            </button>
        </div>
        <div class="graph-header">
            <span
                v-if="ui.commitColumns.graph"
                :style="{ width: `${graphW}px` }">GRAPH</span>
            <span
                v-if="ui.commitColumns.message"
                class="graph-message-header">COMMIT MESSAGE</span>
            <span
                v-if="ui.commitColumns.author"
                class="graph-author-header">AUTHOR</span>
            <span
                v-if="ui.commitColumns.hash"
                class="graph-hash-header">HASH</span>
            <span
                v-if="ui.commitColumns.date"
                class="graph-date-header">DATE</span>
        </div>
        <div
            ref="scrollEl"
            class="graph-scroll"
            @scroll.passive="onScroll">
            <template v-if="totalHeight > 0">
                <svg
                    v-if="ui.commitColumns.graph"
                    class="graph-canvas"
                    :width="graphW"
                    :height="totalHeight"
                    aria-hidden="true">
                    <template
                        v-for="(commit, index) in visibleCommits"
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
                    <g
                        v-for="(commit, index) in visibleCommits"
                        v-show="index >= visibleRange[0] - 5 && index <= visibleRange[1] + 5"
                        :key="`node-${commit.hash}`">
                        <circle
                            class="commit-ring"
                            :class="{
                                selected: selectedHash === commit.hash,
                                'drop-target': dropTargetHash === commit.hash
                            }"
                            :cx="nodeX(commit)"
                            :cy="nodeY(index)"
                            r="8"
                            fill="none"
                            stroke-width="1.5" />
                        <circle
                            class="node-dot"
                            :class="{
                                selected: selectedHash === commit.hash,
                                merge: commit.parents.length > 1
                            }"
                            :style="{ '--node-color': nodeColor(commit) }"
                            :cx="nodeX(commit)"
                            :cy="nodeY(index)"
                            :r="selectedHash === commit.hash ? 7 : 6"
                            :fill="nodeColor(commit)"
                            stroke="var(--canvas)"
                            stroke-width="2" />
                        <circle
                            v-if="commit.parents.length > 1"
                            class="merge-ring"
                            :style="{ '--node-color': nodeColor(commit) }"
                            :cx="nodeX(commit)"
                            :cy="nodeY(index)"
                            r="7.5"
                            fill="none"
                            stroke-width="1.5" />
                    </g>
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
                        'msg-expanded': expandedHash === commit.hash
                    }"
                    :style="{
                        height: `${rowH}px`,
                        '--graph-w': `${graphW}px`,
                        '--row-color': nodeColor(commit),
                        '--row-start': `${nodeX(commit)}px`
                    }"
                    :title="`${commit.shortHash} — ${commit.subject}`"
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
                        v-if="ui.commitColumns.graph"
                        class="graph-cell"
                        :style="{ width: `${graphW}px` }" />
                    <span
                        v-if="ui.commitColumns.message"
                        class="commit-subject">
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
                                    '--chip-fg': contrastText(chipColor(ref))
                                }">
                                <i-lucide-git-branch
                                    v-if="refKind(ref) === 'head' || refKind(ref) === 'local'"
                                    width="9"
                                    height="9" />
                                <i-lucide-cloud
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
                            <span class="subject-text"><template
                                v-for="(part, pi) in subjectParts(commit.subject)"
                                :key="pi"><mark
                                    v-if="part.hit"
                                    class="search-hit">{{ part.text }}</mark><template v-else>{{ part.text }}</template></template></span>
                            <button
                                v-if="commit.body"
                                class="msg-toggle"
                                :title="expandedHash === commit.hash ? 'Collapse message' : 'Show full message'"
                                @click.stop="toggleMessage(commit.hash)">
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
                        <span
                            class="author-avatar"
                            :style="{ '--avatar-color': nameColor(commit.author) }">{{ commit.author.slice(0, 1).toUpperCase() }}</span>
                        <span class="author-name">{{ commit.author }}</span>
                    </span>
                    <span
                        v-if="ui.commitColumns.hash"
                        class="commit-hash">{{ commit.shortHash }}</span>
                    <span
                        v-if="ui.commitColumns.date"
                        class="commit-date">{{ formatDatePattern(commit.date, commitDatePattern) }}</span>
                    <div
                        v-if="expandedHash === commit.hash"
                        class="commit-msg-popover"
                        @click.stop>
                        <div class="cmp-meta">{{ [commit.author, formatDate(commit.date), commit.shortHash].join(' · ') }}</div>
                        <pre class="cmp-message">{{ fullMessage(commit) }}</pre>
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
