<script setup lang="ts">
    import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
    import ILucideTriangleAlert from '~icons/lucide/triangle-alert'

    import { useUiStore, DEFAULT_TERMINAL_FONT_FAMILY } from '../stores/ui'
    import { isMac } from '../utils/shortcuts'
    import { fullBlockCells } from '../utils/terminalBars'
    import { terminalCopyDecision } from '../utils/terminalCopy'
    import { primaryFontFamily, resolveTerminalFontFamily, terminalFontPx } from '../utils/terminalFont'
    import { shouldActivateTerminalLink } from '../utils/terminalLinks'

    import type { TerminalData, TerminalExit } from '@shared/types'
    import type { FitAddon } from '@xterm/addon-fit'
    import type { IDisposable, Terminal } from '@xterm/xterm'

    import '@xterm/xterm/css/xterm.css'

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
     * A fresh pty emits escape sequences (window title, cursor/mode setup) within milliseconds, long before the shell has drawn anything —
     * the bundled conpty.dll can then hold the actual screen for seconds. Only real text counts as "the shell is up", or the hint would
     * blink away instantly.
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
     * The primary family comes from Settings → Terminal (default Consolas, inbox on every Windows); the stack always keeps Leelawadee UI
     * behind it — Thai has no monospace face on Windows, so the browser falls back per codepoint and lets GPOS stack the vowels/tone marks.
     * xterm's DOM renderer writes whole grapheme clusters into one <span>, which is what makes that shaping work — the canvas renderer
     * (removed in xterm 6) never shaped Thai at all. A pick whose font is not installed resolves back to the default stack.
     */
    const family = resolveTerminalFontFamily(ui.terminalFontFamily, DEFAULT_TERMINAL_FONT_FAMILY)

    /**
     * xterm's cell metrics live in unzoomed CSS px, while the app's `<html> { zoom }` carries the UI font scale. Dividing it out
     * keeps Settings → Terminal's size absolute at any UI font size; the app zoom still magnifies the window.
     */
    function fontSizePx(): number {
        return terminalFontPx(ui.terminalFontSize, ui.fontScale)
    }

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

    /**
     * Ctrl/Cmd+click on a URL — plain text via the web-links addon, OSC 8 via `linkHandler`. The addon's default handler calls
     * `window.open`, which would create an Electron window instead of opening the user's browser; `app:openExternal` is the OS-browser
     * bridge.
     */
    function openLink(event: MouseEvent, uri: string) {
        if (!shouldActivateTerminalLink(event, uri)) return
        void window.api.openExternal(uri).catch(() => {})
    }

    /**
     * Solve the grid from the box the terminal actually paints into. FitAddon keeps a scrollbar column set
     * (`DEFAULT_SCROLL_BAR_WIDTH`, 14px) out of the width it proposes even though `modern-ui.css` hides the viewport
     * scrollbar, so the grid always stopped up to two columns short of the panel and left a dead band along its right
     * edge — a TUI that paints its own background (opencode's sidebar) shows that band as a differently-coloured strip.
     * `rows` still comes from the addon (its height maths has no such allowance); `cols` is solved here from the
     * painted screen's own cell width, so there is no xterm internals dependency and no flip-flop against the addon's
     * conservative width guess. The public refresh after a resize replaces the full clear the addon used to force.
     */
    function fitGrid() {
        if (!term || !fit || !term.cols || !term.rows) return
        const hostEl = host.value
        const element = term.element
        const screen = element?.querySelector<HTMLElement>('.xterm-screen')
        if (!hostEl || !element || !screen || screen.offsetWidth === 0) return
        let rows = term.rows
        try {
            const proposed = fit.proposeDimensions()
            if (proposed && Number.isFinite(proposed.rows) && proposed.rows > 0) rows = proposed.rows
        } catch {
            // The addon cannot measure yet (hidden/collapsed box) — keep the current rows.
        }
        const style = getComputedStyle(element)
        const padding = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0)
        const cellWidth = screen.offsetWidth / term.cols
        if (cellWidth <= 0) return
        const cols = Math.max(2, Math.floor((hostEl.clientWidth - padding) / cellWidth))
        if (cols === term.cols && rows === term.rows) return
        term.resize(cols, rows)
        term.refresh(0, term.rows - 1)
    }

    function resizePty() {
        if (!term || !fit) return
        // A hidden view (a sibling tab is showing, or the whole panel is toggled away) has no box —
        // fitting it would report 0 cols/rows.
        if (!host.value || host.value.clientWidth === 0 || host.value.clientHeight === 0) return
        fitGrid()
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
     * Re-solve the grid after a font change. xterm re-measures the cell box on a later task (debounced CharSizeService.measure), so fitting
     * immediately reuses the stale cell size and the last row/column clips for some sizes. Wait for the new face, let two frames pass for
     * the re-measure, fit, then burst refits until fallback fonts settle. Refits until cols/rows stop changing so every size in
     * TERMINAL_FONT_SIZE_OPTIONS lands on a full grid.
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
     * TUIs paint bars and rules with half/full block glyphs — opencode's input-box footer uses `▀`, the sys-status sidebar meters use
     * `█` + `░`. At fractional display scales each glyph's antialiased edge falls a hair short of the cell, so a run shows a faint
     * vertical seam at every boundary. Tag those spans so a solid background in the glyph's own colour can sit behind them
     * (`.terminal-bar` / `.terminal-block` in modern-ui.css) — the antialiasing then blends into the identical colour.
     */
    const BAR_RUN = /^\u2580+$/
    /** A single `█` is a scrollbar cell or block-art dot, not a meter — only paint runs. */
    const MIN_BLOCK_CELLS = 2
    let barFrame = 0
    function markBars() {
        barFrame = 0
        const root = host.value?.querySelector('.xterm-rows')
        if (!root) return
        for (const span of root.querySelectorAll<HTMLElement>('span')) {
            // A cursor span paints its own block — leave it alone so the cursor stays visible.
            const cursor = span.classList.contains('xterm-cursor')
            const text = span.textContent ?? ''
            span.classList.toggle('terminal-bar', !cursor && BAR_RUN.test(text))
            const cells = cursor ? 0 : fullBlockCells(text)
            const block = cells >= MIN_BLOCK_CELLS
            span.classList.toggle('terminal-block', block)
            if (block) span.style.setProperty('--block-count', String(cells))
            else if (span.style.getPropertyValue('--block-count')) span.style.removeProperty('--block-count')
        }
    }
    function scheduleBars() {
        if (barFrame) return
        barFrame = requestAnimationFrame(markBars)
    }

    /**
     * Xterm measures the character cell once at construction and caches it. Creating the Terminal before the stylesheets and fallback fonts
     * are ready yields a wrong cell size, and every Thai combining mark then lands off its column.
     */
    async function waitForFonts(family: string, size: number) {
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
            await document.fonts.load(`${size}px "${family}"`)
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

        await waitForFonts(primaryFontFamily(family), fontSizePx())
        if (disposed || !host.value) return
        // Loaded lazily so the terminal chunk (xterm) only ships when a panel actually opens.
        const [{ Terminal }, { FitAddon }, { Unicode11Addon }, { WebLinksAddon }] = await Promise.all([
            import('@xterm/xterm'),
            import('@xterm/addon-fit'),
            import('@xterm/addon-unicode11'),
            import('@xterm/addon-web-links'),
        ])
        if (disposed) return

        const colors = themeColors()
        term = new Terminal({
            cursorBlink: true,
            fontFamily: family,
            fontSize: fontSizePx(),
            // Must be exactly 1.0: block-element ASCII art (opencode's logo) fills the em box, and a
            // taller cell leaves a visible gap in the art.
            lineHeight: 1.0,
            scrollback: 1000,
            // xterm 6 moved Unicode11Addon behind the proposed API.
            allowProposedApi: true,
            // OSC 8 hyperlinks (xterm's built-in provider) would otherwise `confirm()` and then
            // `window.open`; route them through the same OS-browser handler as plain-text URLs.
            linkHandler: { activate: openLink },
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
        // Plain-text URLs become links; `openLink` replaces the addon's `window.open` default.
        term.loadAddon(new WebLinksAddon(openLink))
        term.open(host.value)
        // xterm rewrites row spans on every screen refresh, so re-tag the `▀` runs after each render.
        renderDisposer = term.onRender(scheduleBars)
        term.onData(data => void window.api.terminalWrite(props.terminalId, data).catch(() => {}))
        // Ctrl+C is the shell's interrupt (xterm writes ETX for it) — copy piggybacks Windows-Terminal
        // style: Ctrl+Shift+C always copies, a plain Ctrl+C copies only while text is selected, and
        // macOS keeps Cmd+C. Returning false stops xterm from also sending 0x03 on a copy press.
        term.attachCustomKeyEventHandler(event => {
            if (!term) return true
            const action = terminalCopyDecision(event, term.hasSelection(), isMac)
            if (action === 'pass') return true
            event.preventDefault()
            if (action === 'copy') {
                void navigator.clipboard.writeText(term.getSelection()).catch(() => {})
                // Clear after copying so the next Ctrl+C goes back to interrupting a running command.
                term.clearSelection()
            }
            return false
        })
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
            () => [ui.terminalFontSize, ui.terminalFontFamily, ui.fontScale] as const,
            () => {
                if (!term) return
                const familyStack = resolveTerminalFontFamily(ui.terminalFontFamily, DEFAULT_TERMINAL_FONT_FAMILY)
                term.options.fontSize = fontSizePx()
                term.options.fontFamily = familyStack
                fontRefitSeq += 1
                void refitAfterFontChange(fontRefitSeq, familyStack, fontSizePx())
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
