/**
 * Renders a GitHub release body as plain text. The changelog modal shows the
 * result inside a `pre-wrap` block and never uses v-html, so no markdown
 * library and no HTML sanitizing is needed.
 */
export function stripMarkdown(body: string): string {
    const lines = body
        .replace(/```[\s\S]*?```/g, '')
        .replace(/~~~[\s\S]*?~~~/g, '')
        .split('\n')
        .map(line => {
            // images (incl. badges) carry no text
            let text = line.replace(/!\[[^\]]*\]\([^)]*\)/g, '')
            // links -> label
            text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
            // bare autolinks
            text = text.replace(/<(https?:\/\/[^>\s]+)>/g, '$1')
            // headings -> plain text, keeping the indent as a section gap
            text = text.replace(/^\s{0,3}#{1,6}\s*/, '')
            // blockquote
            text = text.replace(/^\s{0,3}>\s?/, '')
            // inline marks
            text = text.replace(/`([^`]*)`/g, '$1')
            text = text.replace(/\*\*\*([^*]+)\*\*\*/g, '$1')
            text = text.replace(/\*\*([^*]+)\*\*/g, '$1')
            text = text.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1$2')
            text = text.replace(/__([^_]+)__/g, '$1')
            text = text.replace(/(^|[^_\w])_([^_\n]+)_/g, '$1$2')
            text = text.replace(/~~([^~]+)~~/g, '$1')
            // bullet / checkbox lists
            const bullet = text.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/)
            if (bullet) {
                const marker = /^\d+[.)]$/.test(bullet[2]!) ? `${bullet[2]} ` : '• '
                text = `${bullet[1]}${marker}${bullet[3]}`
            }
            return text.replace(/\s+$/, '')
        })

    // collapse runs of blank lines into a single gap
    return lines
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
}
