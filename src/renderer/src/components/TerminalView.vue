<script setup lang="ts">
    import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
    import ILucideTriangleAlert from '~icons/lucide/triangle-alert'

    import { useUiStore, TERMINAL_FONT_OPTIONS } from '../stores/ui'

    import '@xterm/xterm/css/xterm.css'

    import type { TerminalData, TerminalExit } from '@shared/types'
    import type { Terminal } from '@xterm/xterm'
    import type { FitAddon } from '@xterm/addon-fit'

    const props = defineProps<{
        /** Repo path whose shell this view shows — pinned so a mid-flight tab switch can't retarget it. */
        repoPath: string
        /** Identity of this shell (the pty key); the main process tags every chunk with it. */
        terminalId: string
        /** True while this terminal is the one the panel shows (siblings stay mounted but hidden). */
        visible: boolean
    }>()

    const emit = defineEmits<{ (e: 'exit'): void }>()

    const ui = useUiStore()

    const host = ref<HTMLElement | null>(null)
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
        // A hidden view (a sibling tab is showing, or the whole panel is toggled away) has no box —
        // fitting it would report 0 cols/rows.
        if (!host.value || host.value.clientWidth === 0 || host.value.clientHeight === 0) return
        try {
            fit.fit()
        } catch {
            return
        }
        void window.api.terminalResize(props.terminalId, term.cols, term.rows).catch(() => {})
    }

    /**
     * The terminal's own font stack: a preset (which may carry its own stack, e.g. the two Nerd Fonts
     * family names), a custom family typed in Settings, or the app's `--font-mono` for the default.
     * The app stack is always appended, so a font that is not installed falls back to the app default
     * instead of a generic `monospace`. xterm feeds this straight into the canvas font shorthand, so
     * multi-word family names have to be quoted.
     */
    function terminalFontFamily() {
        const appMono = getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim() || 'monospace'
        const chosen = ui.terminalFontFamily.trim()
        if (!chosen) return appMono
        const preset = TERMINAL_FONT_OPTIONS.find(option => option.value && option.value === chosen)
        return `${preset?.stack ?? `"${chosen}"`}, ${appMono}`
    }

    async function setup() {
        if (!host.value || term) return
        // Loaded lazily so the terminal chunk (xterm) only ships when a panel actually opens.
        const [{ Terminal }, { FitAddon }] = await Promise.all([import('@xterm/xterm'), import('@xterm/addon-fit')])
        if (disposed) return

        const colors = themeColors()
        term = new Terminal({
            convertEol: true,
            cursorBlink: true,
            fontFamily: terminalFontFamily(),
            fontSize: ui.terminalFontPx,
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
        term.onData(data => void window.api.terminalWrite(props.terminalId, data).catch(() => {}))
        resizePty()

        // Stream output only for this shell — the main process tags every chunk with its id, and
        // every mounted view of every repo sees the traffic (a string compare per chunk).
        dataDisposer = window.api.onTerminalData((payload: TerminalData) => {
            if (payload.terminalId !== props.terminalId || !term) return
            term.write(payload.data)
        })
        exitDisposer = window.api.onTerminalExit((payload: TerminalExit) => {
            if (payload.terminalId !== props.terminalId || !term) return
            // The shell ended on its own (exit / Ctrl+D / crash) — the panel drops just this tab
            // exactly like a manual close, so it simply disappears. No confirm and no toast: there is
            // nothing left to end.
            emit('exit')
        })

        try {
            await window.api.terminalCreate(props.terminalId, props.repoPath, term.cols, term.rows)
            // The view can unmount while the create call is in flight (tab closed quickly) —
            // touching the disposed terminal after the await would throw.
            if (disposed || !term) return
            term.focus()
        } catch (error) {
            if (disposed) return
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
        // A hidden view reports no box, so refit explicitly when it becomes the showing tab again.
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
        // The terminal's font is its own setting, decoupled from the UI font size — apply it live to
        // every open view and re-solve the grid. xterm re-measures the cell box on the next task
        // (debounced CharSizeService.measure), so the refit must wait a frame: fitting immediately
        // would compute cols/rows from the stale cell size. A hidden view has no box, so resizePty()
        // no-ops and the `visible` watcher refits when it is shown again.
        watch(
            () => [ui.terminalFontFamily, ui.terminalFontSize, ui.fontSize] as const,
            () => {
                if (!term) return
                term.options.fontFamily = terminalFontFamily()
                term.options.fontSize = ui.terminalFontPx
                requestAnimationFrame(() => resizePty())
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
        // the store's close actions. A workspace switch keeps it alive on purpose (the panel stays
        // mounted, parked, until the repo is a tab again), and unmounting happens transiently while
        // `tabs` is rebuilt mid-switch.
        term?.dispose()
        term = null
        fit = null
    })

    /** Called by the panel when its tab is clicked — a shell you can't type into is useless. */
    function focus() {
        term?.focus()
    }

    defineExpose({ focus })
</script>

<template>
    <div class="terminal-view">
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
    </div>
</template>
