import { defineStore } from 'pinia'
import { ref } from 'vue'
export interface ConfirmOptions {
    title?: string
    message: string
    confirmLabel?: string
    danger?: boolean
    confirmIcon?: 'reset' | 'delete' | 'force-push'
    /** Visual "from → to" diagram (e.g. merge/reset direction) rendered above the message. */
    flow?: { from: string; to: string; label?: string }
    /** Pre-computed check result shown as a status row (✓ ok / ⚠ warn / dim unknown). */
    status?: { kind: 'ok' | 'warn' | 'unknown'; text: string }
    /** Optional checkbox above the actions — only honored by confirmDialogWithOption(). */
    checkOption?: { label: string; defaultChecked?: boolean }
}

export interface ConfirmResult {
    ok: boolean
    checked: boolean
}

export interface ConfirmRequest extends ConfirmOptions {
    resolve: (result: ConfirmResult) => void
    checked: boolean
}

export const useConfirmStore = defineStore('confirm', () => {
    const current = ref<ConfirmRequest | null>(null)

    function open(options: ConfirmOptions, resolve: (result: ConfirmResult) => void) {
        current.value = { ...options, checked: options.checkOption?.defaultChecked ?? false, resolve }
    }

    function request(options: ConfirmOptions): Promise<boolean> {
        return new Promise(resolve => {
            open(options, result => resolve(result.ok))
        })
    }

    function requestWithOption(options: ConfirmOptions): Promise<ConfirmResult> {
        return new Promise(resolve => {
            open(options, resolve)
        })
    }

    function settle(ok: boolean): void {
        const request = current.value
        current.value = null
        request?.resolve({ ok, checked: request.checked })
    }

    return { current, request, requestWithOption, settle }
})
