import type { CommitNode } from './types'

/**
 * Assign graph lanes to a log (newest first, as produced by getLog). Pure function over hash/parents only — shared so the renderer can
 * re-run it after appending an incremental log page.
 */
export function assignLanes(commits: CommitNode[]): void {
    const lanes: string[] = []
    const present = new Set(commits.map(c => c.hash))
    for (const c of commits) {
        let idx = lanes.indexOf(c.hash)
        if (idx === -1) {
            lanes.push(c.hash)
            idx = lanes.length - 1
        }
        c.lane = idx
        lanes.splice(idx, 1)

        c.parents.forEach((parent, i) => {
            if (!present.has(parent)) return
            const pi = lanes.indexOf(parent)
            if (pi === -1) {
                if (i === 0) lanes.splice(idx, 0, parent)
                else lanes.push(parent)
            }
        })
    }
}
