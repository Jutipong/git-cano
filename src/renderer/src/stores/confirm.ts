export interface ConfirmOptions {
    title?: string
    message: string
    confirmLabel?: string
    danger?: boolean
}

export interface ConfirmRequest extends ConfirmOptions {
    resolve: (ok: boolean) => void
}

export const useConfirmStore = defineStore('confirm', () => {
    const current = ref<ConfirmRequest | null>(null)

    /** open the dialog; the returned promise resolves with the user's choice */
    function request(options: ConfirmOptions): Promise<boolean> {
        return new Promise(resolve => {
            current.value = { ...options, resolve }
        })
    }

    /** resolve the pending request and close the dialog */
    function settle(ok: boolean): void {
        current.value?.resolve(ok)
        current.value = null
    }

    return { current, request, settle }
})