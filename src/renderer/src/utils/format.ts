export function formatShortDate(value: string): string {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return value
    const dd = String(date.getDate()).padStart(2, '0')
    const mm = String(date.getMonth() + 1).padStart(2, '0')
    return `${dd}/${mm}/${date.getFullYear()}`
}

export function formatDateTime(value: string): string {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return value
    const dd = String(date.getDate()).padStart(2, '0')
    const mm = String(date.getMonth() + 1).padStart(2, '0')
    const hh = String(date.getHours()).padStart(2, '0')
    const mi = String(date.getMinutes()).padStart(2, '0')
    return `${dd}/${mm}/${date.getFullYear()} ${hh}:${mi}`
}

export function formatDatePattern(value: string, pattern: string): string {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return value
    const pad = (n: number) => String(n).padStart(2, '0')
    const h24 = date.getHours()
    const tokens: Record<string, string> = {
        yyyy: String(date.getFullYear()),
        yy: String(date.getFullYear()).slice(-2),
        MM: pad(date.getMonth() + 1),
        dd: pad(date.getDate()),
        HH: pad(h24),
        hh: pad(h24 % 12 || 12),
        mm: pad(date.getMinutes()),
        ss: pad(date.getSeconds()),
        a: h24 < 12 ? 'AM' : 'PM',
    }
    return pattern.replace(/yyyy|yy|MM|dd|HH|hh|mm|ss|a/g, token => tokens[token] ?? token)
}

export function formatCommitDate(value: string): string {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return value
    const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    const today = new Date()
    const daysAgo = Math.floor((today.setHours(0, 0, 0, 0) - new Date(date).setHours(0, 0, 0, 0)) / 86_400_000)
    if (daysAgo === 0) return `Today at ${time}`
    if (daysAgo === 1) return `Yesterday at ${time}`
    if (daysAgo > 1 && daysAgo < 7) return `${date.toLocaleDateString(undefined, { weekday: 'long' })} at ${time}`
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}
