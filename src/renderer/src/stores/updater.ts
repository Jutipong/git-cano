import { defineStore } from 'pinia'
import { ref } from 'vue'

export type UpdaterStatus = 'idle' | 'checking' | 'available' | 'up-to-date' | 'error'

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
 */
export const useUpdaterStore = defineStore('updater', () => {
    const status = ref<UpdaterStatus>('idle')
    const currentVersion = ref('')
    const latestVersion = ref('')
    const releaseUrl = ref('')
    const lastCheckedAt = ref<number | null>(null)
    const error = ref<string | null>(null)

    async function checkForUpdate(announce = false, notify?: (m: string, t?: 'success' | 'error') => void): Promise<void> {
        if (status.value === 'checking') return
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

    return { status, currentVersion, latestVersion, releaseUrl, lastCheckedAt, error, checkForUpdate }
})
