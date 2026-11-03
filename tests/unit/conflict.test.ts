import { describe, expect, it } from 'vitest'

import {
    allSidesPicked,
    annotateConflictMatches,
    blockPicked,
    conflictDisplayRows,
    conflictOutputLines,
    parseConflictBlocks,
    sidePicked,
    takeBothSides,
    takeSideOfBlock,
    toggleAllSidePicks,
    toggleLinePick,
    toggleSidePick,
} from '../../src/renderer/src/utils/conflict'

/**
 * Two conflicts in one file: the first is a hunk that the incoming side deleted (empty theirs — the shape that left the conflict view
 * stuck at "3/5 resolved"), the second has content on both sides.
 */
const TWO_BLOCKS = [
    'top',
    '<<<<<<< HEAD',
    '// comment',
    '// comment 2',
    '=======',
    '>>>>>>> production',
    'l1',
    'l2',
    'middle',
    '<<<<<<< HEAD',
    'main side',
    '=======',
    'feature side',
    '>>>>>>> feature',
    'bottom',
    '',
].join('\n')

function resolvedText(text: string): string {
    const blocks = parseConflictBlocks(text, 'theirs')
    toggleAllSidePicks(blocks, 'theirs')
    return conflictOutputLines(text, blocks)
        .map(row => row.text)
        .join('\n')
}

describe('parseConflictBlocks', () => {
    it('parses a block whose incoming side is empty', () => {
        const blocks = parseConflictBlocks(TWO_BLOCKS, 'production')
        expect(blocks).toHaveLength(2)
        expect(blocks[0]).toMatchObject({ ours: ['// comment', '// comment 2'], theirs: [], label: 'production' })
        expect(blocks[1]).toMatchObject({ ours: ['main side'], theirs: ['feature side'], label: 'feature' })
        expect(blocks[0]!.emptyPick).toEqual({ ours: false, theirs: false })
    })

    it('skips the diff3 base section and falls back to the repo label', () => {
        const text = ['<<<<<<< HEAD', 'ours', '||||||| base', 'base line', '=======', 'theirs', '>>>>>>> ', ''].join('\n')
        const blocks = parseConflictBlocks(text, 'production')
        expect(blocks).toHaveLength(1)
        expect(blocks[0]).toMatchObject({ ours: ['ours'], theirs: ['theirs'], label: 'production' })
    })

    it('annotates block positions in both sides', () => {
        const blocks = parseConflictBlocks(TWO_BLOCKS, 'theirs')
        annotateConflictMatches(blocks, 'top\n// comment\n// comment 2\nl1\nl2\nmiddle\nmain side\nbottom\n', 'top\nl1\nl2\nmiddle\nfeature side\nbottom\n')
        expect(blocks[0]!.matchIdx).toEqual({ ours: 1, theirs: -1 })
        expect(blocks[1]!.matchIdx).toEqual({ ours: 6, theirs: 4 })
    })
})

describe('block picks', () => {
    it('starts unresolved even when one side has no lines', () => {
        const blocks = parseConflictBlocks(TWO_BLOCKS, 'theirs')
        expect(blocks[0]!.pickTheirsLines).toEqual([])
        expect(sidePicked(blocks[0]!, 'theirs')).toBe(false)
        expect(blockPicked(blocks[0]!)).toBe(false)
    })

    it('resolves an empty side through its whole-side pick', () => {
        const blocks = parseConflictBlocks(TWO_BLOCKS, 'theirs')
        toggleSidePick(blocks[0], 'theirs')
        expect(blocks[0]!.emptyPick.theirs).toBe(true)
        expect(sidePicked(blocks[0]!, 'theirs')).toBe(true)
        expect(blockPicked(blocks[0]!)).toBe(true)

        toggleSidePick(blocks[0], 'theirs')
        expect(blockPicked(blocks[0]!)).toBe(false)
    })

    it('still fills and clears per-line picks on a non-empty side', () => {
        const blocks = parseConflictBlocks(TWO_BLOCKS, 'theirs')
        toggleSidePick(blocks[1], 'theirs')
        expect(blocks[1]!.pickTheirsLines).toEqual([true])
        expect(sidePicked(blocks[1]!, 'theirs')).toBe(true)

        toggleLinePick(blocks[1], 'theirs', 0)
        expect(blockPicked(blocks[1]!)).toBe(false)
    })

    it('forces both sides of a block including the empty one', () => {
        const blocks = parseConflictBlocks(TWO_BLOCKS, 'theirs')
        takeBothSides(blocks[0])
        expect(blocks[0]!.pickOursLines).toEqual([true, true])
        expect(blocks[0]!.emptyPick.theirs).toBe(true)
        expect(blockPicked(blocks[0]!)).toBe(true)
    })

    it('whole-file toggle covers blocks whose side is empty', () => {
        const blocks = parseConflictBlocks(TWO_BLOCKS, 'theirs')
        // The old implementation ignored the empty-side block here, so the header checkbox read
        // "checked" while the footer still showed unresolved conflicts.
        expect(allSidesPicked(blocks, 'theirs')).toBe(false)

        toggleAllSidePicks(blocks, 'theirs')
        expect(allSidesPicked(blocks, 'theirs')).toBe(true)
        expect(blocks.every(block => blockPicked(block))).toBe(true)

        toggleAllSidePicks(blocks, 'theirs')
        expect(allSidesPicked(blocks, 'theirs')).toBe(false)
        expect(blocks.some(block => blockPicked(block))).toBe(false)
    })

    it('takes a single side through the output placeholder action', () => {
        const blocks = parseConflictBlocks(TWO_BLOCKS, 'theirs')
        takeSideOfBlock(blocks[0], 'theirs')
        takeSideOfBlock(blocks[1], 'theirs')
        expect(blocks.every(block => blockPicked(block))).toBe(true)
    })
})

describe('conflict output', () => {
    it('keeps raw markers for unresolved blocks', () => {
        const blocks = parseConflictBlocks(TWO_BLOCKS, 'theirs')
        expect(conflictOutputLines(TWO_BLOCKS, blocks).map(row => row.text)).toContain('<<<<<<< HEAD')
    })

    it('drops an empty chosen side and emits the picked lines', () => {
        expect(resolvedText(TWO_BLOCKS)).toBe('top\nl1\nl2\nmiddle\nfeature side\nbottom\n')
    })

    it('collapses unresolved blocks into placeholder cards in the output pane', () => {
        const blocks = parseConflictBlocks(TWO_BLOCKS, 'theirs')
        expect(conflictDisplayRows(TWO_BLOCKS, blocks)).toEqual([
            { kind: 'line', text: 'top', block: -1 },
            { kind: 'gap', block: 0, oursN: 2, theirsN: 0 },
            { kind: 'line', text: 'l1', block: -1 },
            { kind: 'line', text: 'l2', block: -1 },
            { kind: 'line', text: 'middle', block: -1 },
            { kind: 'gap', block: 1, oursN: 1, theirsN: 1 },
            { kind: 'line', text: 'bottom', block: -1 },
            { kind: 'line', text: '', block: -1 },
        ])
    })

    it('removes the placeholder once the empty side is chosen', () => {
        const blocks = parseConflictBlocks(TWO_BLOCKS, 'theirs')
        takeSideOfBlock(blocks[0], 'theirs')
        expect(conflictDisplayRows(TWO_BLOCKS, blocks).some(row => row.kind === 'gap')).toBe(true)
        takeSideOfBlock(blocks[1], 'theirs')
        expect(conflictDisplayRows(TWO_BLOCKS, blocks).some(row => row.kind === 'gap')).toBe(false)
    })
})
