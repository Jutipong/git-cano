<script setup lang="ts">
    import ContextMenuVue, { type MenuState } from './ContextMenu.vue'

    import { useRepoStore } from '../stores/repo'
    import { formatShortDate } from '../utils/format'

    import type { CommitNode, MenuItem } from '@shared/types'

    interface Props {
        commits: CommitNode[]
        hasMore: boolean
        commitOpen: boolean
        buildCommitMenu: (commit: CommitNode) => MenuItem[]
    }

    const props = defineProps<Props>()
    const emit = defineEmits<{
        (e: 'select-commit', commit: CommitNode): void
        (e: 'close-commit'): void
        (e: 'load-more'): void
    }>()

    const COLORS = ['#35c6b0', '#5b9cf6', '#b78af7', '#f2a65a', '#ef6b73', '#4fc3d8', '#e3bd55', '#ef82b8']
    const laneW = 24
    const rowH = 28

    const uiTransient = useUiTransientStore()
    const repoStore = useRepoStore()
    const selectedHash = ref<string | null>(null)
    const menu = ref<MenuState | null>(null)
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
    const graphW = computed(() => Math.max((visibleCommits.value.reduce((max, c) => Math.max(max, c.lane), 0) + 1) * laneW + 20, 64))
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
        menu.value = { x: event.clientX, y: event.clientY, items: props.buildCommitMenu(commit) }
    }

    function select(commit: CommitNode) {
        selectedHash.value = commit.hash
        if (expandedHash.value && expandedHash.value !== commit.hash) expandedHash.value = null
        emit('select-commit', commit)
    }

    function nodeColor(commit: CommitNode) {
        return COLORS[commit.lane % COLORS.length]
    }
    function nodeX(commit: CommitNode) {
        return commit.lane * laneW + laneW / 2
    }
    function nodeY(index: number) {
        return index * rowH + rowH / 2
    }
    function formatDate(iso: string): string {
        return formatShortDate(iso)
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
            <span :style="{ width: `${graphW}px` }">GRAPH</span>
            <span class="graph-message-header">COMMIT MESSAGE</span>
            <span class="graph-author-header">AUTHOR</span>
            <span class="graph-date-header">DATE</span>
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
                        v-for="(commit, index) in visibleCommits"
                        :key="commit.hash">
                        <template
                            v-for="parent in commit.parents"
                            :key="`${commit.hash}:${parent}`">
                            <path
                                v-if="
                                    rowIndex.get(parent) !== undefined &&
                                    rowIndex.get(parent)! > index &&
                                    index <= visibleRange[1] + 5 &&
                                    rowIndex.get(parent)! <= visibleRange[1] + 5
                                "
                                :d="`M ${nodeX(commit)} ${nodeY(index)}
                     C ${nodeX(commit)} ${nodeY(index) + rowH * 0.55},
                       ${nodeX(visibleCommits[rowIndex.get(parent)!])} ${nodeY(rowIndex.get(parent)!) + rowH * 0.55},
                       ${nodeX(visibleCommits[rowIndex.get(parent)!])} ${nodeY(rowIndex.get(parent)!)}`"
                                :stroke="nodeColor(commit)"
                                stroke-width="2"
                                fill="none" />
                        </template>
                    </template>
                    <g
                        v-for="(commit, index) in visibleCommits"
                        v-show="index >= visibleRange[0] - 5 && index <= visibleRange[1] + 5"
                        :key="`node-${commit.hash}`">
                        <circle
                            v-if="selectedHash === commit.hash || dropTargetHash === commit.hash"
                            :class="{ 'commit-selection-ring': selectedHash === commit.hash }"
                            :cx="nodeX(commit)"
                            :cy="nodeY(index)"
                            r="8"
                            fill="none"
                            :stroke="dropTargetHash === commit.hash ? 'var(--teal)' : 'var(--text)'"
                            stroke-width="1.5"
                            opacity="0.9" />
                        <circle
                            :cx="nodeX(commit)"
                            :cy="nodeY(index)"
                            :r="selectedHash === commit.hash ? 6 : 5"
                            :fill="nodeColor(commit)"
                            stroke="var(--canvas)"
                            stroke-width="2" />
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
                    :style="{ height: `${rowH}px`, '--graph-w': `${graphW}px` }"
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
                        class="graph-cell"
                        :style="{ width: `${graphW}px` }" />
                    <span class="commit-subject">
                        <span
                            v-if="commit.refs.length"
                            class="subject-chips">
                            <span
                                v-for="ref in commit.refs"
                                :key="ref"
                                class="ref-chip"
                                :class="{ head: ref.startsWith('HEAD'), tag: ref.startsWith('tag:') }"
                                :style="{ '--chip-color': nodeColor(commit) }">
                                {{ ref.replace('HEAD -> ', '') }}
                            </span>
                        </span>
                        <span class="subject-line">
                            <span class="subject-text">{{ commit.subject }}</span>
                            <button
                                v-if="commit.body"
                                class="msg-toggle"
                                :title="expandedHash === commit.hash ? 'Collapse message' : 'Show full message'"
                                @click.stop="toggleMessage(commit.hash)">
                                <i-lucide-chevron-down
                                    v-if="expandedHash === commit.hash"
                                    width="12"
                                    height="12" />
                                <i-lucide-chevron-right
                                    v-else
                                    width="12"
                                    height="12" />
                            </button>
                        </span>
                    </span>
                    <span class="commit-author">{{ commit.author }}</span>
                    <span class="commit-date">{{ formatDate(commit.date) }}</span>
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
        <ContextMenuVue
            :menu="menu"
            @close="menu = null" />
    </main>
</template>
