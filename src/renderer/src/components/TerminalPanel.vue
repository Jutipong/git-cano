<script setup lang="ts">
    import { computed, nextTick, ref, watch } from 'vue'
    import ILucideChevronDown from '~icons/lucide/chevron-down'
    import ILucideMaximize from '~icons/lucide/maximize'
    import ILucideMinimize from '~icons/lucide/minimize'
    import ILucidePlus from '~icons/lucide/plus'

    import { useTerminalStore, MAX_TERMINALS_PER_REPO } from '../stores/terminal'
    import { useUiStore, TERMINAL_FONT_SIZE_OPTIONS } from '../stores/ui'
    import CloseXIcon from './CloseXIcon.vue'
    import TerminalView from './TerminalView.vue'

    const props = defineProps<{
        /** Repo path whose shells this panel shows — pinned so a mid-flight tab switch can't retarget it. */
        repoPath: string
        /** True while the panel fills the app as an overlay below the repo tab bar (graph hidden). */
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
        (e: 'hide'): void
    }>()

    const terminalStore = useTerminalStore()
    const ui = useUiStore()

    const tabs = computed(() => terminalStore.repoTerminals(props.repoPath)?.tabs ?? [])
    const activeId = computed(() => terminalStore.repoTerminals(props.repoPath)?.activeId ?? null)
    const atCap = computed(() => tabs.value.length >= MAX_TERMINALS_PER_REPO)

    /** Header A− / A+ step through TERMINAL_FONT_SIZE_OPTIONS; disable whichever end is exhausted. */
    const fontStep = computed(() => {
        const idx = TERMINAL_FONT_SIZE_OPTIONS.indexOf(ui.terminalFontSize)
        return {
            shrink: idx <= 0,
            grow: idx < 0 || idx >= TERMINAL_FONT_SIZE_OPTIONS.length - 1,
            title: `Terminal text — ${ui.terminalFontSize}px`,
        }
    })

    function tabLabel(id: string): string {
        return terminalStore.tabLabel(props.repoPath, id)
    }

    /** Clicking a tab shows that shell and hands it the keyboard — a shell you can't type into is useless. */
    function activate(id: string) {
        terminalStore.setActiveTerminal(props.repoPath, id)
        void nextTick(() => views.value[id]?.focus())
    }

    const views = ref<Record<string, { focus: () => void } | null>>({})

    // The active tab can also change without a click (closing the showing tab hands over to its
    // neighbour) — keep the keyboard on whatever is on screen.
    watch(activeId, id => {
        if (id) void nextTick(() => views.value[id]?.focus())
    })

    /** Double-click a tab label to rename it; Enter/blur confirms, Esc restores the derived name. */
    const renamingId = ref<string | null>(null)
    const renameValue = ref('')
    const renameInput = ref<HTMLInputElement | null>(null)

    function startRename(id: string) {
        renamingId.value = id
        renameValue.value = tabLabel(id)
        void nextTick(() => {
            renameInput.value?.focus()
            renameInput.value?.select()
        })
    }

    function commitRename() {
        const id = renamingId.value
        if (!id) return
        terminalStore.renameTerminalTab(props.repoPath, id, renameValue.value)
        cancelRename()
    }

    function cancelRename() {
        renamingId.value = null
        renameValue.value = ''
    }

    /** Drag tabs like the repo tabs — the id (and its live shell) travels with the tab. */
    const draggingId = ref<string | null>(null)

    function onDragStart(id: string, event: DragEvent) {
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
        const from = tabs.value.findIndex(tab => tab.id === fromId)
        if (from < 0) return
        const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
        const side = event.clientX < rect.left + rect.width / 2 ? 'before' : 'after'
        const insertion = side === 'before' ? index : index + 1
        const to = insertion - (from < insertion ? 1 : 0)
        if (to !== from && to >= 0 && to < tabs.value.length) terminalStore.reorderTerminals(props.repoPath, from, to)
    }

    function onDragEnd() {
        draggingId.value = null
    }
</script>

<template>
    <section class="terminal-panel">
        <header class="terminal-header">
            <span class="terminal-tabs">
                <span
                    v-for="tab in tabs"
                    :key="tab.id"
                    class="terminal-tab"
                    :class="{ active: tab.id === activeId, dragging: tab.id === draggingId }"
                    :draggable="renamingId !== tab.id"
                    @dragstart="onDragStart(tab.id, $event)"
                    @dragover="onDragOver(tabs.indexOf(tab), $event)"
                    @dragend="onDragEnd">
                    <input
                        v-if="renamingId === tab.id"
                        ref="renameInput"
                        v-model="renameValue"
                        class="terminal-tab-rename"
                        type="text"
                        maxlength="40"
                        @keydown.enter.prevent="commitRename"
                        @keydown.esc.prevent="cancelRename"
                        @blur="commitRename" />
                    <button
                        v-else
                        class="terminal-tab-label"
                        :title="`${tabLabel(tab.id)} — double-click to rename`"
                        @click="activate(tab.id)"
                        @dblclick="startRename(tab.id)">
                        {{ tabLabel(tab.id) }}
                    </button>
                    <button
                        class="terminal-tab-close"
                        :title="`Close ${tabLabel(tab.id)}`"
                        @click.stop="emit('close-tab', tab.id)">
                        <CloseXIcon />
                    </button>
                </span>
                <button
                    class="terminal-tab-add"
                    :title="atCap ? `Maximum ${MAX_TERMINALS_PER_REPO} terminals per repo` : 'New terminal'"
                    :disabled="atCap"
                    @click="emit('add-tab')">
                    <i-lucide-plus
                        width="15"
                        height="15" />
                </button>
            </span>
            <span class="terminal-actions">
                <!-- Two diff-view style pills: the font stepper and the panel controls stay separate. -->
                <span class="segmented">
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
                </span>
                <span class="segmented diff-header-actions">
                    <button
                        class="icon-btn"
                        title="Hide panel (shells keep running)"
                        @click="emit('hide')">
                        <i-lucide-chevron-down
                            width="15"
                            height="15" />
                    </button>
                    <button
                        class="icon-btn"
                        :class="{ active: expanded }"
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
                        class="icon-btn danger diff-close-btn"
                        :title="tabs.length > 1 ? `Close all ${tabs.length} terminals` : 'Close terminal'"
                        @click="emit('close')">
                        <CloseXIcon />
                    </button>
                </span>
            </span>
        </header>
        <div class="terminal-views">
            <TerminalView
                v-for="tab in tabs"
                :key="tab.id"
                v-show="tab.id === activeId"
                :ref="el => (views[tab.id] = el as { focus: () => void } | null)"
                :repo-path="repoPath"
                :terminal-id="tab.id"
                :visible="visible && tab.id === activeId"
                @exit="emit('exit', tab.id)" />
        </div>
    </section>
</template>
