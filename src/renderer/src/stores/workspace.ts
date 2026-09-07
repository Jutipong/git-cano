export interface WorkspaceSession {
    paths: string[]
    active: number
}

export const DEFAULT_WORKSPACE = 'Main'

export const useWorkspaceStore = defineStore(
    'workspace',
    () => {
        const names = ref<string[]>([DEFAULT_WORKSPACE])
        const active = ref<string>(DEFAULT_WORKSPACE)
        const sessions = ref<Record<string, WorkspaceSession>>({})

        watchEffect(() => {
            if (!names.value.includes(active.value)) active.value = names.value[0] ?? DEFAULT_WORKSPACE
        })

        /** Adds a workspace name (case-insensitive duplicate check). Returns the stored name or null when it already exists. */
        function add(name: string): string | null {
            const trimmed = name.trim()
            if (!trimmed) return null
            const lower = trimmed.toLowerCase()
            const existing = names.value.find(candidate => candidate.toLowerCase() === lower)
            if (existing) return null
            names.value = [...names.value, trimmed]
            return trimmed
        }

        function select(name: string) {
            if (names.value.includes(name)) active.value = name
        }

        /**
         * Removes a workspace together with its session. Always keeps at least one workspace; if the active one is removed, falls back to
         * the first remaining. Returns whether the workspace was removed.
         */
        function remove(name: string): boolean {
            if (!names.value.includes(name)) return false
            if (names.value.length <= 1) return false
            names.value = names.value.filter(candidate => candidate !== name)
            if (name in sessions.value) {
                const nextSessions = { ...sessions.value }
                delete nextSessions[name]
                sessions.value = nextSessions
            }
            if (active.value === name) active.value = names.value[0] ?? DEFAULT_WORKSPACE
            return true
        }

        /**
         * Renames a workspace keeping its session (case-insensitive duplicate check). Returns the stored name or null when the new name is
         * empty/duplicate or the old name is unknown.
         */
        function rename(oldName: string, newName: string): string | null {
            const trimmed = newName.trim()
            if (!trimmed || !names.value.includes(oldName)) return null
            const lower = trimmed.toLowerCase()
            const duplicate = names.value.some(candidate => candidate !== oldName && candidate.toLowerCase() === lower)
            if (duplicate) return null
            names.value = names.value.map(candidate => (candidate === oldName ? trimmed : candidate))
            if (oldName in sessions.value) {
                const nextSessions = { ...sessions.value }
                nextSessions[trimmed] = nextSessions[oldName]
                if (trimmed !== oldName) delete nextSessions[oldName]
                sessions.value = nextSessions
            }
            if (active.value === oldName) active.value = trimmed
            return trimmed
        }

        function setSession(name: string, session: WorkspaceSession) {
            sessions.value = { ...sessions.value, [name]: session }
        }

        function reorder(from: number, to: number) {
            if (from === to || from < 0 || to < 0 || from >= names.value.length || to >= names.value.length) return
            const [moved] = names.value.splice(from, 1)
            names.value.splice(to, 0, moved)
        }

        function getSession(name: string): WorkspaceSession | null {
            return sessions.value[name] ?? null
        }

        return { names, active, sessions, add, remove, rename, select, setSession, getSession, reorder }
    },
    {
        persist: {
            pick: ['names', 'active', 'sessions'],
        },
    }
)
