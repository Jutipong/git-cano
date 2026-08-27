<script setup lang="ts">
    import type { RepoState } from '@shared/types'
    import type { ToastKind } from '../stores/uiTransient'

    const props = defineProps<{
        conflicts: string[]
        state: RepoState
        refresh: () => Promise<unknown>
    }>()
    const notify = inject<(m: string, t?: ToastKind) => void>('notify', () => {})

    function abortMerge() {
        void run(() => window.api.abortMerge(), 'Merge aborted')
    }
    function continueMerge() {
        void run(() => window.api.continueMerge(), 'Merge completed')
    }
    function abortRebase() {
        void run(() => window.api.rebaseAbort(), 'Rebase aborted')
    }
    function continueRebase() {
        void run(() => window.api.rebaseContinue(), 'Rebase continued')
    }
    function takeOurs(file: string) {
        void run(() => window.api.conflictTakeSide(file, 'ours'), `${file}: kept ours`)
    }
    function markResolved(file: string) {
        void run(() => window.api.markResolved([file]), `${file}: resolved`)
    }
    function takeTheirs(file: string) {
        void run(() => window.api.conflictTakeSide(file, 'theirs'), `${file}: kept theirs`)
    }

    async function run(fn: () => Promise<unknown>, ok: string) {
        try {
            await fn()
            await props.refresh()
            notify(ok, 'success')
        } catch (error) {
            notify(String(error).replace(/^Error:\s*/, ''))
        }
    }
</script>

<template>
    <div
        v-if="state.merging || state.rebasing || conflicts.length"
        class="conflict-banner">
        <div class="conflict-banner-header">
            <i-lucide-alert-triangle
                width="15"
                height="15" />
            <strong v-if="state.rebasing">Rebase in progress — resolve conflicts to continue</strong>
            <strong v-else-if="state.merging">Merge conflict — resolve all files then continue</strong>
            <span class="spacer" />
            <template v-if="state.merging && !state.rebasing">
                <button
                    class="btn small"
                    @click="abortMerge()">
                    <i-lucide-x
                        width="13"
                        height="13" />
                    Abort merge
                </button>
                <button
                    v-if="conflicts.length === 0"
                    class="btn primary small"
                    @click="continueMerge()">
                    <i-lucide-check
                        width="13"
                        height="13" />
                    Continue merge
                </button>
            </template>
            <template v-if="state.rebasing">
                <button
                    class="btn small"
                    @click="abortRebase()">
                    <i-lucide-x
                        width="13"
                        height="13" />
                    Abort rebase
                </button>
                <button
                    v-if="conflicts.length === 0"
                    class="btn primary small"
                    @click="continueRebase()">
                    <i-lucide-check
                        width="13"
                        height="13" />
                    Continue rebase
                </button>
            </template>
        </div>

        <div
            v-for="file in conflicts"
            :key="file"
            class="conflict-row">
            <span
                class="conflict-path"
                :title="file"
                >{{ file }}</span
            >
            <div class="conflict-actions">
                <button
                    class="detail-action"
                    title="Keep our version"
                    @click="takeOurs(file)">
                    Ours
                </button>
                <button
                    class="detail-action"
                    title="Keep their version"
                    @click="takeTheirs(file)">
                    Theirs
                </button>
                <button
                    class="detail-action accent"
                    title="I edited the file manually — mark as resolved"
                    @click="markResolved(file)">
                    <i-lucide-arrow-left-right
                        width="12"
                        height="12" />
                    Mark resolved
                </button>
            </div>
        </div>
    </div>
</template>
