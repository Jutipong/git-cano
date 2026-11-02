import * as fs from 'node:fs'
import * as path from 'node:path'

import { app } from 'electron'

type Level = 'debug' | 'info' | 'warn' | 'error'

const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 }

const MAX_STRING = 200
const MAX_FILE_BYTES = 5 * 1024 * 1024
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000
const RETENTION_CHECK_MS = 60 * 60 * 1000

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

let lastRetentionCheck = 0

function resetIfExpired(file: string): void {
    const now = Date.now()
    if (now - lastRetentionCheck < RETENTION_CHECK_MS) return
    lastRetentionCheck = now
    try {
        const fd = fs.openSync(file, 'r')
        let startedAt = NaN
        try {
            const buf = Buffer.alloc(64)
            const read = fs.readSync(fd, buf, 0, buf.length, 0)
            startedAt = Date.parse(buf.toString('utf8', 0, read).split('\n')[0].slice(0, 24))
        } finally {
            fs.closeSync(fd)
        }
        if (!Number.isNaN(startedAt) && now - startedAt > RETENTION_MS) {
            fs.truncateSync(file, 0)
            fs.rmSync(`${file}.old`, { force: true })
        }
    } catch {}
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
        resetIfExpired(file)
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
