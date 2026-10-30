import { isMac, isWindows } from './shortcuts'

import type { EditorTarget, OpenInTargets } from '@shared/types'

export interface EditorTargetOption {
    target: EditorTarget
    label: string
}

function defaultEditorLabel(): string {
    if (isWindows) return 'Notepad'
    if (isMac) return 'Text Editor'
    return 'Default editor'
}

/**
 * Editors offered for opening a single working-tree file, in the same availability conditions as the repo-level Open in menu. The OS
 * default (Notepad / default text editor / system default) and VS Code are always offered; Rider, Kiro and Notepad++/Nextpad++ only when
 * detected.
 */
export function editorTargetOptions(targets: OpenInTargets | null): EditorTargetOption[] {
    const options: EditorTargetOption[] = [
        { target: 'default', label: defaultEditorLabel() },
        { target: 'vscode', label: 'VS Code' },
    ]
    if (targets?.rider) options.push({ target: 'rider', label: 'Rider' })
    if (targets?.kiro) options.push({ target: 'kiro', label: 'Kiro' })
    if (targets?.notepadpp) {
        options.push({ target: 'notepadpp', label: isMac ? 'Nextpad++' : 'Notepad++' })
    }
    return options
}

/**
 * Session cache of Open-in availability per repo path. The main process walks the repo for .sln/.csproj files and (on Windows) probes for
 * VS/Rider, so the sidebar button and the command palette share one result instead of re-scanning every time either one opens.
 *
 * Module scope on purpose: a cache declared inside `<script setup>` would be recreated on every component mount (palette opens are
 * frequent) and never hit.
 */
const cache = new Map<string, OpenInTargets>()
/** In-flight requests joined by path, so two mounted components never run the same scan twice. */
const inflight = new Map<string, Promise<OpenInTargets>>()
/** Keep the session cache small — availability is tiny, but a long session with many repos should not retain them all. */
const MAX_CACHE_ENTRIES = 20

/** Cached availability for a repo, or null when this session has not fetched it yet. */
export function peekOpenInTargets(path: string): OpenInTargets | null {
    return cache.get(path) ?? null
}

/** Availability for a repo, fetched once per session and reused afterwards. */
export function fetchOpenInTargets(path: string): Promise<OpenInTargets> {
    const cached = cache.get(path)
    if (cached) return Promise.resolve(cached)
    const pending = inflight.get(path)
    if (pending) return pending
    const request = window.api
        .getOpenInTargets(path)
        .then(targets => {
            cache.delete(path)
            cache.set(path, targets)
            while (cache.size > MAX_CACHE_ENTRIES) {
                const oldest = cache.keys().next().value
                if (oldest === undefined) break
                cache.delete(oldest)
            }
            return targets
        })
        .finally(() => inflight.delete(path))
    inflight.set(path, request)
    return request
}
