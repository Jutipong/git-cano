import { useConfirmStore, type ConfirmOptions, type ConfirmResult } from '../stores/confirm'

export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
    return useConfirmStore().request(options)
}

export function confirmDialogWithOption(options: ConfirmOptions): Promise<ConfirmResult> {
    return useConfirmStore().requestWithOption(options)
}
