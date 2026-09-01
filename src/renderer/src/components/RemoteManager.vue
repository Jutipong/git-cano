<script setup lang="ts">
    import type { ToastKind } from '../stores/uiTransient'

    const props = defineProps<{ refresh: () => Promise<unknown> }>()
    const notify = inject<(m: string, t?: ToastKind) => void>('notify', () => {})

    const originUrl = ref('')
    const hasOrigin = ref(false)
    const loaded = ref(false)
    const saving = ref(false)

    async function load() {
        try {
            const remotes = await window.api.remotesFull()
            const origin = remotes.find(r => r.name === 'origin')
            hasOrigin.value = !!origin
            originUrl.value = origin?.url ?? ''
        } catch (error) {
            notify(String(error))
        } finally {
            loaded.value = true
        }
    }
    onMounted(load)

    async function run(fn: () => Promise<unknown>, successMessage: string) {
        try {
            await useUiTransientStore().withBusy(fn, 'Working…')
            await load()
            await props.refresh()
            notify(successMessage, 'success')
        } catch (error) {
            notify(String(error).replace(/^Error:\s*/, ''))
        }
    }

    async function save() {
        const url = originUrl.value.trim()
        if (!url || saving.value) return
        saving.value = true
        try {
            await window.api.setRemoteUrl('origin', url)
            notify('Remote URL saved', 'success')
        } catch (error) {
            notify(String(error).replace(/^Error:\s*/, ''))
        } finally {
            saving.value = false
        }
    }

    function addOrigin() {
        const url = originUrl.value.trim()
        if (!url) return
        void run(() => window.api.addRemote('origin', url), 'Remote origin added')
    }

    const testing = ref(false)
    async function testUrl() {
        const url = originUrl.value.trim()
        if (!url || testing.value) return
        testing.value = true
        try {
            const result = await window.api.testRemoteUrl(url)
            notify(result.message, result.ok ? 'success' : 'error')
        } catch (error) {
            notify(String(error).replace(/^Error:\s*/, ''))
        } finally {
            testing.value = false
        }
    }
</script>

<template>
    <div class="tools-section">
        <strong class="tools-section-title">
            <i-lucide-globe2
                width="13"
                height="13" />
            Remotes
        </strong>

        <div class="remote-list">
            <div
                v-if="loaded && hasOrigin"
                class="remote-row">
                <strong>origin</strong>
                <input
                    v-model="originUrl"
                    class="remote-url"
                    placeholder="https://github.com/user/repo.git"
                    @keydown.enter.prevent="save()" />
            </div>
            <div
                v-else-if="loaded"
                class="sidebar-empty">
                origin is not configured yet
            </div>
        </div>

        <form
            v-if="loaded && !hasOrigin"
            class="remote-add origin-add"
            @submit.prevent="addOrigin()">
            <input
                v-model="originUrl"
                placeholder="https://github.com/user/repo.git" />
            <button
                type="submit"
                class="btn primary small">
                <i-lucide-plus
                    width="13"
                    height="13" />
                Add origin
            </button>
        </form>

        <div class="tools-actions">
            <button
                class="btn success small"
                :disabled="!originUrl.trim() || testing"
                title="Check that this URL is reachable"
                @click="testUrl()">
                <i-lucide-loader-circle
                    v-if="testing"
                    class="spinning"
                    width="13"
                    height="13" />
                <i-lucide-plug-zap
                    v-else
                    width="13"
                    height="13" />
                {{ testing ? 'Testing…' : 'Test URL' }}
            </button>
            <span class="spacer" />
            <button
                class="btn primary small"
                :disabled="saving || !hasOrigin || !originUrl.trim()"
                @click="save()">
                <i-lucide-check
                    width="13"
                    height="13" />
                Save
            </button>
        </div>
    </div>
</template>
