import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** sRGB hex (#rgb / #rrggbb) → [r, g, b] in 0..1. */
export function hexToRgb(hex: string): [number, number, number] {
    let h = hex.trim().replace(/^#/, '')
    if (h.length === 3) h = [...h].map(c => c + c).join('')
    if (!/^[0-9a-fA-F]{6}$/.test(h)) throw new Error(`not a hex colour: ${hex}`)
    return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number]
}

function toLinear(c: number): number {
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

/** WCAG 2.x relative luminance. */
export function luminance(hex: string): number {
    const [r, g, b] = hexToRgb(hex).map(toLinear)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG 2.x contrast ratio between two opaque colours. */
export function contrast(a: string, b: string): number {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
    return (hi + 0.05) / (lo + 0.05)
}

/** sRGB hex → OKLab [L, a, b]. */
export function oklab(hex: string): [number, number, number] {
    const [r, g, b] = hexToRgb(hex).map(toLinear)
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
    return [
        0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
        1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
        0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
    ]
}

/** sRGB hex → OKLCH [L, C, H°]. */
export function oklch(hex: string): [number, number, number] {
    const [L, a, b] = oklab(hex)
    const h = (Math.atan2(b, a) * 180) / Math.PI
    return [L, Math.hypot(a, b), h < 0 ? h + 360 : h]
}

/** CSS `color-mix(in srgb, fg p, bg)` for opaque colours — what a `color-mix(..., transparent)` tint paints over `bg`. */
export function mix(fg: string, bg: string, p: number): string {
    const f = hexToRgb(fg)
    const g = hexToRgb(bg)
    return `#${f
        .map((c, i) => Math.round((c * p + g[i] * (1 - p)) * 255))
        .map(v => v.toString(16).padStart(2, '0'))
        .join('')}`
}

const STYLES = fileURLToPath(new URL('../../../src/renderer/src/styles.css', import.meta.url))

/** Custom properties declared by the first CSS block whose selector list contains `selector`. */
export function themeTokens(selector: string): Record<string, string> {
    const css = readFileSync(STYLES, 'utf8')
    const start = css.indexOf(selector)
    if (start < 0) throw new Error(`selector not found: ${selector}`)
    const open = css.indexOf('{', start)
    const close = css.indexOf('}', open)
    const tokens: Record<string, string> = {}
    for (const match of css.slice(open + 1, close).matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) tokens[match[1]] = match[2].trim()
    return tokens
}
