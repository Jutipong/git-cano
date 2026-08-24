<script setup lang="ts">
    import ContextMenuVue, { type MenuState } from './ContextMenu.vue'

    import type { CommitNode, MenuItem } from '@shared/types'

    interface Props {
        commits: CommitNode[]
        query: string
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
    const BASE_LANE_W = 24
    const BASE_ROW_H = 42
    const ZOOM_MIN = 0.65
    const ZOOM_MAX = 1.6

    const selectedHash = ref<string | null>(null)
    const menu = ref<MenuState | null>(null)
    const dropTargetHash = ref<string | null>(null)
    const zoom = ref(Number(localStorage.getItem('ogit-graph-zoom')) || 1)
    const visibleRange = ref<[number, number]>([0, 60])
    const scrollEl = ref<HTMLElement | null>(null)

    const laneW = computed(() => Math.round(BASE_LANE_W * zoom.value))
    const rowH = computed(() => Math.round(BASE_ROW_H * zoom.value))

    watch(zoom, value => localStorage.setItem('ogit-graph-zoom', String(value)))

    const normalizedQuery = computed(() => props.query.trim().toLowerCase())
    const visibleCommits = computed(() =>
        normalizedQuery.value
            ? props.commits.filter(commit =>
                  `${commit.subject} ${commit.author} ${commit.hash} ${commit.refs.join(' ')}`.toLowerCase().includes(normalizedQuery.value)
              )
            : props.commits
    )
    const graphW = computed(() => Math.max((visibleCommits.value.reduce((max, c) => Math.max(max, c.lane), 0) + 1) * laneW.value + 20, 64))
    const rowIndex = computed(() => new Map(visibleCommits.value.map((commit, index) => [commit.hash as string, index])))
    const totalHeight = computed(() => visibleCommits.value.length * rowH.value)
    const renderedCommits = computed(() => visibleCommits.value.slice(visibleRange.value[0], visibleRange.value[1]))

    function onScroll() {
        const el = scrollEl.value
        if (!el) return
        const start = Math.max(0, Math.floor(el.scrollTop / rowH.value) - 15)
        const count = Math.ceil(el.clientHeight / rowH.value) + 30
        visibleRange.value = [start, start + count]
        if (props.hasMore && el.scrollTop + el.clientHeight >= el.scrollHeight - rowH.value * 10) emit('load-more')
    }
    function onWheel(event: WheelEvent) {
        if (event.ctrlKey || event.metaKey) {
            event.preventDefault()
            zoom.value = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom.value - event.deltaY * 0.002))
        }
    }

    function openMenu(commit: CommitNode, event: MouseEvent) {
        select(commit)
        menu.value = { x: event.clientX, y: event.clientY, items: props.buildCommitMenu(commit) }
    }

    function select(commit: CommitNode) {
        selectedHash.value = commit.hash
        emit('select-commit', commit)
    }

    function nodeColor(commit: CommitNode) {
        return COLORS[commit.lane % COLORS.length]
    }
    function nodeX(commit: CommitNode) {
        return commit.lane * laneW.value + laneW.value / 2
    }
    function nodeY(index: number) {
        return index * rowH.value + rowH.value / 2
    }
    function formatDate(iso: string): string {
        const date = new Date(iso)
        if (Number.isNaN(date.getTime())) return iso
        return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    }
</script>

<template>
    <main class="graph-view">
        <div class="graph-toolbar">
            <div class="graph-title">
                <i-lucide-git-commit-horizontal
                    width="17"
                    height="17" />
                <strong>Commit history</strong>
                <span>{{ normalizedQuery ? `${visibleCommits.length} of ${commits.length}` : commits.length }} commits</span>
            </div>
            <div class="spacer" />
            <div class="zoom-controls">
                <button
                    class="icon-btn"
                    title="Zoom out"
                    @click="zoom = Math.max(ZOOM_MIN, zoom - 0.1)">
                    <i-lucide-minus
                        width="14"
                        height="14" />
                </button>
                <button
                    class="icon-btn zoom-reset"
                    title="Reset zoom"
                    @click="zoom = 1">
                    {{ Math.round(zoom * 100) }}%
                </button>
                <button
                    class="icon-btn"
                    title="Zoom in"
                    @click="zoom = Math.min(ZOOM_MAX, zoom + 0.1)">
                    <i-lucide-plus
                        width="14"
                        height="14" />
                </button>
            </div>
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
            @scroll.passive="onScroll"
            @wheel="onWheel">
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
                            :cx="nodeX(commit)"
                            :cy="nodeY(index)"
                            r="10"
                            fill="none"
                            :stroke="dropTargetHash === commit.hash ? 'var(--teal)' : 'var(--text)'"
                            stroke-width="1.5"
                            opacity="0.9" />
                        <circle
                            :cx="nodeX(commit)"
                            :cy="nodeY(index)"
                            :r="selectedHash === commit.hash ? Math.round(5.5 * zoom) : Math.round(4.5 * zoom)"
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
                    :class="{ selected: selectedHash === commit.hash, 'drop-target': dropTargetHash === commit.hash }"
                    :style="{ height: `${rowH}px` }"
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
                    <span
                        class="commit-subject"
                        :style="{ fontSize: `${Math.round(13 * zoom)}px` }">
                        <span class="subject-text">{{ commit.subject }}</span>
                        <span
                            v-for="ref in commit.refs"
                            :key="ref"
                            class="ref-chip"
                            :class="{ head: ref.startsWith('HEAD'), tag: ref.startsWith('tag:') }">
                            {{ ref.replace('HEAD -> ', '') }}
                        </span>
                    </span>
                    <span class="commit-author">{{ commit.author }}</span>
                    <span class="commit-date">{{ formatDate(commit.date) }}</span>
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
