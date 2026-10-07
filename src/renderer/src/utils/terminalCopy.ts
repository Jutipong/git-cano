/**
 * Copy-key gating for the terminal panel. Ctrl+C inside a shell is the interrupt character
 * (ETX / 0x03), so xterm must keep every plain Ctrl+C — copy is layered on top the way Windows
 * Terminal does it: the explicit Ctrl+Shift+C always copies, and on Windows/Linux a plain Ctrl+C
 * copies only while text is selected (interrupting needs no selection). macOS keeps Cmd+C for
 * copy and never steals Ctrl+C from the shell.
 */

export type TerminalCopyAction = 'pass' | 'copy' | 'consume'

export function terminalCopyDecision(
    event: Pick<KeyboardEvent, 'type' | 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>,
    hasSelection: boolean,
    mac: boolean
): TerminalCopyAction {
    // xterm fires the custom handler for keydown and keypress — act once, on keydown.
    if (event.type !== 'keydown' || event.key.toLowerCase() !== 'c') return 'pass'
    // Ctrl+Shift+C is the terminal-wide copy combo (Windows Terminal, Linux terminals). Consume it
    // even with nothing selected so it can never reach the shell or open DevTools.
    if (event.ctrlKey && event.shiftKey && !event.altKey && !event.metaKey) return hasSelection ? 'copy' : 'consume'
    if (event.altKey) return 'pass'
    if (mac) {
        // macOS copies with Cmd+C; Ctrl+C stays the shell's interrupt.
        if (event.metaKey && !event.shiftKey) return hasSelection ? 'copy' : 'consume'
        return 'pass'
    }
    // Windows/Linux: a selection turns plain Ctrl+C into copy, otherwise it stays ETX for the shell.
    if (event.ctrlKey && !event.shiftKey && !event.metaKey) return hasSelection ? 'copy' : 'pass'
    return 'pass'
}
