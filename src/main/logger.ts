import * as fs from 'node:fs'
import * as path from 'node:path'

import { app } from 'electron'

type Level = 'debug' | 'info' | 'warn' | 'error'

const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 }

const MAX_STRING = 200
const MAX_FILE_BYTES = 5 * 1024 * 1024

function threshold(): number {
    const fromEnv = LEVELS[process.env.GIT_CANO_LOG_LEVEL as Level]
    if (fromEnv !== undefined) return fromEnv
    return process.env.NODE_ENV === 'development' ? LEVELS.debug : LEVELS.info
}

let filePath: string | null = null

function logfile(): string {
    if (!filePath) {
        filePath = path.join(app.getPath('userData'), 'logs', 'git-cano.log')
    }
    return filePath
}

export function summarize(value: unknown): string {
    if (value === undefined) return 'undefined'
    if (value === null) return 'null'
    if (Array.isArray(value)) return `Array(${value.length})`
    if (typeof value === 'string') {
        return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…(${value.length} chars)` : value
    }
    if (typeof value === 'object') {
        const keys = Object.keys(value as Record<string, unknown>)
        return keys.length > 10 ? `object{${keys.length} keys}` : `object{${keys.join(',')}}`
    }
    return String(value)
}

export function summarizeArgs(args: unknown[]): string {
    return args.map(arg => summarize(arg)).join(' ') || '(no args)'
}

export function maskUrl(value: string): string {
    return value.replace(/(https?):\/\/([^@/\s]+)@/g, '$1://***@')
}

function rotateIfNeeded(file: string): void {
    try {
        if (fs.existsSync(file) && fs.statSync(file).size > MAX_FILE_BYTES) {
            fs.renameSync(file, `${file}.old`)
        }
    } catch {}
}

function emit(level: Level, scope: string, message: string): void {
    if (LEVELS[level] < threshold()) return
    const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} [${scope}] ${message}`
    try {
        const file = logfile()
        fs.mkdirSync(path.dirname(file), { recursive: true })
        rotateIfNeeded(file)
        fs.appendFileSync(file, `${line}\n`)
    } catch {}
    // eslint-disable-next-line @typescript-eslint/no-console
    const print = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log
    print(line)
}

export function log(level: Level, scope: string, message: string, detail?: unknown): void {
    emit(level, scope, detail === undefined ? message : `${message} ${summarize(detail)}`)
}
