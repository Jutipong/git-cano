<script setup lang="ts">
    import { computed, nextTick, onMounted, ref, watch } from 'vue'
    import ILucideMaximize from '~icons/lucide/maximize'
    import ILucideMinimize from '~icons/lucide/minimize'
    import ILucidePlus from '~icons/lucide/plus'

    import { useRepoStore, MAX_TERMINALS_PER_REPO } from '../stores/repo'
    import { useUiStore, TERMINAL_FONT_SIZE_OPTIONS } from '../stores/ui'
    import CloseXIcon from './CloseXIcon.vue'
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

    /** Shell name for the tab labels ("1 zsh") — one cheap IPC per panel, shared by all its tabs. */
    const shellName = ref('shell')
    onMounted(async () => {
        shellName.value = await window.api.terminalShell().catch(() => 'shell')
    })

    const terminalIds = computed(() => repoStore.repoTerminals(props.repoPath)?.ids ?? [])
    const activeId = computed(() => repoStore.repoTerminals(props.repoPath)?.activeId ?? null)
    const atCap = computed(() => terminalIds.value.length >= MAX_TERMINALS_PER_REPO)

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
</script>

<template>
    <section class="terminal-panel">
        <header class="terminal-header">
            <span class="terminal-tabs">
                <span
                    v-for="id in terminalIds"
                    :key="id"
                    class="terminal-tab"
                    :class="{ active: id === activeId }">
                    <button
                        class="terminal-tab-label"
                        :title="`Terminal ${tabNumber(id)} — ${shellName}`"
                        @click="activate(id)">
                        {{ tabNumber(id) }} {{ shellName }}
                    </button>
                    <button
                        class="terminal-tab-close"
                        :title="`Close terminal ${tabNumber(id)}`"
                        @click="emit('close-tab', id)">
                        <CloseXIcon />
                    </button>
                </span>
                <button
                    class="terminal-tab-add"
                    :title="atCap ? `Maximum ${MAX_TERMINALS_PER_REPO} terminals per repo` : 'New terminal'"
                    :disabled="atCap"
                    @click="emit('add-tab')">
                    <i-lucide-plus
                        width="14"
                        height="14" />
                </button>
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
