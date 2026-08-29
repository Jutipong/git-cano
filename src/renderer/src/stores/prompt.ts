export interface PromptOptions {
    title: string
    /** secondary line under the title (e.g. the commit the branch lands on) */
    message?: string
    placeholder?: string
    defaultValue?: string
    confirmLabel?: string
    /** names that already exist — typing one of these shows a live duplicate error */
    existing?: string[]
}

export interface PromptRequest extends PromptOptions {
    resolve: (value: string | null) => void
}

export const usePromptStore = defineStore('prompt', () => {
    const current = ref<PromptRequest | null>(null)

    /** open the dialog; the returned promise resolves with the typed text (null = cancelled) */
    function request(options: PromptOptions): Promise<string | null> {
        return new Promise(resolve => {
            current.value = { ...options, resolve }
        })
    }

    /** resolve the pending request and close the dialog */
    function settle(value: string | null): void {
        current.value?.resolve(value)
        current.value = null
    }

    return { current, request, settle }
})
