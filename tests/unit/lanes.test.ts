import { describe, expect, it } from 'vitest'

import { assignLanes } from '../../src/shared/lanes'

import type { CommitNode } from '../../src/shared/types'

function commit(hash: string, parents: string[] = []): CommitNode {
    return { hash, shortHash: hash.slice(0, 7), parents, author: 'A', date: '', subject: hash, refs: [], lane: 0 }
}

describe('assignLanes', () => {
    it('keeps a linear chain on lane 0', () => {
        const commits = [commit('c', ['b']), commit('b', ['a']), commit('a', [])]
        assignLanes(commits)
        expect(commits.map(c => c.lane)).toEqual([0, 0, 0])
    })

    it('moves a merged branch to its own lane and rejoins', () => {
        // M merges A and B; both A and B share parent C.
        const commits = [commit('m', ['a', 'b']), commit('a', ['c']), commit('b', ['c']), commit('c', [])]
        assignLanes(commits)
        expect(commits.map(c => c.lane)).toEqual([0, 0, 1, 0])
    })

    it('ignores parents outside the loaded page', () => {
        const commits = [commit('b', ['missing']), commit('a', [])]
        assignLanes(commits)
        expect(commits.map(c => c.lane)).toEqual([0, 0])
    })

    it('is deterministic for a repeated run', () => {
        const make = (): CommitNode[] => [commit('m', ['a', 'b']), commit('a', ['c']), commit('b', ['c']), commit('c', [])]
        const first = make()
        const second = make()
        assignLanes(first)
        assignLanes(second)
        expect(second.map(c => c.lane)).toEqual(first.map(c => c.lane))
    })
})
