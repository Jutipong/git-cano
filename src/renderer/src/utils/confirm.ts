import { useConfirmStore, type ConfirmOptions } from '../stores/confirm'

export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
    return useConfirmStore().request(options)
}