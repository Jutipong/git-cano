<script setup lang="ts">
    import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
    import ILucideTriangleAlert from '~icons/lucide/triangle-alert'

    import { useUiStore, DEFAULT_TERMINAL_FONT_FAMILY } from '../stores/ui'
    import { primaryFontFamily, resolveTerminalFontFamily } from '../utils/terminalFont'

    import '@xterm/xterm/css/xterm.css'

    import type { TerminalData, TerminalExit } from '@shared/types'
    import type { IDisposable, Terminal } from '@xterm/xterm'
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
    /** False until the shell produces its first chunk — drives the "Starting shell…" hint. */
    const started = ref(false)

    /**
     * A fresh pty emits escape sequences (window title, cursor/mode setup) within milliseconds, long
     * before the shell has drawn anything — the bundled conpty.dll can then hold the actual screen
     * for seconds. Only real text counts as "the shell is up", or the hint would blink away instantly.
     */
    function hasVisibleText(data: string): boolean {
        // Built from char codes so no control character ever appears in this source file.
        const esc = String.fromCharCode(27)
        const bel = String.fromCharCode(7)
        const osc = new RegExp(`${esc}\\][^${bel}]*${bel}`, 'g')
        const csi = new RegExp(`${esc}\\[[0-9;?]*[A-Za-z]`, 'g')
        return data.replace(osc, '').replace(csi, '').trim().length > 0
    }

    let term: Terminal | null = null
    let fit: FitAddon | null = null
    let resizeObserver: ResizeObserver | null = null
    let settleTimer: ReturnType<typeof setInterval> | null = null
    let fontRefitSeq = 0
    let dataDisposer: (() => void) | null = null
    let exitDisposer: (() => void) | null = null
    let renderDisposer: IDisposable | null = null
    let disposed = false

    /**
     * The primary family comes from Settings → Terminal (default Consolas, inbox on every
     * Windows); the stack always keeps Leelawadee UI behind it — Thai has no monospace face on
     * Windows, so the browser falls back per codepoint and lets GPOS stack the vowels/tone marks.
     * xterm's DOM renderer writes whole grapheme clusters into one <span>, which is what makes
     * that shaping work — the canvas renderer (removed in xterm 6) never shaped Thai at all.
     * A pick whose font is not installed resolves back to the default stack.
     */
    const family = resolveTerminalFontFamily(ui.terminalFontFamily, DEFAULT_TERMINAL_FONT_FAMILY)

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

    /** Re-fit briefly until the grid settles — covers fallback-font landings and debounced cell measure. */
    function startSettleRefits(durationMs: number) {
        if (settleTimer) clearInterval(settleTimer)
        settleTimer = setInterval(resizePty, 100)
        setTimeout(() => {
            if (settleTimer) clearInterval(settleTimer)
            settleTimer = null
        }, durationMs)
    }

    function nextFrame(): Promise<void> {
        return new Promise(resolve => requestAnimationFrame(() => resolve()))
    }

    /**
     * Re-solve the grid after a font change. xterm re-measures the cell box on a later task
     * (debounced CharSizeService.measure), so fitting immediately reuses the stale cell size and
     * the last row/column clips for some sizes. Wait for the new face, let two frames pass for
     * the re-measure, fit, then burst refits until fallback fonts settle. Refits until cols/rows
     * stop changing so every size in TERMINAL_FONT_SIZE_OPTIONS lands on a full grid.
     */
    async function refitAfterFontChange(seq: number, familyStack: string, size: number) {
        try {
            await document.fonts.load(`${size}px "${primaryFontFamily(familyStack)}"`)
            await document.fonts.ready
        } catch {
            // A load failure just means xterm measures a fallback — still refit below.
        }
        if (disposed || seq !== fontRefitSeq) return
        await nextFrame()
        if (disposed || seq !== fontRefitSeq) return
        await nextFrame()
        if (disposed || seq !== fontRefitSeq || !term || !fit) return
        // Fit until the grid stops moving: fractional cell sizes round differently per size, so a
        // single fit can leave the pty one row/column off and clip x/y.
        resizePty()
        if (settleTimer) clearInterval(settleTimer)
        let lastCols = term.cols
        let lastRows = term.rows
        let stable = 0
        let attempts = 0
        settleTimer = setInterval(() => {
            if (disposed || seq !== fontRefitSeq || !term) {
                if (settleTimer) clearInterval(settleTimer)
                settleTimer = null
                return
            }
            resizePty()
            attempts += 1
            if (term.cols === lastCols && term.rows === lastRows) stable += 1
            else {
                stable = 0
                lastCols = term.cols
                lastRows = term.rows
            }
            if (stable >= 2 || attempts >= 10) {
                if (settleTimer) clearInterval(settleTimer)
                settleTimer = null
            }
        }, 100)
    }

    /**
     * TUIs draw horizontal rules as a run of `▀` half-blocks (opencode's input-box footer). At
     * fractional display scales each glyph's antialiased edge falls a hair short of the cell, so the
     * run shows a faint vertical seam at every boundary. Tag those spans so a solid half-height
     * background of the same colour can sit behind the glyphs (`.terminal-bar` in modern-ui.css) —
     * the antialiasing then blends into the identical colour and the bar reads as one crisp line.
     */
    const BAR_RUN = /^\u2580+$/
    let barFrame = 0
    function markBars() {
        barFrame = 0
        const root = host.value?.querySelector('.xterm-rows')
        if (!root) return
        for (const span of root.querySelectorAll<HTMLElement>('span')) {
            // A cursor span paints its own block — leave it alone so the cursor stays visible.
            const bar = BAR_RUN.test(span.textContent ?? '') && !span.classList.contains('xterm-cursor')
            span.classList.toggle('terminal-bar', bar)
        }
    }
    function scheduleBars() {
        if (barFrame) return
        barFrame = requestAnimationFrame(markBars)
    }

    /**
     * xterm measures the character cell once at construction and caches it. Creating the Terminal
     * before the stylesheets and fallback fonts are ready yields a wrong cell size, and every Thai
     * combining mark then lands off its column.
     */
    async function waitForFonts(family: string) {
        const sheets = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'))
        await Promise.all(
            sheets.map(
                link =>
                    new Promise<void>(resolve => {
                        if (link.sheet) {
                            resolve()
                            return
                        }
                        link.addEventListener('load', () => resolve(), { once: true })
                        link.addEventListener('error', () => resolve(), { once: true })
                    })
            )
        )
        await document.fonts.ready
        // Preload the picked face before xterm measures its cell — otherwise the first measure
        // uses a fallback metric and Thai marks drift off their column until the fonts settle.
        try {
            await document.fonts.load(`14px "${family}"`)
        } catch {
            // Uninstalled faces resolve to the default stack before this point; a load failure
            // here just means xterm measures a fallback — never fatal.
        }
    }

    async function setup() {
        if (!host.value || term) return

        // The shell is spawned BEFORE xterm is built. Waiting for the xterm chunk and the fallback
        // fonts first kept a fresh terminal blank for over a second (and the bundled ConPTY made it
        // worse), so the shell starts immediately and its first screen is buffered here until xterm
        // can paint it.
        const pending: string[] = []
        // Stream output only for this shell — the main process tags every chunk with its id, and
        // every mounted view of every repo sees the traffic (a string compare per chunk).
        dataDisposer = window.api.onTerminalData((payload: TerminalData) => {
            if (payload.terminalId !== props.terminalId) return
            if (hasVisibleText(payload.data)) started.value = true
            if (term) term.write(payload.data)
            else pending.push(payload.data)
        })
        exitDisposer = window.api.onTerminalExit((payload: TerminalExit) => {
            if (payload.terminalId !== props.terminalId) return
            started.value = true
            // The shell ended on its own (exit / Ctrl+D / crash) — the panel drops just this tab
            // exactly like a manual close, so it simply disappears. No confirm and no toast: there is
            // nothing left to end. The view repaints from `pending` either way.
            emit('exit')
        })
        // 80x24 is only the opening size — the real one arrives with the first fit once xterm exists.
        const spawn = window.api.terminalCreate(props.terminalId, props.repoPath, 80, 24, ui.terminalShell).catch(error => {
            failed.value = String(error).replace(/^Error:\s*/, '')
        })

        await waitForFonts(primaryFontFamily(family))
        if (disposed || !host.value) return
        // Loaded lazily so the terminal chunk (xterm) only ships when a panel actually opens.
        const [{ Terminal }, { FitAddon }, { Unicode11Addon }] = await Promise.all([
            import('@xterm/xterm'),
            import('@xterm/addon-fit'),
            import('@xterm/addon-unicode11'),
        ])
        if (disposed) return

        const colors = themeColors()
        term = new Terminal({
            cursorBlink: true,
            fontFamily: family,
            fontSize: ui.terminalFontSize,
            // Must be exactly 1.0: block-element ASCII art (opencode's logo) fills the em box, and a
            // taller cell leaves a visible gap in the art.
            lineHeight: 1.0,
            scrollback: 1000,
            // xterm 6 moved Unicode11Addon behind the proposed API.
            allowProposedApi: true,
            theme: {
                background: colors.background,
                foreground: colors.foreground,
                cursor: colors.cursor,
                selectionBackground: colors.selectionBackground,
            },
        })
        fit = new FitAddon()
        term.loadAddon(fit)
        // Unicode 11 widths match what the pi TUI assumes; xterm 6's DOM renderer does the shaping.
        const unicode11 = new Unicode11Addon()
        term.loadAddon(unicode11)
        term.unicode.activeVersion = '11'
        term.open(host.value)
        // xterm rewrites row spans on every screen refresh, so re-tag the `▀` runs after each render.
        renderDisposer = term.onRender(scheduleBars)
        term.onData(data => void window.api.terminalWrite(props.terminalId, data).catch(() => {}))
        // Paint whatever the shell already produced while xterm was being built.
        for (const chunk of pending) if (term) term.write(chunk)
        pending.length = 0
        resizePty()

        await spawn
        // The view can unmount while the create call is in flight (tab closed quickly) —
        // touching the disposed terminal after the await would throw.
        if (disposed || !term) return
        if (failed.value) return
        term.focus()
        // Chromium re-measures the cell height when a fallback font lands (~0.7s in), so the first
        // fit can be one row too tall and the last row clipped — re-fit briefly until it settles.
        startSettleRefits(2000)
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
        // every open view and re-solve the grid. xterm re-measures the cell box on a later task,
        // so refitting immediately would compute cols/rows from the stale cell size and clip x/y
        // for some sizes — refitAfterFontChange waits for the face + stable grid instead.
        watch(
            () => [ui.terminalFontSize, ui.terminalFontFamily] as const,
            () => {
                if (!term) return
                const familyStack = resolveTerminalFontFamily(ui.terminalFontFamily, DEFAULT_TERMINAL_FONT_FAMILY)
                term.options.fontSize = ui.terminalFontSize
                term.options.fontFamily = familyStack
                fontRefitSeq += 1
                void refitAfterFontChange(fontRefitSeq, familyStack, ui.terminalFontSize)
            }
        )
    })

    onBeforeUnmount(() => {
        disposed = true
        if (settleTimer) clearInterval(settleTimer)
        settleTimer = null
        resizeObserver?.disconnect()
        resizeObserver = null
        dataDisposer?.()
        exitDisposer?.()
        renderDisposer?.dispose()
        dataDisposer = null
        exitDisposer = null
        renderDisposer = null
        // The pty is NOT killed here: it is owned by the store's close actions (panel ✕, repo tab
        // close, kill all) and by the app-quit cleanup — a panel unmounting means "hidden", not "dead".
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
        <!--
            The bundled conpty.dll withholds a new shell's first screen for ~3 s. Without a hint the
            panel just looks broken (an empty box) until the prompt lands, so say what is happening.
        -->
        <p
            v-if="!started && !failed"
            class="terminal-starting">
            Starting shell…
        </p>
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
