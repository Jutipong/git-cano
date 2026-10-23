<script setup lang="ts">
    import { errorMessage } from '@shared/errors'
    import { computed, inject, onMounted, ref } from 'vue'
    import ILucideBell from '~icons/lucide/bell'
    import ILucideDownload from '~icons/lucide/download'
    import ILucideExternalLink from '~icons/lucide/external-link'
    import ILucideRefreshCw from '~icons/lucide/refresh-cw'
    import ILucideRotateCcw from '~icons/lucide/rotate-ccw'
    import ILucideSparkles from '~icons/lucide/sparkles'
    import ILucideZap from '~icons/lucide/zap'

    import { REFRESH_INTERVAL_OPTIONS, TOAST_DURATION_OPTIONS, UPDATE_CHECK_HOURS_OPTIONS, useUiStore } from '../../stores/ui'
    import { useUpdaterStore } from '../../stores/updater'
    import { confirmDialog } from '../../utils/confirm'
    import { isWindows } from '../../utils/shortcuts'
    import AppCheckbox from '../AppCheckbox.vue'
    import ThinkSpinner from '../ThinkSpinner.vue'

    import type { ToastKind } from '../../stores/uiTransient'

    const notify = inject<(m: string, t?: ToastKind) => void>('notify', () => {})
    const ui = useUiStore()
    const updater = useUpdaterStore()

    // Opt-in Windows status accelerators (persisted main-side in settings.json)
    const statusAccelerators = ref(false)
    onMounted(async () => {
        statusAccelerators.value = await window.api.getStatusAccelerators().catch(() => false)
    })
    async function toggleStatusAccelerators() {
        const next = !statusAccelerators.value
        statusAccelerators.value = next
        try {
            await window.api.setStatusAccelerators(next)
        } catch (error) {
            statusAccelerators.value = !next
            notify(errorMessage(error), 'error')
        }
    }

    const updateChecking = computed(() => updater.status === 'checking')
    const updateStatus = computed<string | null>(() => {
        if (updater.status === 'checking') return 'Checking…'
        if (updater.status === 'downloading') return `Downloading… ${updater.progress}%`
        if (updater.status === 'downloaded')
            return `Ready to install ${updater.downloadedVersion || updater.latestVersion} — restart to apply`
        if (updater.status === 'available' && updater.currentVersion) {
            const base = `Update available: v${updater.currentVersion} → ${updater.latestVersion}`
            return updater.error ? `${base} · last download failed: ${updater.error}` : base
        }
        if (updater.status === 'up-to-date' && updater.currentVersion)
            return updater.latestVersion
                ? `You're up to date (v${updater.currentVersion})`
                : `Current v${updater.currentVersion} · no releases published yet`
        if (updater.status === 'error' && updater.error) return `Check failed: ${updater.error}`
        return null
    })
    function checkForUpdateManual() {
        void updater.checkForUpdate(true, notify)
    }
    function downloadUpdateManual() {
        void updater.downloadUpdate(notify)
    }
    function installUpdateManual() {
        void updater.installUpdate(notify)
    }
    function openReleaseManual() {
        void updater.openRelease(notify)
    }
    const REFRESH_OPTIONS = REFRESH_INTERVAL_OPTIONS.map(value => ({ value, label: `${value} min` }))
    const UPDATE_OPTIONS = UPDATE_CHECK_HOURS_OPTIONS.map(value => ({ value, label: value === 0 ? 'Off' : `${value}h` }))
    const TOAST_OPTIONS = TOAST_DURATION_OPTIONS.map(value => ({ value, label: `${value}s` }))
    async function resetGeneral() {
        const ok = await confirmDialog({
            message: 'Reset general settings to defaults?',
            confirmLabel: 'Reset',
            danger: true,
            confirmIcon: 'reset',
        })
        if (!ok) return
        ui.resetGeneral()
        notify('Settings reset to defaults', 'success')
    }
</script>

<template>
    <div class="tools-section">
        <strong class="tools-section-title">
            <i-lucide-refresh-cw
                width="13"
                height="13" />
            Refresh
        </strong>
        <span
            id="refresh-interval-label"
            class="setting-label"
            >Auto-refresh interval</span
        >
        <div
            class="setting-choice-row"
            role="group"
            aria-labelledby="refresh-interval-label">
            <button
                v-for="option in REFRESH_OPTIONS"
                :key="option.value"
                type="button"
                class="setting-chip"
                :class="{ active: ui.refreshInterval === option.value }"
                :aria-pressed="ui.refreshInterval === option.value"
                @click="ui.refreshInterval = option.value">
                {{ option.label }}
            </button>
        </div>
    </div>

    <div class="tools-section">
        <strong class="tools-section-title">
            <i-lucide-download
                width="13"
                height="13" />
            Updates
        </strong>
        <span
            id="update-check-label"
            class="setting-label"
            >Check for updates every</span
        >
        <div
            class="setting-choice-row"
            role="group"
            aria-labelledby="update-check-label">
            <button
                v-for="option in UPDATE_OPTIONS"
                :key="option.value"
                type="button"
                class="setting-chip"
                :class="{ active: ui.updateCheckHours === option.value }"
                :aria-pressed="ui.updateCheckHours === option.value"
                @click="ui.updateCheckHours = option.value">
                {{ option.label }}
            </button>
        </div>
        <div class="tools-actions">
            <button
                class="btn small"
                title="Show the release notes of the installed version"
                @click="updater.changelogOpen = true">
                <i-lucide-sparkles
                    width="13"
                    height="13" />
                What's new
            </button>
            <button
                class="btn small"
                :disabled="updateChecking"
                title="Check GitHub Releases for a newer version now"
                @click="checkForUpdateManual()">
                <i-lucide-refresh-cw
                    v-if="!updateChecking"
                    width="13"
                    height="13" />
                <ThinkSpinner
                    v-else
                    compact />
                {{ updateChecking ? 'Checking…' : 'Check now' }}
            </button>
            <button
                v-if="updater.status === 'available' && updater.canAuto !== false"
                class="btn small"
                title="Download the update in the background"
                @click="downloadUpdateManual()">
                <i-lucide-download
                    width="13"
                    height="13" />
                Download
            </button>
            <button
                v-if="updater.status === 'available' && updater.canAuto === false"
                class="btn small"
                title="Open the release page to download manually"
                @click="openReleaseManual()">
                <i-lucide-external-link
                    width="13"
                    height="13" />
                Download
            </button>
            <button
                v-if="updater.status === 'downloaded'"
                class="btn small"
                title="Restart the app to install the downloaded update"
                @click="installUpdateManual()">
                <i-lucide-refresh-cw
                    width="13"
                    height="13" />
                Restart to install
            </button>
            <span
                v-if="updateStatus"
                class="setting-hint"
                >{{ updateStatus }}</span
            >
        </div>
        <div
            v-if="updater.status === 'downloading'"
            class="update-progress"
            role="progressbar"
            :aria-valuenow="updater.progress"
            aria-valuemin="0"
            aria-valuemax="100">
            <div
                class="update-progress-bar"
                :style="{ width: `${updater.progress}%` }" />
        </div>
        <span class="setting-hint">
            Off = manual check only. The installed Windows app downloads and installs here; macOS downloads manually.
        </span>
    </div>

    <div class="tools-section">
        <strong class="tools-section-title">
            <i-lucide-bell
                width="13"
                height="13" />
            Notifications
        </strong>
        <span
            id="toast-duration-label"
            class="setting-label"
            >Toast auto-dismiss after</span
        >
        <div
            class="setting-choice-row"
            role="group"
            aria-labelledby="toast-duration-label">
            <button
                v-for="option in TOAST_OPTIONS"
                :key="option.value"
                type="button"
                class="setting-chip"
                :class="{ active: ui.toastDurationSec === option.value }"
                :aria-pressed="ui.toastDurationSec === option.value"
                @click="ui.toastDurationSec = option.value">
                {{ option.label }}
            </button>
        </div>
    </div>

    <div
        v-if="isWindows"
        class="tools-section">
        <strong class="tools-section-title">
            <i-lucide-zap
                width="13"
                height="13" />
            Performance
        </strong>
        <AppCheckbox
            class="setting-toggle"
            :model-value="statusAccelerators"
            @update:model-value="toggleStatusAccelerators">
            Speed up git status (large repos / Windows)
        </AppCheckbox>
        <span class="setting-hint">
            Lets git cache worktree state (fsmonitor + untracked cache) so refreshes are much faster. Writes to each opened repository's
            local git config; takes effect the next time the repo is opened.
        </span>
    </div>

    <div class="tools-actions tools-reset-row">
        <span class="spacer" />
        <button
            class="btn danger small"
            title="Restore general settings to defaults"
            @click="resetGeneral()">
            <i-lucide-rotate-ccw
                width="13"
                height="13" />
            Reset to defaults
        </button>
    </div>
</template>
