import type { LocalChangesMode } from '@shared/types'

export interface SwitchRequest {
    branch: string
    resolve: (mode: LocalChangesMode | null) => void
}

export const useSwitchStore = defineStore('switch', () => {
    const current = ref<SwitchRequest | null>(null)

    function request(branch: string): Promise<LocalChangesMode | null> {
        return new Promise(resolve => {
            current.value = { branch, resolve }
        })
    }

    function settle(mode: LocalChangesMode | null): void {
        current.value?.resolve(mode)
        current.value = null
    }

    return { current, request, settle }
})
