/* ---- OpenCode Zen Go model display names ----

 * The live /models endpoint only returns raw ids (OpenAI-style
 * { id, object, created, owned_by }) — the human-readable names come from the
 * Go docs table. Shared between main (listGoModels) and renderer (FilePanel
 * badge) so the dropdown and the commit-message counter can never drift.
 * Unlisted ids fall back to the raw id so the UI never shows a blank label. */

import type { GoModel } from './types'

export const MODEL_NAMES: Record<string, string> = {
    'grok-4.6': 'Grok 4.6',
    'grok-4.5': 'Grok 4.5',
    'gpt-5.6-luna': 'GPT 5.6 Luna',
    'glm-5.3-flash': 'GLM-5.3-Flash',
    'glm-5.3': 'GLM-5.3',
    'glm-5.2': 'GLM-5.2',
    'glm-5.1': 'GLM-5.1',
    'glm-5': 'GLM-5',
    'kimi-k3': 'Kimi K3',
    'kimi-k2.7-code': 'Kimi K2.7 Code',
    'kimi-k2.6': 'Kimi K2.6',
    'kimi-k2.5': 'Kimi K2.5',
    'longcat-2.0': 'LongCat-2.0',
    'deepseek-v4-pro': 'DeepSeek V4 Pro',
    'deepseek-v4-flash': 'DeepSeek V4 Flash',
    'deepseek-v4-flash-vision-exp': 'DeepSeek V4 Flash Vision Exp',
    'minimax-m3': 'MiniMax M3',
    'minimax-m2.7': 'MiniMax M2.7',
    'minimax-m2.5': 'MiniMax M2.5',
    'mimo-v2.5-pro': 'MiMo-V2.5-Pro',
    'mimo-v2.5': 'MiMo-V2.5',
    'muse-spark-1.2-contributor': 'Muse Spark 1.2 Contributor',
    'qwen3.8-max': 'Qwen3.8 Max',
    'qwen3.8-flash': 'Qwen3.8 Flash',
    'qwen3.7-max': 'Qwen3.7 Max',
    'qwen3.7-plus': 'Qwen3.7 Plus',
    'qwen3.6-plus': 'Qwen3.6 Plus',
    'qwen3.5-plus': 'Qwen3.5 Plus',
    'hy3': 'Hy3',
}

/** Resolve a Go model id to its human-readable label (falls back to the raw id). */
export function modelName(id: string): string {
    return MODEL_NAMES[id] ?? id
}

/** Build a dropdown entry for a Go model id. */
export function toGoModel(id: string): GoModel {
    return { id, name: modelName(id) }
}