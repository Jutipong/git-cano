export interface PromptOptions {
    title: string
    message?: string
    placeholder?: string
    defaultValue?: string
    confirmLabel?: string
    existing?: string[]
}

export interface PromptRequest extends PromptOptions {
    resolve: (value: string | null) => void
}

export const usePromptStore = defineStore('prompt', () => {
    const current = ref<PromptRequest | null>(null)

    function request(options: PromptOptions): Promise<string | null> {
        return new Promise(resolve => {
            current.value = { ...options, resolve }
        })
    }

    function settle(value: string | null): void {
        current.value?.resolve(value)
        current.value = null
    }

    return { current, request, settle }
})
