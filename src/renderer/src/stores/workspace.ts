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

        function setSession(name: string, session: WorkspaceSession) {
            sessions.value = { ...sessions.value, [name]: session }
        }

        function getSession(name: string): WorkspaceSession | null {
            return sessions.value[name] ?? null
        }

        return { names, active, sessions, add, select, setSession, getSession }
    },
    {
        persist: {
            pick: ['names', 'active', 'sessions'],
        },
    }
)
