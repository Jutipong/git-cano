<script setup lang="ts">
    import ILucideArchive from '~icons/lucide/archive'
    import ILucideGitBranch from '~icons/lucide/git-branch'
    import ILucideGlobe from '~icons/lucide/globe'
    import ILucideSettings from '~icons/lucide/settings'
    import ILucideTag from '~icons/lucide/tag'

    import canoIcon from '../assets/cano.svg'
    import { useRepoStore } from '../stores/repo'
    import type { SidebarSectionKey } from '../stores/ui'

    defineProps<{ activeSection: SidebarSectionKey | null; open: boolean }>()
    const emit = defineEmits<{
        (e: 'open-section', key: SidebarSectionKey): void
    }>()

    const repoStore = useRepoStore()
    const sections: Array<{ key: SidebarSectionKey; label: string; icon: typeof ILucideGitBranch }> = [
        { key: 'local', label: 'Local branches', icon: ILucideGitBranch },
        { key: 'remote', label: 'Remote branches', icon: ILucideGlobe },
        { key: 'tags', label: 'Tags', icon: ILucideTag },
        { key: 'stashes', label: 'Stashes', icon: ILucideArchive },
    ]
</script>

<template>
    <aside
        class="sidebar-rail"
        aria-label="Sidebar (mini)">
        <img
            :src="canoIcon"
            alt="Git Cano"
            title="Git Cano"
            class="sidebar-rail-brand" />
        <button
            v-for="section in sections"
            :key="section.key"
            type="button"
            class="sidebar-rail-btn"
            :class="{ active: open && activeSection === section.key }"
            :title="section.label"
            :aria-label="section.label"
            :aria-expanded="open && activeSection === section.key"
            @click="emit('open-section', section.key)">
            <component
                :is="section.icon"
                width="19"
                height="19" />
        </button>
        <span class="sidebar-rail-spacer" />
        <button
            type="button"
            class="sidebar-rail-btn"
            title="Settings"
            aria-label="Settings"
            @click="repoStore.toolsOpen = true">
            <i-lucide-settings
                width="18"
                height="18" />
        </button>
    </aside>
</template>
