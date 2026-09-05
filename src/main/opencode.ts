import * as fs from 'node:fs'
import * as path from 'node:path'

import { isFreeZenId, toGoModel } from '@shared/models'
import { app } from 'electron'

import { formatRepoIfConfigured, getChangesContext } from './git'
import { log } from './logger'

import type { AiConfig, AiContextScope, AiProvider, AiProviderConfig, AiTestResult, GoModel } from '@shared/types'

const BASE_URL = 'https://opencode.ai/zen/go/v1'
const GO_MODELS_URL = `${BASE_URL}/models`
/** Pay-as-you-go Zen catalog — same id-only shape; free lineup is discovered here live. */
const ZEN_MODELS_URL = 'https://opencode.ai/zen/v1/models'
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
        const provider: AiProvider = raw.provider === 'openrouter' ? 'openrouter' : raw.provider === 'none' ? 'none' : 'opencode-go'
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
            commitInstructions: typeof raw.commitInstructions === 'string' ? raw.commitInstructions : '',
        }
    } catch {
        return {
            provider: 'opencode-go',
            opencodeGo: { token: '', modelId: '', models: [] },
            openrouter: { token: '', modelId: '', models: [] },
            commitInstructions: '',
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
        provider: cfg.provider === 'openrouter' ? 'openrouter' : cfg.provider === 'none' ? 'none' : 'opencode-go',
        opencodeGo: cleanProvider(cfg.opencodeGo),
        openrouter: cleanProvider(cfg.openrouter),
        commitInstructions: typeof cfg.commitInstructions === 'string' ? cfg.commitInstructions.slice(0, 2000) : '',
    }
    const file = configPath()
    fs.writeFileSync(file, JSON.stringify(clean, null, 2))
    try {
        fs.chmodSync(file, 0o600)
    } catch {}
}

function familyOf(modelId: string): Family {
    // Catalog ids may carry a provider prefix (e.g. "openai/gpt-4o") — the family
    // depends on the bare model name only.
    const bare = modelId.includes('/') ? modelId.slice(modelId.lastIndexOf('/') + 1) : modelId
    if (/^(minimax|qwen)/i.test(bare)) return 'messages'
    if (/^(grok|gpt-|muse)/i.test(bare)) return 'responses'
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
    const data = json as { output_text?: unknown; output?: Array<{ type?: string; content?: Array<{ text?: unknown }> }> }
    if (typeof data.output_text === 'string') return data.output_text
    const items = Array.isArray(data.output) ? data.output : []
    // Prefer the assistant message item — the first content-bearing item can be a
    // reasoning summary on thinking models, which must never become the commit message.
    const message =
        items.find(item => item?.type === 'message' && Array.isArray(item.content)) ?? items.find(item => Array.isArray(item.content))
    return Array.isArray(message?.content) ? message.content.map(part => (typeof part.text === 'string' ? part.text : '')).join('') : ''
}

/** True when the model burned the whole output budget on thinking/reasoning (or a rambling answer) and left nothing usable. */
function isLengthCutoff(family: Family, json: unknown): boolean {
    if (family === 'chat') {
        const data = json as { choices?: { finish_reason?: string }[] }
        return data.choices?.[0]?.finish_reason === 'length'
    }
    if (family === 'messages') {
        const data = json as { stop_reason?: string }
        return data.stop_reason === 'max_tokens'
    }
    const data = json as { status?: string; incomplete_details?: { reason?: string } }
    return data.status === 'incomplete' && data.incomplete_details?.reason === 'max_output_tokens'
}

/** AbortControllers for in-flight model calls, keyed by repo path (or 'default'). Lets the renderer cancel a slow generation. */
const inflight = new Map<string, AbortController>()

export function cancelModelCall(key = 'default'): boolean {
    const controller = inflight.get(key)
    if (!controller) return false
    controller.abort()
    return true
}

async function callModel(
    provider: AiProvider,
    token: string,
    modelId: string,
    systemPrompt: string,
    userPrompt: string,
    opts: { maxTokens?: number; timeoutMs?: number; allowEmpty?: boolean; cancelKey?: string } = {}
): Promise<string> {
    const { timeoutMs = 60_000, allowEmpty = false } = opts
    let budget = opts.maxTokens ?? 1024
    const family = provider === 'openrouter' ? 'chat' : familyOf(modelId)
    const baseUrl = provider === 'openrouter' ? OPENROUTER_BASE_URL : BASE_URL
    const endpoint = provider === 'openrouter' ? `${baseUrl}/chat/completions` : endpointOf(family)
    log('debug', 'ai', `${provider} ${modelId} → ${family} ${endpoint} (budget ${budget})`)

    let canceler: AbortController | undefined
    if (opts.cancelKey) {
        canceler = new AbortController()
        inflight.set(opts.cancelKey, canceler)
    }
    try {
        let budgetDoubled = false
        for (let i = 0; i < EFFORT_FALLBACK.length; i++) {
            const effort = EFFORT_FALLBACK[i]
            const timeout = new AbortController()
            const timer = setTimeout(() => timeout.abort(), timeoutMs)
            const signal = canceler ? AbortSignal.any([timeout.signal, canceler.signal]) : timeout.signal
            let res: Response
            try {
                // Sequential by design: each retry depends on the previous failure.
                // oxlint-disable-next-line no-await-in-loop
                res = await fetch(endpoint, {
                    method: 'POST',
                    headers: {
                        'content-type': 'application/json',
                        authorization: `Bearer ${token}`,
                        ...(provider === 'openrouter'
                            ? { 'HTTP-Referer': 'https://github.com/jutipong/open-git', 'X-Title': 'Open Git' }
                            : {}),
                    },
                    body: JSON.stringify(buildBody(family, provider, modelId, systemPrompt, userPrompt, budget, effort)),
                    signal,
                })
            } catch (err) {
                if (canceler?.signal.aborted) throw new Error('Generation cancelled')
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
                if (isLengthCutoff(family, json)) {
                    // Thinking models can burn the whole budget on reasoning even at 'minimal' —
                    // downgrade the effort first, then try once with a doubled budget.
                    if (i < EFFORT_FALLBACK.length - 1) continue
                    if (!budgetDoubled && budget < 2048) {
                        budgetDoubled = true
                        budget = Math.min(budget * 2, 2048)
                        log('debug', 'ai', `length cutoff with reasoning off — retrying with budget ${budget}`)
                        i--
                        continue
                    }
                    throw new Error(
                        `Model ran out of output tokens before replying (finish_reason=length) — tried up to ${budget} tokens; try a non-thinking model`
                    )
                }
                // Raw body goes to the log file only — the dialog gets a clean message.
                log('warn', 'ai', `empty response from ${modelId}: ${text.slice(0, 200).replace(/\s+/g, ' ')}`)
                throw new Error('Model returned an empty response — try again or switch to a non-thinking model')
            }
            return content
        }
        throw new Error('Model request failed after exhausting reasoning-effort fallbacks')
    } finally {
        if (opts.cancelKey && canceler && inflight.get(opts.cancelKey) === canceler) inflight.delete(opts.cancelKey)
    }
}

export async function testConnection(provider: AiProvider, token: string, modelId: string): Promise<AiTestResult> {
    const cleanToken = String(token ?? '').trim()
    const cleanModel = String(modelId ?? '').trim()
    if (!cleanToken || !cleanModel) return { ok: false, message: 'Enter both a token and a model-id first' }
    try {
        // Production-like conditions (real budget, empty not allowed) so a passing
        // test means real generation is likely to work too.
        await callModel(provider, cleanToken, cleanModel, '', 'ping', { maxTokens: 128, timeoutMs: 30_000 })
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
- No markdown fences, no quotes. Respond in English.
- Output the message directly without showing your reasoning.`

function truncateForPrompt(text: string): string {
    const MAX = 16_000
    if (text.length <= MAX) return text
    // Cut on a line boundary so the model never sees a half-line of diff.
    const cut = text.lastIndexOf('\n', MAX)
    return `${text.slice(0, cut > 0 ? cut : MAX)}\n… (diff truncated)`
}

function stripFences(text: string): string {
    return text
        .replace(/^```(?:\w+)?\s*/i, '')
        .replace(/\s*```\s*$/, '')
        .trim()
}

/** Strip the wrappers models like to add (fences, one layer of surrounding quotes) without touching the message itself. */
function cleanModelMessage(text: string): string {
    const stripped = stripFences(text).trim()
    const quoted = /^([`'"])([\s\S]*)\1$/.exec(stripped)
    return (quoted ? quoted[2].trim() : stripped).slice(0, 2500)
}

export async function generateCommitMessage(formatFirst = false, scope: AiContextScope = 'staged', dir?: string): Promise<string> {
    const cfg = getConfig()
    if (cfg.provider === 'none') throw new Error('AI is disabled — select a provider in Settings first')
    const selected = cfg.provider === 'openrouter' ? cfg.openrouter : cfg.opencodeGo
    const token = selected.token.trim()
    const modelId = selected.modelId.trim()
    if (!token || !modelId)
        throw new Error(
            `No AI configured — set your ${cfg.provider === 'openrouter' ? 'OpenRouter API key' : 'OpenCode token'} and model-id in Settings first`
        )
    // The formatter only touches the worktree, so for the 'staged' scope its output
    // could never reach the message (Generate Only must not touch the index either) —
    // skip it instead of pointlessly dirtying the worktree.
    if (formatFirst && scope === 'all') await formatRepoIfConfigured(dir)
    const changes = await getChangesContext(scope, dir)
    if (!changes.trim()) throw new Error('No uncommitted changes to summarize')
    const extra = cfg.commitInstructions.trim().slice(0, 2000)
    const system = extra
        ? `${COMMIT_SYSTEM_PROMPT}\n\nAdditional user instructions (follow them unless they conflict with the format above):\n${extra}`
        : COMMIT_SYSTEM_PROMPT
    const prompt = `Write a single commit message for these uncommitted changes:\n\n${truncateForPrompt(changes)}`
    const content = await callModel(cfg.provider, token, modelId, system, prompt, {
        maxTokens: 512,
        timeoutMs: 30_000,
        cancelKey: dir ?? 'default',
    })
    return cleanModelMessage(content)
}

/** Last successfully fetched list (persisted per provider) — offline fallback so the picker is never empty. */
function lastKnownModels(provider: AiProvider): GoModel[] {
    const list = provider === 'openrouter' ? getConfig().openrouter.models : getConfig().opencodeGo.models
    return list.filter(model => model && typeof model.id === 'string')
}

export async function listModels(provider: AiProvider, token: string): Promise<GoModel[]> {
    if (provider === 'openrouter') {
        const cleanToken = String(token ?? '').trim()
        if (!cleanToken) throw new Error('Enter an OpenRouter API key first')
        const res = await fetch(OPENROUTER_MODELS_URL, { headers: { authorization: `Bearer ${cleanToken}` } })
        if (!res.ok) throw new Error(extractErrorDetail(await res.text().catch(() => ''), res.status))
        const json = (await res.json().catch(() => null)) as {
            data?: { id?: unknown; name?: unknown; pricing?: { prompt?: unknown; completion?: unknown } }[]
        } | null
        if (!Array.isArray(json?.data)) return lastKnownModels('openrouter')
        return json.data
            .filter(model => typeof model.id === 'string')
            .map(model => {
                const id = model.id as string
                const pricing = model.pricing
                const free = id.endsWith(':free') || (pricing?.prompt === '0' && pricing?.completion === '0')
                return {
                    id,
                    name: typeof model.name === 'string' ? model.name : id,
                    ...(free ? { free: true as const } : {}),
                }
            })
    }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 10_000)
    try {
        const fetchIds = async (url: string): Promise<string[]> => {
            try {
                const res = await fetch(url, { signal: controller.signal })
                if (!res.ok) return []
                const json = (await res.json().catch(() => null)) as { data?: { id?: unknown }[] } | null
                if (!Array.isArray(json?.data)) return []
                return json.data.map(model => (typeof model.id === 'string' ? model.id : '')).filter(Boolean)
            } catch {
                // One catalog failing must not discard the other.
                return []
            }
        }
        // Subscription catalog first; the free lineup is discovered live from the
        // Zen catalog (same provider family — everything is stored under this
        // provider only, never mixed into other providers).
        const [goIds, zenIds] = await Promise.all([fetchIds(GO_MODELS_URL), fetchIds(ZEN_MODELS_URL)])
        const seen = new Set(goIds)
        const merged = [...goIds]
        for (const id of zenIds) {
            if (!seen.has(id) && isFreeZenId(id)) {
                seen.add(id)
                merged.push(id)
            }
        }
        if (merged.length === 0) return lastKnownModels('opencode-go')
        return merged.map(toGoModel)
    } catch {
        return lastKnownModels('opencode-go')
    } finally {
        clearTimeout(timer)
    }
}
