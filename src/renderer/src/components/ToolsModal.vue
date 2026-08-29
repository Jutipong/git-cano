<script setup lang="ts">
    import type { ToastKind } from '../stores/uiTransient'
    import type { GoModel } from '@shared/types'

    interface WorktreeInfo {
        path: string
        head: string
        branch: string | null
    }

    const props = defineProps<{ bisectActive: boolean; refresh: () => Promise<unknown> }>()
    const emit = defineEmits<{ (e: 'close'): void }>()
    const notify = inject<(m: string, t?: ToastKind) => void>('notify', () => {})

    const tab = ref<'bisect' | 'worktrees' | 'submodules' | 'ai'>('bisect')
    const badRef = ref('')
    const goodRef = ref('')
    const currentCommit = ref<string | null>(null)
    const worktrees = ref<WorktreeInfo[]>([])
    const newWtPath = ref('')
    const newWtBranch = ref('')
    const submodules = ref<string[]>([])
    const ai = useAiStore()
    const aiToken = ref('')
    const aiModel = ref('')
    const aiTesting = ref(false)
    const aiTestResult = ref<{ ok: boolean; message: string } | null>(null)
    const connecting = ref(false)
    const connectResult = ref<{ ok: boolean; message: string } | null>(null)
    const modelOptions = ref<GoModel[]>([])
    // keep a previously-saved model visible even if it isn't in the fetched list
    const modelSelectOptions = computed(() => {
        const current = aiModel.value.trim()
        if (!current) return modelOptions.value
        const known = modelOptions.value.some(m => m.id === current)
        return known ? modelOptions.value : [{ id: current, name: current }, ...modelOptions.value]
    })

    watch(tab, loadTabData)

    async function loadTabData() {
        if (tab.value === 'worktrees') {
            try {
                worktrees.value = await window.api.worktrees()
            } catch {
                /* ignore */
            }
        }
        if (tab.value === 'submodules') {
            try {
                submodules.value = await window.api.submodules()
            } catch {
                /* ignore */
            }
        }
        if (tab.value === 'bisect' && props.bisectActive) {
            try {
                const log = await window.api.log(1)
                currentCommit.value = log[0]?.shortHash ?? null
            } catch {
                /* ignore */
            }
        }
        if (tab.value === 'ai') await loadAiTab()
    }

    // prefill the AI form once (switching tabs back and forth must not clobber edits)
    let aiLoaded = false
    async function loadAiTab() {
        if (aiLoaded) return
        aiLoaded = true
        try {
            await ai.load()
            aiToken.value = ai.token
            aiModel.value = ai.modelId
        } catch {
            /* ignore */
        }
    }

    /** Fetch the provider's model catalog and populate the dropdown. */
    async function connectProvider() {
        if (!aiToken.value.trim() || connecting.value) return
        connecting.value = true
        connectResult.value = null
        try {
            const models = await window.api.ai.listModels()
            if (models.length === 0) {
                connectResult.value = { ok: false, message: 'Provider returned no models' }
            } else {
                const seen = new Set<string>()
                modelOptions.value = models.filter(m => {
                    if (seen.has(m.id)) return false
                    seen.add(m.id)
                    return true
                })
                connectResult.value = { ok: true, message: `Connected — ${models.length} models available` }
            }
        } catch (error) {
            connectResult.value = { ok: false, message: String(error).replace(/^Error:\s*/, '') }
        } finally {
            connecting.value = false
        }
    }

    async function testAi() {
        if (!aiToken.value.trim() || !aiModel.value.trim()) return
        aiTesting.value = true
        aiTestResult.value = null
        try {
            const result = await window.api.ai.test(aiToken.value.trim(), aiModel.value.trim())
            aiTestResult.value = result
            // a passing test means the config is usable — persist it so the AI
            // generate button unlocks without a separate Save click
            if (result.ok) await ai.save({ token: aiToken.value.trim(), modelId: aiModel.value.trim() })
        } catch (error) {
            aiTestResult.value = { ok: false, message: String(error).replace(/^Error:\s*/, '') }
        } finally {
            aiTesting.value = false
        }
    }

    async function saveAi() {
        try {
            await ai.save({ token: aiToken.value.trim(), modelId: aiModel.value.trim() })
            notify('AI settings saved', 'success')
            emit('close')
        } catch (error) {
            notify(String(error).replace(/^Error:\s*/, ''))
        }
    }

    onMounted(loadTabData)
    onMounted(() => window.addEventListener('keydown', onKeydown))
    onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))

    function onKeydown(e: KeyboardEvent) {
        if (e.key === 'Escape') emit('close')
    }

    async function run(fn: () => Promise<unknown>, ok: string) {
        try {
            await useUiTransientStore().withBusy(fn, 'Working…')
            await props.refresh()
            notify(ok, 'success')
        } catch (error) {
            notify(String(error).replace(/^Error:\s*/, ''))
        }
    }

    function startBisect() {
        if (!badRef.value.trim()) return
        void run(async () => {
            await window.api.bisectStart(badRef.value.trim(), goodRef.value.trim() || undefined)
            await props.refresh()
        }, 'Bisect started')
    }

    function mark(kind: 'good' | 'bad' | 'skip') {
        const labels = { good: 'Marked good', bad: 'Marked bad', skip: 'Skipped' }
        void run(() => window.api.bisectMark(kind), labels[kind])
    }
    function finishBisect() {
        void run(() => window.api.bisectReset(), 'Bisect finished')
    }
    function updateSubmodules() {
        void run(() => window.api.updateSubmodules(), 'Submodules updated')
    }

    function addWorktree() {
        if (!newWtPath.value.trim()) return
        void run(() => window.api.addWorktree(newWtPath.value.trim(), newWtBranch.value.trim() || undefined), 'Worktree added')
        newWtPath.value = ''
        newWtBranch.value = ''
    }

    function removeWorktree(dir: string) {
        if (window.confirm(`Remove worktree "${dir}"?`)) void run(() => window.api.removeWorktree(dir), 'Worktree removed')
    }
</script>

<template>
    <div class="modal-overlay">
        <div class="rebase-modal tools-modal">
            <div class="rebase-modal-header">
                <strong>Advanced tools</strong>
                <span class="spacer" />
                <button
                    class="icon-btn danger commit-close-btn"
                    @click="emit('close')">
                    <i-lucide-x
                        width="16"
                        height="16" />
                </button>
            </div>
            <div class="tools-tabs">
                <button
                    v-for="name in ['bisect', 'worktrees', 'submodules', 'ai'] as const"
                    :key="name"
                    class="graph-filter"
                    :class="{ active: tab === name }"
                    @click="tab = name">
                    {{ name }}
                </button>
            </div>

            <div class="tools-body">
                <template v-if="tab === 'bisect'">
                    <template v-if="bisectActive">
                        <p class="tools-hint">Bisect in progress. Current commit:</p>
                        <code class="rebase-base">{{ currentCommit ?? '…' }}</code>
                        <div class="tools-actions">
                            <button
                                class="btn small"
                                @click="mark('good')">
                                Good
                            </button>
                            <button
                                class="btn danger small"
                                @click="mark('bad')">
                                Bad
                            </button>
                            <button
                                class="btn small"
                                @click="mark('skip')">
                                Skip
                            </button>
                            <span class="spacer" />
                            <button
                                class="btn primary small"
                                @click="finishBisect()">
                                Finish bisect
                            </button>
                        </div>
                    </template>
                    <template v-else>
                        <p class="tools-hint">Find the commit that introduced a bug by marking a known-bad and known-good ref.</p>
                        <input
                            v-model="badRef"
                            placeholder="Bad ref (e.g. HEAD or main)" />
                        <input
                            v-model="goodRef"
                            placeholder="Good ref (optional)" />
                        <div class="tools-actions">
                            <button
                                class="btn primary small"
                                :disabled="!badRef.trim()"
                                @click="startBisect()">
                                Start bisect
                            </button>
                        </div>
                    </template>
                </template>

                <template v-if="tab === 'worktrees'">
                    <div
                        v-for="wt in worktrees"
                        :key="wt.path"
                        class="remote-row">
                        <i-lucide-folder-plus
                            width="13"
                            height="13" />
                        <code>{{ wt.path }}</code>
                        <span class="muted">{{ wt.branch ? `⎇ ${wt.branch}` : wt.head.slice(0, 7) }}</span>
                        <span class="spacer" />
                        <button
                            v-if="wt.branch !== null"
                            class="icon-btn danger"
                            title="Remove worktree"
                            @click="removeWorktree(wt.path)">
                            <i-lucide-trash2
                                width="13"
                                height="13" />
                        </button>
                    </div>
                    <form
                        class="remote-add"
                        @submit.prevent="addWorktree()">
                        <input
                            v-model="newWtPath"
                            placeholder="/path/to/worktree" />
                        <input
                            v-model="newWtBranch"
                            placeholder="new branch name (optional)" />
                        <button
                            type="submit"
                            class="btn primary small">
                            Add
                        </button>
                    </form>
                </template>

                <template v-if="tab === 'submodules'">
                    <template v-if="submodules.length > 0">
                        <div
                            v-for="name in submodules"
                            :key="name"
                            class="remote-row">
                            <i-lucide-check
                                width="13"
                                height="13" /><span>{{ name }}</span>
                        </div>
                        <div class="tools-actions">
                            <button
                                class="btn primary small"
                                @click="updateSubmodules()">
                                Update all (--init --recursive)
                            </button>
                        </div>
                    </template>
                    <p
                        v-else
                        class="tools-hint">
                        This repository has no submodules (.gitmodules not found)
                    </p>
                </template>

                <template v-if="tab === 'ai'">
                    <p class="tools-hint">
                        Generate commit messages from your staged changes with OpenCode Zen Go. Get a token at
                        <a
                            href="https://opencode.ai/auth"
                            target="_blank"
                            rel="noopener noreferrer"
                            class="ai-link">opencode.ai/auth</a>.
                    </p>
                    <label class="ai-field">
                        <span>Token</span>
                        <div class="ai-token-row">
                            <input
                                v-model="aiToken"
                                type="password"
                                placeholder="opencode token"
                                autocomplete="off" />
                            <button
                                class="btn primary small"
                                :disabled="!aiToken.trim() || connecting"
                                @click="connectProvider()">
                                <i-lucide-loader-circle
                                    v-if="connecting"
                                    class="spinning"
                                    width="13"
                                    height="13" />
                                <i-lucide-plug-zap
                                    v-else
                                    width="13"
                                    height="13" />
                                {{ connecting ? 'Connecting…' : 'Connect' }}
                            </button>
                        </div>
                        <span
                            v-if="connectResult"
                            class="ai-test-result"
                            :class="connectResult.ok ? 'ok' : 'err'">{{ connectResult.message }}</span>
                    </label>
                    <label class="ai-field">
                        <span>Model ID</span>
                        <div class="ai-field-select">
                            <select v-model="aiModel">
                                <option
                                    v-for="m in modelSelectOptions"
                                    :key="m.id"
                                    :value="m.id">
                                    {{ m.name }}
                                </option>
                            </select>
                            <i-lucide-chevron-down
                                class="ai-select-caret"
                                width="14"
                                height="14" />
                        </div>
                    </label>
                    <div class="tools-actions">
                        <button
                            class="btn success small"
                            :disabled="!aiToken.trim() || !aiModel.trim() || aiTesting"
                            @click="testAi()">
                            <i-lucide-flask-conical
                                v-if="!aiTesting"
                                width="13"
                                height="13" />
                            <i-lucide-loader-circle
                                v-else
                                class="spinning"
                                width="13"
                                height="13" />
                            {{ aiTesting ? 'Testing…' : 'Test connect' }}
                        </button>
                        <span
                            v-if="aiTestResult"
                            class="ai-test-result"
                            :class="aiTestResult.ok ? 'ok' : 'err'">{{ aiTestResult.message }}</span>
                        <span class="spacer" />
                        <button
                            class="btn small"
                            :disabled="aiTesting"
                            @click="emit('close')">
                            <i-lucide-x
                                width="13"
                                height="13" />
                            Close
                        </button>
                        <button
                            class="btn primary small"
                            :disabled="aiTesting"
                            @click="saveAi()">
                            <i-lucide-save
                                width="13"
                                height="13" />
                            Save
                        </button>
                    </div>
                </template>
            </div>
        </div>
    </div>
</template>
