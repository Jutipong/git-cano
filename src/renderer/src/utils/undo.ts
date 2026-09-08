import { useRepoStore } from '../stores/repo'
import { UNDO_TOAST_DURATION, useUiTransientStore } from '../stores/uiTransient'

/**
 * Shows a success toast with a timed Undo button when the main process journaled an undoable
 * action for the repo — otherwise a plain success toast. The toast window is the only gate; the
 * journal entry is id-guarded so a stale toast can't undo a newer action.
 */
export async function notifyUndoable(repoPath: string | undefined, successMessage: string): Promise<void> {
    const uiTransient = useUiTransientStore()
    const target = repoPath?.trim() ? repoPath : undefined
    const preview = target ? await window.api.undoPeek(target).catch(() => null) : null
    if (!target || !preview) {
        uiTransient.notify(successMessage, 'success')
        return
    }
    const { id } = preview
    uiTransient.notify(successMessage, 'success', {
        durationMs: UNDO_TOAST_DURATION,
        action: { label: 'Undo', act: () => void performUndo(target, id) },
    })
}

export async function performUndo(repoPath: string, id: number): Promise<void> {
    const uiTransient = useUiTransientStore()
    try {
        const done = await uiTransient.withBusy(() => window.api.undoById(id, repoPath), 'Undoing…')
        // Refresh the active tab; a background tab heals via the repo-changed watcher.
        await useRepoStore().refresh().catch(() => {})
        // The stash list lives outside refresh() (StashPanel loads it on stashListTick).
        uiTransient.bumpStashList()
        uiTransient.notify(done, 'success')
    } catch (error) {
        uiTransient.notify(String(error).replace(/^Error:\s*/, ''), 'error')
    }
}
