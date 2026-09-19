import { defineStore } from 'pinia'
import { ref } from 'vue'

export type UpdaterStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'up-to-date' | 'error'

const RELEASES_URL = 'https://api.github.com/repos/Jutipong/open-git/releases/latest'

function compareVersions(a: string, b: string): number {
    const norm = (v: string) =>
        v
            .trim()
            .replace(/^v/i, '')
            .split('-')[0]
            .split('.')
            .map(n => Number.parseInt(n, 10) || 0)
    const pa = norm(a)
    const pb = norm(b)
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
        if (diff !== 0) return diff > 0 ? 1 : -1
    }
    const preA = a.includes('-') ? 0 : 1
    const preB = b.includes('-') ? 0 : 1
    return preA === preB ? 0 : preA > preB ? 1 : -1
}

/**
 * Shared update-check state. Not persisted — every launch starts at `idle`
 * so the sidebar update button stays hidden until a check finds a newer release.
 *
 * Setup .exe (installed Windows) additionally supports in-app download/install
 * via electron-updater (`downloading` → `downloaded`); macOS stays
 * manual and falls back to opening the release page.
 */
export const useUpdaterStore = defineStore('updater', () => {
    const status = ref<UpdaterStatus>('idle')
    const currentVersion = ref('')
    const latestVersion = ref('')
    const releaseUrl = ref('')
    const lastCheckedAt = ref<number | null>(null)
    const error = ref<string | null>(null)
    const progress = ref(0)
    const downloadedVersion = ref('')
    /** Null until the main process answers — true only for installed Windows. */
    const canAuto = ref<boolean | null>(null)
    let eventsStarted = false

    async function checkForUpdate(announce = false, notify?: (m: string, t?: 'success' | 'error') => void): Promise<void> {
        if (status.value === 'checking' || status.value === 'downloading' || status.value === 'downloaded') return
        status.value = 'checking'
        error.value = null
        try {
            const current = await window.api.getVersion()
            currentVersion.value = current
            const res = await fetch(RELEASES_URL, { headers: { Accept: 'application/vnd.github+json' } })
            if (res.status === 404) {
                status.value = 'up-to-date'
                lastCheckedAt.value = Date.now()
                return
            }
            if (!res.ok) throw new Error(`GitHub responded ${res.status}`)
            const data = (await res.json()) as { tag_name?: string; name?: string; html_url?: string }
            const latest = String(data.tag_name ?? data.name ?? '').trim()
            if (!latest) throw new Error('Release has no version tag')
            latestVersion.value = latest
            releaseUrl.value = typeof data.html_url === 'string' ? data.html_url : ''
            lastCheckedAt.value = Date.now()
            if (compareVersions(latest, current) > 0) {
                status.value = 'available'
                if (announce) notify?.(`Update available: ${latest} (you have v${current})`, 'success')
            } else {
                status.value = 'up-to-date'
            }
        } catch (err) {
            const message = String(err).replace(/^Error:\s*/, '')
            status.value = 'error'
            error.value = message
            if (announce) notify?.(`Update check failed: ${message}`, 'error')
        }
    }

    async function ensureAutoSupport(): Promise<boolean> {
        if (canAuto.value !== null) return canAuto.value
        try {
            canAuto.value = await window.api.updateCanAuto()
        } catch {
            canAuto.value = false
        }
        return canAuto.value
    }

    function startUpdateEvents(): void {
        if (eventsStarted) return
        eventsStarted = true
        window.api.onUpdateProgress(p => {
            if (status.value === 'downloading') progress.value = p.percent
        })
        window.api.onUpdateDownloaded(({ version }) => {
            downloadedVersion.value = version
            progress.value = 100
            status.value = 'downloaded'
        })
        window.api.onUpdateError(message => {
            if (status.value !== 'downloading') return
            status.value = 'available'
            error.value = message
        })
    }

    /** Manual fallback for macOS / dev — opens the release page in a browser. */
    async function openRelease(notify?: (m: string, t?: 'success' | 'error') => void): Promise<void> {
        if (!releaseUrl.value) {
            notify?.('No release page found yet', 'error')
            return
        }
        try {
            await window.api.openReleasePage(releaseUrl.value)
        } catch (err) {
            notify?.(String(err).replace(/^Error:\s*/, ''), 'error')
        }
    }

    async function downloadUpdate(notify?: (m: string, t?: 'success' | 'error') => void): Promise<void> {
        startUpdateEvents()
        const auto = await ensureAutoSupport()
        if (!auto) {
            void openRelease(notify)
            return
        }
        if (status.value === 'downloading' || status.value === 'downloaded') return
        status.value = 'downloading'
        progress.value = 0
        error.value = null
        try {
            const version = await window.api.updateDownload()
            downloadedVersion.value = version || latestVersion.value
            progress.value = 100
            status.value = 'downloaded'
            notify?.(`Update downloaded — restart to install ${downloadedVersion.value}`, 'success')
        } catch (err) {
            status.value = 'available'
            error.value = String(err).replace(/^Error:\s*/, '')
            notify?.(`Download failed: ${error.value}`, 'error')
        }
    }

    async function installUpdate(notify?: (m: string, t?: 'success' | 'error') => void): Promise<void> {
        try {
            await window.api.updateInstall()
        } catch (err) {
            notify?.(String(err).replace(/^Error:\s*/, ''), 'error')
        }
    }

    return {
        status,
        currentVersion,
        latestVersion,
        releaseUrl,
        lastCheckedAt,
        error,
        progress,
        downloadedVersion,
        canAuto,
        checkForUpdate,
        ensureAutoSupport,
        startUpdateEvents,
        downloadUpdate,
        installUpdate,
        openRelease,
    }
})
