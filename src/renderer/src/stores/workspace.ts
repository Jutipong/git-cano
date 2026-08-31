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

        function setSession(name: string, session: WorkspaceSession) {
            sessions.value = { ...sessions.value, [name]: session }
        }

        function getSession(name: string): WorkspaceSession | null {
            return sessions.value[name] ?? null
        }

        return { names, active, sessions, add, remove, select, setSession, getSession }
    },
    {
        persist: {
            pick: ['names', 'active', 'sessions'],
        },
    }
)
