import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const scanRoot = join(root, 'src', 'renderer', 'src')
const baselinePath = join(root, 'scripts', 'style-baseline.json')

// Target type scale. Values outside it are frozen at their current count per file.
const ALLOWED_FONT_SIZES = new Set([10, 11, 12, 13, 14, 16, 18])
const HEX = /#[0-9a-fA-F]{3,8}\b/g
const COLOR_FN = /\b(?:rgba?|hsla?)\([^)]*\)/g
const FONT_SIZE = /font-size:\s*([0-9.]+)px/g
const COMMENT = /\/\*[\s\S]*?\*\//g
const STYLE_BLOCK = /<style[^>]*>([\s\S]*?)<\/style>/g

function walk(dir) {
    const files = []
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) files.push(...walk(full))
        else if (entry.name.endsWith('.css') || entry.name.endsWith('.vue')) files.push(full)
    }
    return files
}

function cssOf(file, content) {
    if (file.endsWith('.css')) return content
    return [...content.matchAll(STYLE_BLOCK)].map(match => match[1]).join('\n')
}

function countOffences(content) {
    const text = content.replace(COMMENT, '')
    const counts = { hex: 0, colorFn: 0, fontSize: 0 }
    for (const line of text.split('\n')) {
        if (line.trim().startsWith('--')) continue
        counts.hex += line.match(HEX)?.length ?? 0
        counts.colorFn += line.match(COLOR_FN)?.length ?? 0
        for (const match of line.matchAll(FONT_SIZE)) {
            if (!ALLOWED_FONT_SIZES.has(Number(match[1]))) counts.fontSize += 1
        }
    }
    return counts
}

function totals(files) {
    return Object.values(files).reduce(
        (sum, counts) => ({
            hex: sum.hex + counts.hex,
            colorFn: sum.colorFn + counts.colorFn,
            fontSize: sum.fontSize + counts.fontSize,
        }),
        { hex: 0, colorFn: 0, fontSize: 0 }
    )
}

function increases(files, baseline) {
    const failures = []
    for (const [file, counts] of Object.entries(files)) {
        const base = baseline[file] ?? { hex: 0, colorFn: 0, fontSize: 0 }
        if (counts.hex > (base.hex ?? 0)) failures.push(`${file}: raw colors ${counts.hex} (baseline ${base.hex ?? 0})`)
        if (counts.colorFn > (base.colorFn ?? 0))
            failures.push(`${file}: color functions ${counts.colorFn} (baseline ${base.colorFn ?? 0})`)
        if (counts.fontSize > (base.fontSize ?? 0))
            failures.push(`${file}: off-scale font sizes ${counts.fontSize} (baseline ${base.fontSize ?? 0})`)
    }
    return failures
}

const current = {}
for (const file of walk(scanRoot).sort()) {
    const counts = countOffences(cssOf(file, readFileSync(file, 'utf8')))
    if (counts.hex || counts.colorFn || counts.fontSize)
        current[relative(root, file).split(sep).join('/')] = counts
}

const update = process.argv.includes('--update')
const force = process.argv.includes('--force')
const previous = existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, 'utf8')).files ?? {} : null

if (update) {
    const raised = previous ? increases(current, previous) : []
    if (raised.length && !force) {
        process.stderr.write(`[check-styles] refusing to raise the baseline (use --force only for a deliberate migration):\n${raised.map(line => `  ${line}`).join('\n')}\n`)
        process.exit(1)
    }
    writeFileSync(baselinePath, `${JSON.stringify({ files: current }, null, 4)}\n`)
    const sum = totals(current)
    process.stdout.write(
        `[check-styles] baseline updated: ${sum.hex} raw colors, ${sum.colorFn} color functions, ${sum.fontSize} off-scale font sizes\n`
    )
    process.exit(0)
}

if (!previous) {
    process.stderr.write('[check-styles] missing scripts/style-baseline.json — run with --update\n')
    process.exit(1)
}

const baseline = previous
const sum = totals(current)
const baseSum = totals(baseline)
const failures = increases(current, baseline)

process.stdout.write(
    `[check-styles] raw colors ${sum.hex}/${baseSum.hex}, color functions ${sum.colorFn}/${baseSum.colorFn}, off-scale font sizes ${sum.fontSize}/${baseSum.fontSize}\n`
)

if (failures.length) {
    process.stderr.write(`[check-styles] drift detected — use a token (var(--font-*) / var(--…)) or lower the baseline:\n${failures.map(line => `  ${line}`).join('\n')}\n`)
    process.exit(1)
}
