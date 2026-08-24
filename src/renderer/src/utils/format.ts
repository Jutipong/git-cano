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
