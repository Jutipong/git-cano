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

    function request(options: ConfirmOptions): Promise<boolean> {
        return new Promise(resolve => {
            current.value = { ...options, resolve }
        })
    }

    function settle(ok: boolean): void {
        current.value?.resolve(ok)
        current.value = null
    }

    return { current, request, settle }
})