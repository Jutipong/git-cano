<script setup lang="ts">
    import { computed, nextTick, onMounted, ref, watch } from 'vue'
    import ILucideMaximize from '~icons/lucide/maximize'
    import ILucideMinimize from '~icons/lucide/minimize'
    import ILucidePlus from '~icons/lucide/plus'

    import { useRepoStore, MAX_TERMINALS_PER_REPO } from '../stores/repo'
    import { useUiStore, TERMINAL_FONT_SIZE_OPTIONS } from '../stores/ui'
    import CloseXIcon from './CloseXIcon.vue'
    import TerminalTabContextMenu, { type TerminalTabMenuState } from './TerminalTabContextMenu.vue'
    import TerminalView from './TerminalView.vue'

    const props = defineProps<{
        /** Repo path whose shells this panel shows — pinned so a mid-flight tab switch can't retarget it. */
        repoPath: string
        /** True while the panel fills the center column (graph hidden). */
        expanded: boolean
        /** True while this repo's tab is active AND the panel isn't toggled away (other panels stay mounted). */
        visible: boolean
    }>()

    const emit = defineEmits<{
        (e: 'close'): void
        (e: 'add-tab'): void
        (e: 'close-tab', id: string): void
        (e: 'exit', id: string): void
        (e: 'toggle-expand'): void
    }>()

    const repoStore = useRepoStore()
    const ui = useUiStore()

    const terminalState = computed(() => repoStore.repoTerminals(props.repoPath))
    const terminalIds = computed(() => terminalState.value?.ids ?? [])
    const activeId = computed(() => terminalState.value?.activeId ?? null)
    const atCap = computed(() => terminalIds.value.length >= MAX_TERMINALS_PER_REPO)

    /** Shell name for the tab labels ("1 zsh") — one cheap IPC per panel, shared by all its tabs. */
    const shellName = ref('shell')
    onMounted(async () => {
        shellName.value = await window.api.terminalShell().catch(() => 'shell')
    })

    /** Header A− / A+ step through TERMINAL_FONT_SIZE_OPTIONS; disable whichever end is exhausted. */
    const fontStep = computed(() => {
        const idx = TERMINAL_FONT_SIZE_OPTIONS.indexOf(ui.terminalFontSize)
        return {
            shrink: idx <= 0,
            grow: idx < 0 || idx >= TERMINAL_FONT_SIZE_OPTIONS.length - 1,
            title: `Terminal text — ${ui.terminalFontSize}px`,
        }
    })

    /** 1-based tab number: a tab's position in the repo's id list. */
    function tabNumber(id: string): number {
        return terminalIds.value.indexOf(id) + 1
    }

    /** A renamed tab shows just its name; an unnamed one keeps the positional "<n> <shell>" label. */
    function tabLabel(id: string): string {
        return terminalState.value?.names[id] || `${tabNumber(id)} ${shellName.value}`
    }

    /** The tooltip keeps the number and the real shell even when the label is a custom name. */
    function tabTitle(id: string): string {
        const shell = shellName.value
        const name = terminalState.value?.names[id]
        return name ? `Terminal ${tabNumber(id)} — ${shell} — ${name}` : `Terminal ${tabNumber(id)} — ${shell}`
    }

    const views = ref<Record<string, { focus: () => void } | null>>({})

    /** Clicking a tab shows that shell and hands it the keyboard — a shell you can't type into is useless. */
    function activate(id: string) {
        repoStore.setActiveTerminal(props.repoPath, id)
        void nextTick(() => views.value[id]?.focus())
    }

    // The active tab can also change without a click (closing the showing tab hands over to its
    // neighbour) — keep the keyboard on whatever is on screen.
    watch(activeId, id => {
        if (id) void nextTick(() => views.value[id]?.focus())
    })

    // ── Rename (right-click → Rename…, or double-click the label) ────────────────────────────────
    const renamingId = ref<string | null>(null)
    const renameValue = ref('')
    const renameInput = ref<HTMLInputElement | null>(null)

    function startRename(id: string) {
        renamingId.value = id
        renameValue.value = terminalState.value?.names[id] ?? ''
        void nextTick(() => {
            renameInput.value?.focus()
            renameInput.value?.select()
        })
    }

    function commitRename() {
        const id = renamingId.value
        if (!id) return
        repoStore.renameTerminal(props.repoPath, id, renameValue.value)
        renamingId.value = null
        renameValue.value = ''
    }

    function cancelRename() {
        renamingId.value = null
        renameValue.value = ''
    }

    // ── Right-click menu ─────────────────────────────────────────────────────────────────────────
    const tabMenu = ref<TerminalTabMenuState | null>(null)

    function openTabMenu(id: string, event: MouseEvent) {
        cancelRename()
        tabMenu.value = {
            x: event.clientX,
            y: event.clientY,
            id,
            number: tabNumber(id),
            name: terminalState.value?.names[id] ?? '',
            shell: shellName.value,
            many: terminalIds.value.length > 1,
        }
    }

    // A tab that disappears mid-rename (✕, self-exit) must not leave the input hanging around; the
    // menu goes with it too so its actions can't target a dead id.
    watch(terminalIds, ids => {
        if (renamingId.value && !ids.includes(renamingId.value)) cancelRename()
        if (tabMenu.value && !ids.includes(tabMenu.value.id)) tabMenu.value = null
    })

    // ── Drag to reorder (same mechanics as the repo tab bar) ────────────────────────────────────
    const draggingId = ref<string | null>(null)

    function onDragStart(id: string, event: DragEvent) {
        if (renamingId.value) {
            event.preventDefault()
            return
        }
        draggingId.value = id
        if (event.dataTransfer) {
            event.dataTransfer.effectAllowed = 'move'
            event.dataTransfer.setData('text/plain', id)
        }
    }

    function onDragOver(index: number, event: DragEvent) {
        event.preventDefault()
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
        const fromId = draggingId.value
        if (!fromId || renamingId.value) return
        const from = terminalIds.value.indexOf(fromId)
        if (from < 0) return
        const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
        const side = event.clientX < rect.left + rect.width / 2 ? 'before' : 'after'
        const insertion = side === 'before' ? index : index + 1
        const to = insertion - (from < insertion ? 1 : 0)
        if (to !== from && to >= 0 && to < terminalIds.value.length) repoStore.reorderTerminals(props.repoPath, from, to)
    }

    function onDrop(event: DragEvent) {
        event.preventDefault()
        draggingId.value = null
    }

    function onDragEnd() {
        draggingId.value = null
    }
</script>

<template>
    <section class="terminal-panel">
        <header class="terminal-header">
            <span class="terminal-tabs">
                <TransitionGroup
                    name="tab"
                    tag="span"
                    class="terminal-tab-track">
                    <span
                        v-for="(id, index) in terminalIds"
                        :key="id"
                        class="terminal-tab"
                        :class="{ active: id === activeId, dragging: id === draggingId }"
                        :draggable="!renamingId"
                        @dragstart="onDragStart(id, $event)"
                        @dragover="onDragOver(index, $event)"
                        @drop="onDrop($event)"
                        @dragend="onDragEnd"
                        @contextmenu.prevent.stop="openTabMenu(id, $event)">
                        <input
                            v-if="renamingId === id"
                            :ref="el => (renameInput = el as HTMLInputElement | null)"
                            v-model="renameValue"
                            class="terminal-tab-input"
                            type="text"
                            placeholder="Tab name"
                            @keydown.enter.prevent="commitRename()"
                            @keydown.esc.stop.prevent="cancelRename()"
                            @blur="cancelRename()" />
                        <button
                            v-else
                            class="terminal-tab-label"
                            :title="tabTitle(id)"
                            @click="activate(id)"
                            @dblclick="startRename(id)">
                            {{ tabLabel(id) }}
                        </button>
                        <button
                            class="terminal-tab-close"
                            :title="`Close terminal ${tabNumber(id)}`"
                            @click="emit('close-tab', id)">
                            <CloseXIcon />
                        </button>
                    </span>
                </TransitionGroup>
                <button
                    class="terminal-tab-add"
                    :title="atCap ? `Maximum ${MAX_TERMINALS_PER_REPO} terminals per repo` : 'New terminal'"
                    :disabled="atCap"
                    @click="emit('add-tab')">
                    <i-lucide-plus
                        width="14"
                        height="14" />
                </button>
                <TerminalTabContextMenu
                    :menu="tabMenu"
                    @close="tabMenu = null"
                    @rename="startRename"
                    @reset-name="id => repoStore.renameTerminal(repoPath, id, '')"
                    @close-tab="id => emit('close-tab', id)"
                    @close-all="emit('close')" />
            </span>
            <span class="terminal-actions">
                <button
                    class="icon-btn terminal-font-btn"
                    :title="fontStep.title"
                    :disabled="fontStep.shrink"
                    @click="ui.stepTerminalFontSize(-1)">
                    A−
                </button>
                <button
                    class="icon-btn terminal-font-btn"
                    :title="fontStep.title"
                    :disabled="fontStep.grow"
                    @click="ui.stepTerminalFontSize(1)">
                    A+
                </button>
                <button
                    class="icon-btn"
                    :title="expanded ? 'Exit full height' : 'Full height'"
                    @click="emit('toggle-expand')">
                    <i-lucide-minimize
                        v-if="expanded"
                        width="15"
                        height="15" />
                    <i-lucide-maximize
                        v-else
                        width="15"
                        height="15" />
                </button>
                <button
                    class="icon-btn danger commit-close-btn"
                    :title="terminalIds.length > 1 ? `Close all ${terminalIds.length} terminals` : 'Close terminal'"
                    @click="emit('close')">
                    <CloseXIcon />
                </button>
            </span>
        </header>
        <div class="terminal-views">
            <TerminalView
                v-for="id in terminalIds"
                :key="id"
                v-show="id === activeId"
                :ref="el => (views[id] = el as { focus: () => void } | null)"
                :repo-path="repoPath"
                :terminal-id="id"
                :visible="visible && id === activeId"
                @exit="emit('exit', id)" />
        </div>
    </section>
</template>
