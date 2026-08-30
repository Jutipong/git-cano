import { usePromptStore, type PromptOptions } from '../stores/prompt'

export function promptDialog(options: PromptOptions): Promise<string | null> {
    return usePromptStore().request(options)
}
