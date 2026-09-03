/**
 * Shared fetch/pull/push actions used by both the tab-bar sync buttons and the global keyboard shortcuts, so both paths share the busy
 * guard and toasts.
 */
import { confirmDialog } from '../utils/confirm'

export const useSyncStore = defineStore('sync', () => {
    const uiTransient = useUiTransientStore()
    /** Label of the action currently running (e.g. 'Pull'), or null when idle. */
    const busy = ref<string | null>(null)

    async function sync(label: string, fn: () => Promise<unknown>, ok: string, refresh: () => Promise<unknown>) {
        if (busy.value) return
        busy.value = label
        try {
            await uiTransient.withBusy(async () => {
                await fn()
                await refresh()
            }, `${label}ing…`)
            uiTransient.notify(ok, 'success')
        } catch (error) {
            uiTransient.notify(String(error).replace(/^Error:\s*/, ''), 'error')
        } finally {
            busy.value = null
        }
    }

    const fetch = (refresh: () => Promise<unknown>) => sync('Fetch', () => window.api.fetch(), 'Fetch completed', refresh)
    const pull = (refresh: () => Promise<unknown>, rebase = false) =>
        sync('Pull', () => window.api.pull(rebase), rebase ? 'Pull (rebase) completed' : 'Pull completed', refresh)
    const push = async (refresh: () => Promise<unknown>, force = false) => {
        if (force) {
            const ok = await confirmDialog({
                message: 'Force push will overwrite the remote branch history.\nThis cannot be undone.',
                confirmLabel: 'Force push',
                danger: true,
            })
            if (!ok) return
        }
        return sync('Push', () => window.api.push(force), force ? 'Force push completed' : 'Push completed', refresh)
    }

    return { busy, fetch, pull, push }
})
