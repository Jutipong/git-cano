/** Text shown to the user for a caught error: `String(error)` without the leading `Error: ` prefix. */
export function errorMessage(error: unknown): string {
    return String(error).replace(/^Error:\s*/, '')
}
