<script setup lang="ts">
    import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
    import ILucideMaximize from '~icons/lucide/maximize'
    import ILucideMinimize from '~icons/lucide/minimize'
    import ILucideTerminal from '~icons/lucide/terminal'
    import ILucideTriangleAlert from '~icons/lucide/triangle-alert'

    import { useUiStore } from '../stores/ui'
    import CloseXIcon from './CloseXIcon.vue'

    import '@xterm/xterm/css/xterm.css'

    import type { TerminalData, TerminalExit } from '@shared/types'
    import type { Terminal } from '@xterm/xterm'
    import type { FitAddon } from '@xterm/addon-fit'

    const props = defineProps<{
        /** Repo path whose shell this panel shows — pinned so a mid-flight tab switch can't retarget it. */
        repoPath: string
        /** True while the panel fills the center column (graph hidden). */
        expanded: boolean
        /** True while this repo's tab is active (other panels stay mounted but hidden). */
        visible: boolean
    }>()

    const emit = defineEmits<{ (e: 'close'): void; (e: 'toggle-expand'): void; (e: 'exit'): void }>()

    const ui = useUiStore()

    const host = ref<HTMLElement | null>(null)
    const shellName = ref('shell')
    const failed = ref<string | null>(null)

    let term: Terminal | null = null
    let fit: FitAddon | null = null
    let resizeObserver: ResizeObserver | null = null
    let dataDisposer: (() => void) | null = null
    let exitDisposer: (() => void) | null = null
    let disposed = false

    /** Reads the app's live theme tokens so xterm matches whichever theme is active. */
    function themeColors() {
        const styles = getComputedStyle(document.documentElement)
        const read = (name: string, fallback: string) => styles.getPropertyValue(name).trim() || fallback
        return {
            background: read('--canvas', '#101014'),
            foreground: read('--text', '#e8e8f0'),
            cursor: read('--teal', '#29a8ff'),
            selectionBackground: read('--surface-hover', '#2d2d40'),
        }
    }

    function resizePty() {
        if (!term || !fit) return
        // A hidden panel (another repo's tab is active) has no box — fitting it would report 0 cols/rows.
        if (!host.value || host.value.clientWidth === 0 || host.value.clientHeight === 0) return
        try {
            fit.fit()
        } catch {
            return
        }
        void window.api.terminalResize(props.repoPath, term.cols, term.rows).catch(() => {})
    }

    async function setup() {
        if (!host.value || term) return
        // Loaded lazily so the terminal chunk (xterm) only ships when the panel actually opens.
        const [{ Terminal }, { FitAddon }] = await Promise.all([import('@xterm/xterm'), import('@xterm/addon-fit')])
        if (disposed) return

        const colors = themeColors()
        term = new Terminal({
            convertEol: true,
            cursorBlink: true,
            fontFamily: getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim() || 'monospace',
            fontSize: 13,
            scrollback: 1000,
            theme: {
                background: colors.background,
                foreground: colors.foreground,
                cursor: colors.cursor,
                selectionBackground: colors.selectionBackground,
            },
        })
        fit = new FitAddon()
        term.loadAddon(fit)
        term.open(host.value)
        term.onData(data => void window.api.terminalWrite(props.repoPath, data).catch(() => {}))
        resizePty()

        // Stream output only for this repo — the main process tags every chunk with its path.
        dataDisposer = window.api.onTerminalData((payload: TerminalData) => {
            if (payload.repoPath !== props.repoPath || !term) return
            term.write(payload.data)
        })
        exitDisposer = window.api.onTerminalExit((payload: TerminalExit) => {
            if (payload.repoPath !== props.repoPath || !term) return
            // The shell ended on its own (exit / Ctrl+D / crash) — close the panel exactly like a
            // manual close so it simply disappears. No confirm and no toast: there is nothing left to end.
            emit('exit')
        })

        try {
            const shell = await window.api.terminalShell().catch(() => 'shell')
            shellName.value = shell
            await window.api.terminalCreate(props.repoPath, term.cols, term.rows)
            term.focus()
        } catch (error) {
            failed.value = String(error).replace(/^Error:\s*/, '')
        }
    }

    onMounted(async () => {
        await nextTick()
        await setup()
        if (host.value) {
            resizeObserver = new ResizeObserver(() => resizePty())
            resizeObserver.observe(host.value)
        }
        // A hidden panel reports no box, so refit explicitly when it becomes the active tab again.
        watch(
            () => props.visible,
            shown => {
                if (shown) nextTick(() => resizePty())
            }
        )
        // Re-tint when the theme changes while the panel is open.
        watch(
            () => ui.theme,
            () => {
                if (term) term.options.theme = { ...term.options.theme, ...themeColors() }
                resizePty()
            }
        )
    })

    onBeforeUnmount(() => {
        disposed = true
        resizeObserver?.disconnect()
        resizeObserver = null
        dataDisposer?.()
        exitDisposer?.()
        dataDisposer = null
        exitDisposer = null
        // The pty is NOT killed here: it is owned by the main process (repo:close, app quit) and by
        // closeTerminal() — which is also what workspace switches call, so no shell ever outlives
        // them. Unmounting additionally happens transiently while `tabs` is rebuilt mid-switch.
        term?.dispose()
        term = null
        fit = null
    })
</script>

<template>
    <section class="terminal-panel">
        <header class="terminal-header">
            <span class="terminal-title">
                <i-lucide-terminal
                    width="13"
                    height="13" />
                TERMINAL
                <span class="terminal-shell">{{ shellName }}</span>
            </span>
            <span class="terminal-actions">
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
                    title="Close terminal"
                    @click="emit('close')">
                    <CloseXIcon />
                </button>
            </span>
        </header>
        <div
            ref="host"
            class="terminal-host" />
        <p
            v-if="failed"
            class="terminal-error">
            <i-lucide-triangle-alert
                width="13"
                height="13" />
            {{ failed }}
        </p>
    </section>
</template>
