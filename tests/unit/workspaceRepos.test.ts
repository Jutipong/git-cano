import { describe, expect, it } from 'vitest'

import { collectWorkspaceRepos, repoNameFromPath } from '../../src/renderer/src/utils/workspaceRepos'

describe('repoNameFromPath', () => {
    it('takes the folder name from posix and windows paths', () => {
        expect(repoNameFromPath('/home/me/code/git-cano')).toBe('git-cano')
        expect(repoNameFromPath('D:\\code\\git-cano')).toBe('git-cano')
        expect(repoNameFromPath('D:\\code\\git-cano\\')).toBe('git-cano')
    })

    it('falls back to the raw path when there is no folder segment', () => {
        expect(repoNameFromPath('')).toBe('')
    })
})

describe('collectWorkspaceRepos', () => {
    const aa1 = 'D:\\code\\aa-1'
    const aa2 = 'D:\\code\\aa-2'
    const bb1 = 'D:\\code\\bb-1'
    const bb2 = 'D:\\code\\bb-2'

    it('lists repos from every workspace, current workspace first', () => {
        const entries = collectWorkspaceRepos(
            ['aa', 'bb'],
            'aa',
            { aa: { paths: [aa1, aa2] }, bb: { paths: [bb1, bb2] } },
            [
                { path: aa1, name: 'aa-1' },
                { path: aa2, name: 'aa-2' },
            ],
            1
        )
        expect(entries.map(e => e.path)).toEqual([aa1, aa2, bb1, bb2])
        expect(entries.map(e => e.name)).toEqual(['aa-1', 'aa-2', 'bb-1', 'bb-2'])
        expect(entries.map(e => e.workspace)).toEqual(['aa', 'aa', 'bb', 'bb'])
    })

    it('flags only the current workspace selected tab as active', () => {
        const entries = collectWorkspaceRepos(
            ['aa', 'bb'],
            'aa',
            { aa: { paths: [aa1, aa2] }, bb: { paths: [bb1] } },
            [
                { path: aa1, name: 'aa-1' },
                { path: aa2, name: 'aa-2' },
            ],
            0
        )
        expect(entries.filter(e => e.isActiveTab).map(e => e.path)).toEqual([aa1])
        expect(entries.filter(e => e.isCurrentWorkspace).map(e => e.path)).toEqual([aa1, aa2])
    })

    it('lists a repo once per workspace that opens it', () => {
        const shared = 'D:\\code\\shared'
        const entries = collectWorkspaceRepos(
            ['aa', 'bb'],
            'bb',
            { aa: { paths: [shared, aa1] }, bb: { paths: [bb1, shared] } },
            [
                { path: bb1, name: 'bb-1' },
                { path: shared, name: 'shared' },
            ],
            0
        )
        // bb first (current workspace), then aa in `names` order — the shared repo is NOT deduped away.
        expect(entries.map(e => [e.workspace, e.path])).toEqual([
            ['bb', bb1],
            ['bb', shared],
            ['aa', shared],
            ['aa', aa1],
        ])
        // Only the current workspace's own selected tab wears the active flag.
        expect(entries.filter(e => e.isActiveTab).map(e => e.path)).toEqual([bb1])
        expect(entries.filter(e => e.isCurrentWorkspace).map(e => e.path)).toEqual([bb1, shared])
    })

    it('keeps a repo shared by several non-current workspaces on a row each', () => {
        const shared = 'D:\\code\\shared'
        const entries = collectWorkspaceRepos(
            ['aa', 'bb', 'cc'],
            'aa',
            { aa: { paths: [aa1] }, bb: { paths: [shared] }, cc: { paths: [shared] } },
            [{ path: aa1, name: 'aa-1' }],
            0
        )
        expect(entries.filter(e => e.path === shared).map(e => e.workspace)).toEqual(['bb', 'cc'])
    })

    it('never emits the same workspace/path pair twice', () => {
        const entries = collectWorkspaceRepos(
            ['aa', 'bb'],
            'aa',
            // A path repeated inside one session is not produced by the store, but must not double a row either.
            { aa: { paths: [aa1, aa1] }, bb: { paths: [bb1, bb1] } },
            [{ path: aa1, name: 'aa-1' }],
            0
        )
        const pairs = entries.map(e => `${e.workspace}|${e.path}`)
        expect(pairs).toEqual(['aa|D:\\code\\aa-1', 'bb|D:\\code\\bb-1'])
    })

    it('still guards the current workspace against its own tabs/session overlap', () => {
        const entries = collectWorkspaceRepos(
            ['aa', 'bb'],
            'aa',
            { aa: { paths: [aa1, aa2] }, bb: { paths: [bb1] } },
            [
                { path: aa1, name: 'aa-1' },
                { path: aa2, name: 'aa-2' },
            ],
            0
        )
        expect(entries.map(e => e.path)).toEqual([aa1, aa2, bb1])
    })

    it('still lists the current workspace session while its tabs are being restored', () => {
        const entries = collectWorkspaceRepos(
            ['aa', 'bb'],
            'bb',
            { aa: { paths: [aa1] }, bb: { paths: [bb1, bb2] } },
            [],
            0
        )
        expect(entries.map(e => e.path)).toEqual([bb1, bb2, aa1])
    })

    it('skips workspaces without a session', () => {
        const entries = collectWorkspaceRepos(['aa', 'bb'], 'aa', { aa: { paths: [aa1] } }, [{ path: aa1, name: 'aa-1' }], 0)
        expect(entries.map(e => e.path)).toEqual([aa1])
    })
})