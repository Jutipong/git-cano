import * as fs from 'node:fs'
import * as path from 'node:path'

import { app } from 'electron'

import type { AiConfig, AiTestResult } from '@shared/types'

import { getChangesContext } from './git'
import { log } from './logger'

/* ---- OpenCode Zen Go provider: https://opencode.ai/docs/th/go/ ---- */

const BASE_URL = 'https://opencode.ai/zen/go/v1'
const GO_MODELS_URL = `${BASE_URL}/models`
const CONFIG_FILE = 'opencode.json'

/** Protocol family each Go model speaks — see the endpoints table in the Go docs. */
type Family = 'chat' | 'messages' | 'responses'

function configPath(): string {
    return path.join(app.getPath('userData'), CONFIG_FILE)
}

export function getConfig(): AiConfig {
    try {
        const raw = JSON.parse(fs.readFileSync(configPath(), 'utf8')) as Partial<AiConfig>
        return {
            token: typeof raw.token === 'string' ? raw.token : '',
            modelId: typeof raw.modelId === 'string' ? raw.modelId : '',
        }
    } catch {
        return { token: '', modelId: '' }
    }
}

export function saveConfig(cfg: AiConfig): void {
    const clean = { token: String(cfg.token ?? ''), modelId: String(cfg.modelId ?? '') }
    const file = configPath()
    fs.writeFileSync(file, JSON.stringify(clean, null, 2))
    try {
        // keep the token file private to the current user
        fs.chmodSync(file, 0o600)
    } catch {
        /* non-unix filesystems may ignore chmod */
    }
}

/** Map a Go model id to its protocol family. Falls back to OpenAI-compatible chat,
 * which covers the majority of Go coding models (GLM/Kimi/DeepSeek/MiMo/LongCat/Hy3). */
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

function buildBody(
    family: Family,
    modelId: string,
    systemPrompt: string,
    userPrompt: string,
    maxTokens: number
): Record<string, unknown> {
    if (family === 'responses') {
        const body: Record<string, unknown> = { model: modelId, input: userPrompt, max_output_tokens: maxTokens }
        if (systemPrompt) body.instructions = systemPrompt
        return body
    }
    const messages: { role: string; content: string }[] = []
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt })
    messages.push({ role: 'user', content: userPrompt })
    return { model: modelId, max_tokens: maxTokens, messages }
}

function extractErrorDetail(text: string, status: number): string {
    let message = ''
    try {
        const json = JSON.parse(text) as { error?: { message?: string } }
        message = json.error?.message ?? ''
    } catch {
        /* non-JSON error body */
    }
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
        return typeof data.choices?.[0]?.message?.content === 'string' ? data.choices[0].message.content : ''
    }
    if (family === 'messages') {
        const data = json as { content?: { text?: unknown }[] }
        return Array.isArray(data.content) ? data.content.map(part => (typeof part.text === 'string' ? part.text : '')).join('') : ''
    }
    const data = json as { output_text?: unknown; output?: Array<{ content?: Array<{ text?: unknown }> }> }
    if (typeof data.output_text === 'string') return data.output_text
    const message = data.output?.find(item => Array.isArray(item.content))
    return Array.isArray(message?.content)
        ? message.content.map(part => (typeof part.text === 'string' ? part.text : '')).join('')
        : ''
}

/** Single POST helper shared by the "test connection" and the commit-message generator. */
async function callModel(
    token: string,
    modelId: string,
    systemPrompt: string,
    userPrompt: string,
    opts: { maxTokens?: number; timeoutMs?: number } = {}
): Promise<string> {
    const { maxTokens = 1024, timeoutMs = 60_000 } = opts
    const family = familyOf(modelId)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    let res: Response
    try {
        res = await fetch(endpointOf(family), {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                authorization: `Bearer ${token}`,
                // Anthropic-style gateway also accepts the key here
                ...(family === 'messages' ? { 'x-api-key': token } : {}),
            },
            body: JSON.stringify(buildBody(family, modelId, systemPrompt, userPrompt, maxTokens)),
            signal: controller.signal,
        })
    } catch (err) {
        throw new Error(err instanceof Error && err.name === 'AbortError' ? 'Request timed out' : err instanceof Error ? err.message : String(err))
    } finally {
        clearTimeout(timer)
    }

    const text = await res.text().catch(() => '')
    if (!res.ok) throw new Error(extractErrorDetail(text, res.status))
    let json: unknown
    try {
        json = JSON.parse(text)
    } catch {
        throw new Error('Invalid response from the model API')
    }
    const content = extractContent(family, json).trim()
    if (!content) throw new Error('Model returned an empty response')
    return content
}

/** Send the tiniest possible completion to verify token + model work together. */
export async function testConnection(token: string, modelId: string): Promise<AiTestResult> {
    const cleanToken = String(token ?? '').trim()
    const cleanModel = String(modelId ?? '').trim()
    if (!cleanToken || !cleanModel) return { ok: false, message: 'Enter both a token and a model-id first' }
    try {
        await callModel(cleanToken, cleanModel, '', 'ping', { maxTokens: 5, timeoutMs: 30_000 })
        // failure details never contain the token — safe to log (model ids aren't secret)
        log('info', 'ai', `test ok (${cleanModel})`)
        return { ok: true, message: 'Connected — token & model are valid' }
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        log('warn', 'ai', `test failed (${cleanModel}): ${message.slice(0, 200)}`)
        return { ok: false, message }
    }
}

const COMMIT_SYSTEM_PROMPT = `You are a git commit message generator. Write a concise commit message for the provided changes.

Rules:
- First line (subject): imperative mood, capitalize the first letter, no trailing period, at most 72 characters (ideally 50).
- Keep the message as short as the change allows. Prefer a single-line subject when the change is small; add a short bullet list body only when there are several distinct concerns.
- Focus ONLY on the files that actually changed in the context below. Never mention, describe, or invent changes to any other file, and do not reference unchanged code.
- Do NOT wrap the message in markdown code fences. Do not prefix it with quotes or "commit message:".
- Respond in English, using the project's own terminology from the file paths and code.`

function truncateForPrompt(text: string): string {
    const MAX = 40_000
    if (text.length <= MAX) return text
    return `${text.slice(0, MAX)}\n… (diff truncated)`
}

function stripFences(text: string): string {
    return text.replace(/^```(?:\w+)?\s*/i, '').replace(/\s*```\s*$/, '').trim()
}

/** Build a commit message from all uncommitted changes (uses the saved config). */
export async function generateCommitMessage(): Promise<string> {
    const cfg = getConfig()
    if (!cfg.token || !cfg.modelId) throw new Error('No AI configured — set your OpenCode token and model-id in Settings first')
    const changes = await getChangesContext()
    if (!changes.trim()) throw new Error('No uncommitted changes to summarize')
    const prompt = `Write a single commit message for these uncommitted changes:\n\n${truncateForPrompt(changes)}`
    const content = await callModel(cfg.token, cfg.modelId, COMMIT_SYSTEM_PROMPT, prompt, { maxTokens: 600 })
    return stripFences(content).slice(0, 2500)
}

/** Public model catalog (no auth required) — used for the model-id autocomplete. */
export async function listGoModels(): Promise<string[]> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 10_000)
    try {
        const res = await fetch(GO_MODELS_URL, { signal: controller.signal })
        if (!res.ok) return []
        const json = (await res.json().catch(() => null)) as { data?: { id?: unknown }[] } | null
        if (!Array.isArray(json?.data)) return []
        return json.data.map(model => (typeof model.id === 'string' ? model.id : '')).filter(Boolean)
    } catch {
        return []
    } finally {
        clearTimeout(timer)
    }
}