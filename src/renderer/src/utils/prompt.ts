import { usePromptStore, type PromptOptions } from '../stores/prompt'

/** Promise-based styled text-input dialog (replaces window.prompt, which Electron does not support) */
export function promptDialog(options: PromptOptions): Promise<string | null> {
    return usePromptStore().request(options)
}
