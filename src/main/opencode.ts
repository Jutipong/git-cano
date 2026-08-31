import * as fs from 'node:fs'
import * as path from 'node:path'

import { toGoModel } from '@shared/models'
import { app } from 'electron'

import { formatRepoIfConfigured, getChangesContext } from './git'
import { log } from './logger'

import type { AiConfig, AiContextScope, AiProvider, AiProviderConfig, AiTestResult, GoModel } from '@shared/types'

const BASE_URL = 'https://opencode.ai/zen/go/v1'
const GO_MODELS_URL = `${BASE_URL}/models`
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'
const OPENROUTER_MODELS_URL = `${OPENROUTER_BASE_URL}/models`
const CONFIG_FILE = 'opencode.json'

type Family = 'chat' | 'messages' | 'responses'

function configPath(): string {
    return path.join(app.getPath('userData'), CONFIG_FILE)
}

export function getConfig(): AiConfig {
    try {
        const raw = JSON.parse(fs.readFileSync(configPath(), 'utf8')) as Partial<AiConfig> & AiProviderConfig
        const provider = raw.provider === 'openrouter' ? raw.provider : 'opencode-go'
        const hasLegacyConfig = typeof raw.token === 'string' || typeof raw.modelId === 'string'
        const clean = (value: unknown): AiProviderConfig => {
            const cfg = value && typeof value === 'object' ? (value as Partial<AiProviderConfig>) : {}
            return {
                token: typeof cfg.token === 'string' ? cfg.token : '',
                modelId: typeof cfg.modelId === 'string' ? cfg.modelId : '',
                models: Array.isArray(cfg.models)
                    ? cfg.models.filter(
                          model => model && typeof model === 'object' && typeof model.id === 'string' && typeof model.name === 'string'
                      )
                    : [],
            }
        }
        return {
            provider,
            opencodeGo: clean(raw.opencodeGo ?? (hasLegacyConfig ? raw : undefined)),
            openrouter: clean(raw.openrouter),
        }
    } catch {
        return {
            provider: 'opencode-go',
            opencodeGo: { token: '', modelId: '', models: [] },
            openrouter: { token: '', modelId: '', models: [] },
        }
    }
}

export function saveConfig(cfg: AiConfig): void {
    const cleanProvider = (value: AiProviderConfig | undefined): AiProviderConfig => ({
        token: String(value?.token ?? ''),
        modelId: String(value?.modelId ?? ''),
        models: Array.isArray(value?.models)
            ? value.models.filter(model => typeof model?.id === 'string' && typeof model.name === 'string')
            : [],
    })
    const clean: AiConfig = {
        provider: cfg.provider === 'openrouter' ? 'openrouter' : 'opencode-go',
        opencodeGo: cleanProvider(cfg.opencodeGo),
        openrouter: cleanProvider(cfg.openrouter),
    }
    const file = configPath()
    fs.writeFileSync(file, JSON.stringify(clean, null, 2))
    try {
        fs.chmodSync(file, 0o600)
    } catch {}
}

function familyOf(modelId: string): Family {
    if (/^(minimax|qwen)/i.test(modelId)) return 'messages'
    if (/^(grok|gpt-|muse)/i.test(modelId)) return 'responses'
    return 'chat'
}

function endpointOf(family: Family): string {
    if (family === 'messages') return `${BASE_URL}/messages`
    if (family === 'responses') return `${BASE_URL}/responses`
    return `${BASE_URL}/chat/completions`
}

// Reasoning-effort cap: keeps thinking models from burning the output budget on
// reasoning (finish_reason=length) for short answers like commit messages.
// 'minimal' is the fastest; fall back to 'low' then to no reasoning param at all
// for models/endpoints that reject 'minimal'.
type EffortLevel = 'minimal' | 'low' | 'none'

const EFFORT_FALLBACK: EffortLevel[] = ['minimal', 'low', 'none']

function buildBody(
    family: Family,
    provider: AiProvider,
    modelId: string,
    systemPrompt: string,
    userPrompt: string,
    maxTokens: number,
    effort: EffortLevel
): Record<string, unknown> {
    if (family === 'responses') {
        const body: Record<string, unknown> = { model: modelId, input: userPrompt, max_output_tokens: maxTokens }
        if (effort !== 'none') body.reasoning = { effort }
        if (systemPrompt) body.instructions = systemPrompt
        return body
    }
    const messages: { role: string; content: string }[] = []
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt })
    messages.push({ role: 'user', content: userPrompt })
    const body: Record<string, unknown> = { model: modelId, max_tokens: maxTokens, messages }
    // 'messages' family (Anthropic-style) has no effort knob — thinking is opt-in
    // via a `thinking` field we deliberately omit.
    if (family === 'chat' && effort !== 'none') {
        if (provider === 'openrouter') body.reasoning = { effort }
        else body.reasoning_effort = effort
    }
    return body
}

function extractErrorDetail(text: string, status: number): string {
    let message = ''
    try {
        const json = JSON.parse(text) as { error?: { message?: string } }
        message = json.error?.message ?? ''
    } catch {}
    const fallback: Record<number, string> = {
        401: 'Invalid API token (401 Unauthorized)',
        403: 'Access denied (403) — check your OpenCode subscription',
        404: 'Model not found (404) — check the model-id matches the OpenCode Go catalog',
        429: 'Usage limit reached (429) — wait a bit or check your OpenCode Go usage',
    }
    return (message || fallback[status] || `Request failed (HTTP ${status})`).slice(0, 300)
}

function extractContent(family: Family, json: unknown): string {
    if (family === 'chat') {
        const data = json as { choices?: { message?: { content?: unknown } }[] }
        const raw = data.choices?.[0]?.message?.content
        if (typeof raw === 'string') return raw
        if (Array.isArray(raw)) {
            return raw
                .map(part =>
                    part && typeof part === 'object' && 'text' in part && typeof (part as { text?: unknown }).text === 'string'
                        ? (part as { text: string }).text
                        : ''
                )
                .join('')
        }
        return ''
    }
    if (family === 'messages') {
        const data = json as { content?: { text?: unknown }[] }
        return Array.isArray(data.content) ? data.content.map(part => (typeof part.text === 'string' ? part.text : '')).join('') : ''
    }
    const data = json as { output_text?: unknown; output?: Array<{ content?: Array<{ text?: unknown }> }> }
    if (typeof data.output_text === 'string') return data.output_text
    const message = data.output?.find(item => Array.isArray(item.content))
    return Array.isArray(message?.content) ? message.content.map(part => (typeof part.text === 'string' ? part.text : '')).join('') : ''
}

async function callModel(
    provider: AiProvider,
    token: string,
    modelId: string,
    systemPrompt: string,
    userPrompt: string,
    opts: { maxTokens?: number; timeoutMs?: number; allowEmpty?: boolean } = {}
): Promise<string> {
    const { maxTokens = 1024, timeoutMs = 60_000, allowEmpty = false } = opts
    const family = provider === 'openrouter' ? 'chat' : familyOf(modelId)
    const baseUrl = provider === 'openrouter' ? OPENROUTER_BASE_URL : BASE_URL
    const endpoint = provider === 'openrouter' ? `${baseUrl}/chat/completions` : endpointOf(family)

    for (let i = 0; i < EFFORT_FALLBACK.length; i++) {
        const effort = EFFORT_FALLBACK[i]
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), timeoutMs)
        let res: Response
        try {
            // Sequential by design: each retry depends on the previous failure.
            // oxlint-disable-next-line no-await-in-loop
            res = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    authorization: `Bearer ${token}`,
                    ...(family === 'messages' ? { 'x-api-key': token } : {}),
                    ...(provider === 'openrouter' ? { 'HTTP-Referer': 'https://github.com/jutipong/open-git', 'X-Title': 'Open Git' } : {}),
                },
                body: JSON.stringify(buildBody(family, provider, modelId, systemPrompt, userPrompt, maxTokens, effort)),
                signal: controller.signal,
            })
        } catch (err) {
            throw new Error(
                err instanceof Error && err.name === 'AbortError' ? 'Request timed out' : err instanceof Error ? err.message : String(err)
            )
        } finally {
            clearTimeout(timer)
        }

        const text =
            // oxlint-disable-next-line no-await-in-loop
            await res.text().catch(() => '')
        // Endpoint/model rejected the effort param (e.g. unknown 'minimal') — retry lower.
        if (!res.ok && res.status === 400 && /effort|reasoning/i.test(text) && i < EFFORT_FALLBACK.length - 1) continue
        if (!res.ok) throw new Error(extractErrorDetail(text, res.status))
        let json: unknown
        try {
            json = JSON.parse(text)
        } catch {
            throw new Error('Invalid response from the model API')
        }
        const content = extractContent(family, json).trim()
        if (!content && !allowEmpty) {
            const finish = (json as { choices?: { finish_reason?: string }[] }).choices?.[0]?.finish_reason
            if (finish === 'length') {
                throw new Error(
                    'Model ran out of output tokens before replying (finish_reason=length) — increase the token budget or try a non-thinking model'
                )
            }
            throw new Error(`Model returned an empty response (${text.slice(0, 200)})`)
        }
        return content
    }
    throw new Error('Model request failed after exhausting reasoning-effort fallbacks')
}

export async function testConnection(provider: AiProvider, token: string, modelId: string): Promise<AiTestResult> {
    const cleanToken = String(token ?? '').trim()
    const cleanModel = String(modelId ?? '').trim()
    if (!cleanToken || !cleanModel) return { ok: false, message: 'Enter both a token and a model-id first' }
    try {
        await callModel(provider, cleanToken, cleanModel, '', 'ping', { maxTokens: 64, timeoutMs: 30_000, allowEmpty: true })
        log('info', 'ai', `test ok (${cleanModel})`)
        return { ok: true, message: 'Connected — token & model are valid' }
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        log('warn', 'ai', `test failed (${cleanModel}): ${message.slice(0, 200)}`)
        return { ok: false, message }
    }
}

const COMMIT_SYSTEM_PROMPT = `You are a git commit message generator. Output ONE Conventional Commits message for the given diff. Answer with the commit message ONLY — no preamble, no explanation.

Format: <type>(<optional scope>): <description>

Type priority: fix > feat > test > style > docs > build > ops > chore > perf > refactor.

Style rules:
- Default: ONE line only. Add a short body ONLY if the diff clearly contains 2+ unrelated concerns (max 3 bullet lines, no paragraphs).
- Subject: imperative mood, lowercase start, no trailing period, ≤72 chars (ideal 50). Keep it terse.
- Plain, simple wording a teammate skims in 2 seconds. No jargon, no file lists, no issue IDs, no wordiness.
- Breaking change → "!" before the colon (e.g. "feat!: ...").
- Describe only what the diff actually shows; never invent changes.
- No markdown fences, no quotes. Respond in English.`

function truncateForPrompt(text: string): string {
    const MAX = 16_000
    if (text.length <= MAX) return text
    return `${text.slice(0, MAX)}\n… (diff truncated)`
}

function stripFences(text: string): string {
    return text
        .replace(/^```(?:\w+)?\s*/i, '')
        .replace(/\s*```\s*$/, '')
        .trim()
}

export async function generateCommitMessage(formatFirst = false, scope: AiContextScope = 'staged'): Promise<string> {
    if (formatFirst) await formatRepoIfConfigured()
    const cfg = getConfig()
    const active = cfg.provider === 'openrouter' ? cfg.openrouter : cfg.opencodeGo
    if (!active.token || !active.modelId)
        throw new Error(
            `No AI configured — set your ${cfg.provider === 'openrouter' ? 'OpenRouter API key' : 'OpenCode token'} and model-id in Settings first`
        )
    const changes = await getChangesContext(scope)
    if (!changes.trim()) throw new Error('No uncommitted changes to summarize')
    const prompt = `Write a single commit message for these uncommitted changes:\n\n${truncateForPrompt(changes)}`
    const content = await callModel(cfg.provider, active.token, active.modelId, COMMIT_SYSTEM_PROMPT, prompt, {
        maxTokens: 200,
        timeoutMs: 30_000,
    })
    return stripFences(content).slice(0, 2500)
}

const FALLBACK_MODELS = [
    'minimax-m3',
    'minimax-m2.7',
    'minimax-m2.5',
    'kimi-k3',
    'kimi-k2.7-code',
    'kimi-k2.6',
    'kimi-k2.5',
    'longcat-2.0',
    'glm-5.3-flash',
    'glm-5.3',
    'glm-5.2',
    'glm-5.1',
    'glm-5',
    'deepseek-v4-pro',
    'deepseek-v4-flash',
    'deepseek-v4-flash-vision-exp',
    'qwen3.8-max',
    'qwen3.8-flash',
    'qwen3.7-max',
    'qwen3.7-plus',
    'qwen3.6-plus',
    'qwen3.5-plus',
    'mimo-v2.5-pro',
    'mimo-v2.5',
    'mimo-v2-pro',
    'mimo-v2-omni',
    'hy3',
    'hy3-preview',
    'gpt-5.6-luna',
    'grok-4.6',
    'grok-4.5',
    'muse-spark-1.2-contributor',
]

export async function listModels(provider: AiProvider, token: string): Promise<GoModel[]> {
    if (provider === 'openrouter') {
        const cleanToken = String(token ?? '').trim()
        if (!cleanToken) throw new Error('Enter an OpenRouter API key first')
        const res = await fetch(OPENROUTER_MODELS_URL, { headers: { authorization: `Bearer ${cleanToken}` } })
        if (!res.ok) throw new Error(extractErrorDetail(await res.text().catch(() => ''), res.status))
        const json = (await res.json().catch(() => null)) as { data?: { id?: unknown; name?: unknown }[] } | null
        if (!Array.isArray(json?.data)) return []
        return json.data
            .filter(model => typeof model.id === 'string')
            .map(model => ({ id: model.id as string, name: typeof model.name === 'string' ? model.name : (model.id as string) }))
    }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 10_000)
    try {
        const res = await fetch(GO_MODELS_URL, { signal: controller.signal })
        if (!res.ok) return FALLBACK_MODELS.map(toGoModel)
        const json = (await res.json().catch(() => null)) as { data?: { id?: unknown }[] } | null
        if (!Array.isArray(json?.data) || json.data.length === 0) return FALLBACK_MODELS.map(toGoModel)
        return json.data
            .map(model => (typeof model.id === 'string' ? model.id : ''))
            .filter(Boolean)
            .map(toGoModel)
    } catch {
        return FALLBACK_MODELS.map(toGoModel)
    } finally {
        clearTimeout(timer)
    }
}
