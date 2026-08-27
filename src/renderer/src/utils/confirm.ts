import { useConfirmStore, type ConfirmOptions } from '../stores/confirm'

/** Promise-based styled confirmation dialog (replaces window.confirm) */
export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
    return useConfirmStore().request(options)
}