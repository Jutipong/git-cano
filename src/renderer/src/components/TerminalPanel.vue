<script setup lang="ts">
    import { computed, nextTick, ref, watch } from 'vue'
    import ILucideChevronDown from '~icons/lucide/chevron-down'
    import ILucideMaximize from '~icons/lucide/maximize'
    import ILucideMinimize from '~icons/lucide/minimize'
    import ILucidePlus from '~icons/lucide/plus'

    import { useTerminalStore } from '../stores/terminal'
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
    const atCap = computed(() => tabs.value.length >= terminalStore.maxPerRepo)

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

    /**
     * The whole pill is the click target, like the repo tabs — the label is a plain span and the ✕ stops its own clicks,
     * so a press anywhere on the tab switches shells instead of only landing on the text. Guarded while THIS tab is
     * being renamed: `activate` below would pull the caret back out of the inline rename input.
     */
    function onTabClick(id: string) {
        if (renamingId.value === id) return
        activate(id)
    }

    /** Arrow keys move between pills without stealing the keyboard from the strip into the shell. */
    let keyboardTabNav = false
    function onTabKeydown(event: KeyboardEvent, id: string) {
        if (renamingId.value === id) return
        const list = tabs.value
        const index = list.findIndex(tab => tab.id === id)
        if (index < 0) return
        let next = index
        if (event.key === 'ArrowLeft') next = (index - 1 + list.length) % list.length
        else if (event.key === 'ArrowRight') next = (index + 1) % list.length
        else if (event.key === 'Home') next = 0
        else if (event.key === 'End') next = list.length - 1
        else if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            activate(id)
            return
        } else return
        event.preventDefault()
        keyboardTabNav = true
        activate(list[next].id)
        void nextTick(() => tabEls.value[list[next].id]?.focus())
    }

    /** Double-click anywhere on the pill starts a rename; the guard keeps the input's own word-select from restarting it. */
    function onTabDblClick(id: string) {
        if (renamingId.value === id) return
        startRename(id)
    }

    const views = ref<Record<string, { focus: () => void } | null>>({})
    /** Tab pills by id — the strip scrolls once the tabs overflow it, so the active one has to follow. */
    const tabEls = ref<Record<string, HTMLElement | null>>({})

    // The active tab can also change without a click (closing the showing tab hands over to its
    // neighbour, Ctrl+Tab cycles) — keep the keyboard on whatever is on screen and its pill in view.
    watch(activeId, id => {
        if (!id) return
        const keepOnStrip = keyboardTabNav
        keyboardTabNav = false
        void nextTick(() => {
            if (!keepOnStrip) views.value[id]?.focus()
            tabEls.value[id]?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
        })
    })

    /**
     * Called when the panel is shown again (Ctrl+` / palette / toolbar) — hidden panels are `display: none`, which blurs the xterm
     * textarea, so the keyboard has to come back explicitly.
     */
    function focusActive() {
        const id = activeId.value
        if (id) views.value[id]?.focus()
    }

    /** Double-click a tab label to rename it; Enter/blur confirms, Esc restores the derived name. */
    const renamingId = ref<string | null>(null)
    const renameValue = ref('')
    // A ref inside v-for is collected as an array (ref_for), so the input is addressed per tab id —
    // same keyed function-ref pattern as `views` below.
    const renameInputs = ref<Record<string, HTMLInputElement | null>>({})

    function startRename(id: string) {
        renamingId.value = id
        renameValue.value = tabLabel(id)
        void nextTick(() => {
            const input = renameInputs.value[id]
            input?.focus()
            input?.select()
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

    defineExpose({ focusActive })
</script>

<template>
    <section
        class="terminal-panel"
        aria-label="Terminal">
        <header class="terminal-header">
            <span
                class="terminal-tabs"
                role="tablist"
                aria-label="Terminal tabs">
                <span
                    v-for="tab in tabs"
                    :key="tab.id"
                    :ref="el => (tabEls[tab.id] = el as HTMLElement | null)"
                    class="terminal-tab"
                    :class="{ active: tab.id === activeId, dragging: tab.id === draggingId }"
                    :title="`${tabLabel(tab.id)} — double-click to rename`"
                    role="tab"
                    :aria-selected="tab.id === activeId"
                    :tabindex="tab.id === activeId ? 0 : -1"
                    :draggable="renamingId !== tab.id"
                    @dragstart="onDragStart(tab.id, $event)"
                    @dragover="onDragOver(tabs.indexOf(tab), $event)"
                    @dragend="onDragEnd"
                    @click="onTabClick(tab.id)"
                    @dblclick="onTabDblClick(tab.id)"
                    @keydown="onTabKeydown($event, tab.id)">
                    <input
                        v-if="renamingId === tab.id"
                        :ref="el => (renameInputs[tab.id] = el as HTMLInputElement | null)"
                        v-model="renameValue"
                        class="terminal-tab-rename"
                        type="text"
                        maxlength="40"
                        @keydown.enter.prevent="commitRename"
                        @keydown.esc.prevent="cancelRename"
                        @blur="commitRename" />
                    <span
                        v-else
                        class="terminal-tab-label">
                        {{ tabLabel(tab.id) }}
                    </span>
                    <button
                        class="terminal-tab-close"
                        tabindex="-1"
                        :title="`Close ${tabLabel(tab.id)}`"
                        :aria-label="`Close ${tabLabel(tab.id)}`"
                        @click.stop="emit('close-tab', tab.id)"
                        @dblclick.stop>
                        <CloseXIcon />
                    </button>
                </span>
                <button
                    class="terminal-tab-add"
                    :title="atCap ? `Maximum ${terminalStore.maxPerRepo} terminals per repo` : 'New terminal'"
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
                        class="icon-btn terminal-hide-btn"
                        title="Hide panel (shells keep running)"
                        @click="emit('hide')">
                        <i-lucide-chevron-down
                            width="15"
                            height="15" />
                    </button>
                    <button
                        class="icon-btn"
                        :class="{ active: expanded }"
                        :title="expanded ? 'Exit full height (Alt+Enter)' : 'Full height (Alt+Enter)'"
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
