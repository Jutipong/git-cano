import { usePromptStore, type PromptOptions, type PromptResult } from '../stores/prompt'

export function promptDialog(options: PromptOptions): Promise<PromptResult | null> {
    return usePromptStore().request(options)
}
