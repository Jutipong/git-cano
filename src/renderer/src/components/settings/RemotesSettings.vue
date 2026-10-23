<script setup lang="ts">
    import { errorMessage } from '@shared/errors'
    import { computed, inject, onMounted, onUnmounted, ref } from 'vue'
    import ILucideCheck from '~icons/lucide/check'
    import ILucideChevronDown from '~icons/lucide/chevron-down'
    import ILucideCopy from '~icons/lucide/copy'
    import ILucideExternalLink from '~icons/lucide/external-link'
    import ILucideFlaskConical from '~icons/lucide/flask-conical'
    import ILucideFolderGit2 from '~icons/lucide/folder-git-2'
    import ILucideFolderOpen from '~icons/lucide/folder-open'
    import ILucideKeyRound from '~icons/lucide/key-round'
    import ILucidePlus from '~icons/lucide/plus'
    import ILucideTrash2 from '~icons/lucide/trash-2'
    import ILucideUserRound from '~icons/lucide/user-round'
    import ILucideUsers from '~icons/lucide/users'

    import { useAuthStore } from '../../stores/auth'
    import { confirmDialog } from '../../utils/confirm'
    import RemoteManager from '../RemoteManager.vue'
    import ThinkSpinner from '../ThinkSpinner.vue'

    import type { ToastKind } from '../../stores/uiTransient'
    import type { SshKeyInfo, SshTestResult } from '@shared/types'

    const props = defineProps<{ refresh: () => Promise<unknown> }>()
    const notify = inject<(m: string, t?: ToastKind) => void>('notify', () => {})

    const auth = useAuthStore()
    const authSub = ref<'ssh' | 'github'>('ssh')
    const activeKey = computed<SshKeyInfo | null>(() => auth.keys.find(key => key.privateKeyPath === auth.config.sshKeyPath) ?? null)
    const keyOpen = ref(false)

    function toggleKeyPop() {
        keyOpen.value = !keyOpen.value
    }

    async function selectKey(keyPath: string) {
        keyOpen.value = false
        if (keyPath === auth.config.sshKeyPath) return
        await setActiveKey(keyPath)
    }

    function onDocPointerDown(event: PointerEvent) {
        if (!keyOpen.value) return
        if ((event.target as HTMLElement | null)?.closest('.ssh-key-wrap')) return
        keyOpen.value = false
    }

    onMounted(() => document.addEventListener('pointerdown', onDocPointerDown))
    onUnmounted(() => document.removeEventListener('pointerdown', onDocPointerDown))
    const sshTesting = ref(false)
    const sshTestResult = ref<SshTestResult | null>(null)
    const generating = ref(false)
    const genName = ref('')
    const genComment = ref('')
    const genPassphrase = ref('')
    const githubBusy = ref(false)
    const githubTokenDraft = ref('')

    async function setActiveKey(keyPath: string) {
        try {
            await auth.save({ ...auth.config, sshKeyPath: keyPath })
            await auth.refreshKeys()
        } catch (error) {
            notify(errorMessage(error), 'error')
        }
    }

    async function copyPublicKey(key: SshKeyInfo) {
        try {
            await navigator.clipboard.writeText(key.publicKey)
            notify('Public key copied to clipboard', 'success')
        } catch (error) {
            notify(errorMessage(error), 'error')
        }
    }

    async function testKey(key: SshKeyInfo) {
        if (sshTesting.value) return
        sshTesting.value = true
        sshTestResult.value = null
        try {
            sshTestResult.value = await window.api.auth.sshTest(key.privateKeyPath)
        } catch (error) {
            sshTestResult.value = { ok: false, message: errorMessage(error) }
        } finally {
            sshTesting.value = false
        }
    }

    async function deleteKey(key: SshKeyInfo) {
        const ok = await confirmDialog({
            message: `Permanently delete "${key.name}" (private + public key) from ~/.ssh? This cannot be undone.`,
            confirmLabel: 'Delete',
            danger: true,
        })
        if (!ok) return
        try {
            auth.keys = await window.api.auth.sshDelete(key.privateKeyPath)
            notify(`SSH key "${key.name}" deleted`, 'success')
        } catch (error) {
            notify(errorMessage(error), 'error')
        }
    }

    /** Key name without a trailing ".pub" — the input may include the extension (placeholder shows "filename.pub"). */
    const genKeyName = computed(() => genName.value.trim().replace(/\.pub$/i, ''))

    /** Same rules as `generateSshKey` in the main process — validated live so the Generate button can be disabled. */
    const genNameError = computed<string | null>(() => {
        if (!genName.value.trim()) return null
        const name = genKeyName.value
        if (!name || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) {
            return 'Use only letters, numbers, "-", ".", "_" — must start with a letter or number'
        }
        if (auth.keys.some(key => key.name === `${name}.pub`)) {
            return `Key "${name}.pub" already exists in ~/.ssh`
        }
        return null
    })

    async function generateKey() {
        if (generating.value || genNameError.value || !genKeyName.value) return
        generating.value = true
        try {
            const key = await window.api.auth.sshGenerate(genKeyName.value, genComment.value, genPassphrase.value)
            await auth.refreshKeys()
            notify(`SSH key "${key.name}" created`, 'success')
            genName.value = ''
            genComment.value = ''
            genPassphrase.value = ''
        } catch (error) {
            notify(errorMessage(error), 'error')
        } finally {
            generating.value = false
        }
    }

    async function openSshDir() {
        try {
            await window.api.auth.openSshDir()
        } catch (error) {
            notify(errorMessage(error), 'error')
        }
    }

    async function saveGithubToken() {
        const token = githubTokenDraft.value.trim()
        if (!token || githubBusy.value) return
        githubBusy.value = true
        try {
            const user = await window.api.auth.githubVerify(token)
            await auth.save({ ...auth.config, githubToken: token })
            githubTokenDraft.value = ''
            notify(`Signed in as ${user.login}`, 'success')
        } catch (error) {
            notify(errorMessage(error), 'error')
        } finally {
            githubBusy.value = false
        }
    }

    async function signOutGithub() {
        try {
            await auth.save({ ...auth.config, githubToken: '' })
            notify('GitHub token removed', 'success')
        } catch (error) {
            notify(errorMessage(error), 'error')
        }
    }

    async function openTokenPage() {
        try {
            await window.api.auth.openGithubTokenPage()
        } catch (error) {
            notify(errorMessage(error), 'error')
        }
    }

    async function refreshGithubStatus() {
        await auth.refreshGithubUser()
    }

    let authLoaded = false
    async function loadAuthTab() {
        if (authLoaded) return
        authLoaded = true
        await auth.load()
        await auth.refreshKeys()
        await refreshGithubStatus()
    }

    onMounted(loadAuthTab)
</script>

<template>
    <RemoteManager :refresh="props.refresh" />

    <div class="tools-section">
        <div class="setting-choice-row">
            <button
                type="button"
                class="setting-chip"
                :class="{ active: authSub === 'ssh' }"
                @click="authSub = 'ssh'">
                SSH
            </button>
            <button
                type="button"
                class="setting-chip"
                :class="{ active: authSub === 'github' }"
                @click="authSub = 'github'">
                GitHub
            </button>
        </div>
    </div>

    <template v-if="authSub === 'ssh'">
        <div class="tools-section">
            <strong class="tools-section-title">
                <i-lucide-key-round
                    width="13"
                    height="13" />
                Active SSH key
            </strong>
            <label class="ai-field">
                <span>Key used for SSH remotes (applies to all repositories)</span>
                <div class="ssh-key-wrap">
                    <button
                        type="button"
                        class="workspace-btn"
                        title="Choose SSH key"
                        @click="toggleKeyPop()">
                        <i-lucide-key-round
                            width="13"
                            height="13" />
                        <span class="workspace-btn-name">
                            {{ activeKey?.name ?? 'None — use system default' }}
                        </span>
                        <i-lucide-chevron-down
                            width="12"
                            height="12" />
                    </button>
                    <div
                        v-if="keyOpen"
                        class="workspace-pop">
                        <button
                            type="button"
                            class="workspace-item"
                            :class="{ active: !activeKey }"
                            @click="selectKey('')">
                            <i-lucide-check
                                v-if="!activeKey"
                                width="13"
                                height="13" />
                            <span
                                v-else
                                class="workspace-item-spacer" />
                            <span class="workspace-item-name">None — use system default</span>
                        </button>
                        <div
                            v-for="key in auth.keys"
                            :key="key.privateKeyPath"
                            class="workspace-row">
                            <button
                                type="button"
                                class="workspace-item"
                                :class="{ active: key.active }"
                                :title="key.fingerprint || key.publicKeyPath"
                                @click="selectKey(key.privateKeyPath)">
                                <i-lucide-check
                                    v-if="key.active"
                                    width="13"
                                    height="13" />
                                <span
                                    v-else
                                    class="workspace-item-spacer" />
                                <span class="workspace-item-name">{{ key.name }}</span>
                            </button>
                            <button
                                v-if="!key.active"
                                class="icon-btn danger workspace-item-delete"
                                title="Delete key pair from ~/.ssh"
                                @click="deleteKey(key)">
                                <i-lucide-trash-2
                                    width="12"
                                    height="12" />
                            </button>
                        </div>
                        <p
                            v-if="auth.keys.length === 0"
                            class="tools-section-hint">
                            No SSH keys found — generate one below.
                        </p>
                    </div>
                </div>
            </label>
            <template v-if="activeKey">
                <div class="tools-actions ssh-key-actions">
                    <button
                        class="btn small"
                        :disabled="sshTesting"
                        :title="`Test ${activeKey.name} against the repo's SSH remote`"
                        @click="testKey(activeKey)">
                        <i-lucide-flask-conical
                            v-if="!sshTesting"
                            width="13"
                            height="13" />
                        <ThinkSpinner
                            v-else
                            compact />
                        Test
                    </button>
                    <button
                        class="btn small"
                        :title="`Copy ${activeKey.name} public key to clipboard`"
                        @click="copyPublicKey(activeKey)">
                        <i-lucide-copy
                            width="13"
                            height="13" />
                        Copy
                    </button>
                </div>
                <span
                    v-if="sshTestResult"
                    class="ai-test-result"
                    :class="sshTestResult.ok ? 'ok' : 'err'"
                    >{{ sshTestResult.message }}</span
                >
            </template>
        </div>

        <div class="tools-section">
            <strong class="tools-section-title">Generate new key</strong>
            <label class="ai-field">
                <span>File name</span>
                <div class="ai-token-row">
                    <input
                        v-model="genName"
                        type="text"
                        placeholder="filename.pub"
                        autocomplete="off" />
                </div>
                <div
                    v-if="genNameError"
                    class="auth-gen-error">
                    {{ genNameError }}
                </div>
            </label>
            <label class="ai-field">
                <span>Comment (email)</span>
                <div class="ai-token-row">
                    <input
                        v-model="genComment"
                        type="text"
                        placeholder="you@example.com"
                        autocomplete="off" />
                </div>
            </label>
            <label class="ai-field">
                <span>Passphrase (optional, not stored)</span>
                <div class="ai-token-row">
                    <input
                        v-model="genPassphrase"
                        type="password"
                        placeholder="leave empty for no passphrase"
                        autocomplete="new-password" />
                    <button
                        class="btn success small"
                        :disabled="generating || !genName.trim() || genNameError !== null"
                        @click="generateKey()">
                        <ThinkSpinner
                            v-if="generating"
                            compact />
                        <i-lucide-plus
                            v-else
                            width="13"
                            height="13" />
                        Generate
                    </button>
                </div>
            </label>
            <div class="tools-actions">
                <button
                    class="btn small"
                    @click="openSshDir()">
                    <i-lucide-folder-open
                        width="13"
                        height="13" />
                    Open ~/.ssh
                </button>
            </div>
            <p class="tools-section-hint">
                Copy the public key to your host (e.g. GitHub → Settings → SSH keys, or GitLab → SSH Keys) then press Test to verify the
                connection.
            </p>
        </div>
    </template>

    <template v-else>
        <div class="tools-section">
            <strong class="tools-section-title">
                <i-lucide-user-round
                    width="13"
                    height="13" />
                GitHub account
            </strong>
            <div
                v-if="auth.githubUser"
                class="github-account">
                <img
                    v-if="auth.githubUser.avatarUrl"
                    class="github-avatar"
                    :src="auth.githubUser.avatarUrl"
                    :alt="auth.githubUser.login" />
                <div class="github-account-meta">
                    <strong>
                        {{ auth.githubUser.login }}
                        <span
                            v-if="auth.githubUser.name"
                            class="github-account-name"
                            >{{ auth.githubUser.name }}</span
                        >
                    </strong>
                    <small
                        v-if="auth.githubUser.bio"
                        class="github-account-bio"
                        >{{ auth.githubUser.bio }}</small
                    >
                    <small class="github-account-stats">
                        <i-lucide-folder-git-2
                            width="12"
                            height="12" />
                        {{ auth.githubUser.publicRepos }} repos
                        <span class="dot-sep">·</span>
                        <i-lucide-users
                            width="12"
                            height="12" />
                        {{ auth.githubUser.followers }} followers
                    </small>
                </div>
            </div>
            <p
                v-else
                class="tools-section-hint">
                Not signed in.
            </p>
            <p class="tools-section-hint">
                The token is used for HTTPS pushes/pulls to github.com and is stored locally in the app data folder.
            </p>
        </div>

        <div class="tools-section">
            <label class="ai-field">
                <span>Personal access token (scopes: repo)</span>
                <div class="ai-token-row">
                    <input
                        v-model="githubTokenDraft"
                        type="password"
                        placeholder="ghp_…"
                        autocomplete="off" />
                    <button
                        class="btn success small"
                        :disabled="!githubTokenDraft.trim() || githubBusy"
                        @click="saveGithubToken()">
                        <ThinkSpinner
                            v-if="githubBusy"
                            compact />
                        <i-lucide-check
                            v-else
                            width="13"
                            height="13" />
                        Verify &amp; save
                    </button>
                </div>
            </label>
            <div class="tools-actions">
                <button
                    class="btn small"
                    title="Opens your default browser to create a token"
                    @click="openTokenPage()">
                    <i-lucide-external-link
                        width="13"
                        height="13" />
                    Create token in browser
                </button>
                <button
                    v-if="auth.githubUser"
                    class="btn danger small"
                    @click="signOutGithub()">
                    <i-lucide-trash-2
                        width="13"
                        height="13" />
                    Sign out
                </button>
            </div>
        </div>
    </template>
</template>
