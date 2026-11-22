import { cancelModelCall, generateCommitMessage, getConfig, listModels, saveConfig, testConnection } from '../opencode'
import { handleSensitive, handleSensitiveRepo } from './core'

/** AI slice IPC: provider config, model catalog, connection test and commit-message generation. */

export function registerAiIpc(): void {
    handleSensitive('ai:getConfig', () => getConfig())
    handleSensitive('ai:saveConfig', (_cfg: unknown) => saveConfig(_cfg as never))
    handleSensitive('ai:test', (provider: string, token: string, modelId: string) =>
        testConnection(provider as 'opencode-go' | 'openrouter', token as string, modelId as string)
    )
    handleSensitiveRepo('ai:generateCommitMessage', (shouldFormat: boolean, scope: string, _dir?: string) =>
        generateCommitMessage(
            Boolean(shouldFormat),
            scope === 'all' ? 'all' : 'staged',
            typeof _dir === 'string' && _dir ? (_dir as string) : undefined
        )
    )
    handleSensitive('ai:listModels', (provider: string, token: string) =>
        listModels(provider as 'opencode-go' | 'openrouter', token as string)
    )
    handleSensitive('ai:cancelGenerate', (_dir?: string) =>
        cancelModelCall(typeof _dir === 'string' && _dir ? (_dir as string) : 'default')
    )
}
