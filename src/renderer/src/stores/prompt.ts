import type { LocalChangesMode } from '@shared/types'

export interface PromptOptions {
    title: string
    message?: string
    placeholder?: string
    defaultValue?: string
    confirmLabel?: string
    existing?: string[]
    /** When set, the dialog shows branch-creation options (check out / local changes). */
    branchOptions?: { checkout: boolean; localChanges: LocalChangesMode }
}

export interface PromptResult {
    name: string
    checkout: boolean
    localChanges: LocalChangesMode
}

export interface PromptRequest extends PromptOptions {
    resolve: (value: PromptResult | null) => void
}

export const usePromptStore = defineStore('prompt', () => {
    const current = ref<PromptRequest | null>(null)

    function request(options: PromptOptions): Promise<PromptResult | null> {
        return new Promise(resolve => {
            current.value = { ...options, resolve }
        })
    }

    function settle(value: PromptResult | null): void {
        current.value?.resolve(value)
        current.value = null
    }

    return { current, request, settle }
})
