/** Short absolute date as dd/mm/yyyy (commit graph DATE column) */
export function formatShortDate(value: string): string {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return value
    const dd = String(date.getDate()).padStart(2, '0')
    const mm = String(date.getMonth() + 1).padStart(2, '0')
    return `${dd}/${mm}/${date.getFullYear()}`
}

/** Compact graph DATE column: relative under a week ("5h", "3d"), else dd/mm/yy */
export function formatGraphDate(value: string): string {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return value
    const diff = Date.now() - date.getTime()
    if (diff < 60_000) return 'now'
    const mins = Math.floor(diff / 60_000)
    if (mins < 60) return `${mins}m`
    const hours = Math.floor(mins / 60)
    if (hours < 24) return `${hours}h`
    const days = Math.floor(hours / 24)
    if (days < 7) return `${days}d`
    const dd = String(date.getDate()).padStart(2, '0')
    const mm = String(date.getMonth() + 1).padStart(2, '0')
    return `${dd}/${mm}/${String(date.getFullYear()).slice(2)}`
}

/** Human-friendly commit date: Today/Yesterday/weekday, else absolute date */
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
