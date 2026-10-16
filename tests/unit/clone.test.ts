import { describe, expect, it } from 'vitest'

import { cloneFolderError, extractRepoFolderName, isValidCloneFolderName, joinClonePath } from '../../src/shared/clone'

describe('extractRepoFolderName', () => {
    it('strips .git from https urls', () => {
        expect(extractRepoFolderName('https://github.com/Jutipong/ESP32-S3.git')).toBe('ESP32-S3')
    })

    it('handles trailing slashes and paths', () => {
        expect(extractRepoFolderName('https://github.com/user/repo/')).toBe('repo')
        expect(extractRepoFolderName('https://github.com/user/repo')).toBe('repo')
    })

    it('handles scp-like ssh urls', () => {
        expect(extractRepoFolderName('git@github.com:user/repo.git')).toBe('repo')
        expect(extractRepoFolderName('git@github.com:repo.git')).toBe('repo')
    })

    it('handles ssh urls with scheme', () => {
        expect(extractRepoFolderName('ssh://git@github.com/user/repo.git')).toBe('repo')
    })

    it('returns empty for blank input', () => {
        expect(extractRepoFolderName('')).toBe('')
        expect(extractRepoFolderName('   ')).toBe('')
    })
})

describe('isValidCloneFolderName', () => {
    it('accepts a single segment', () => {
        expect(isValidCloneFolderName('ESP32-S3')).toBe(true)
    })

    it('rejects slashes, traversal and windows chars', () => {
        expect(isValidCloneFolderName('')).toBe(false)
        expect(isValidCloneFolderName('a/b')).toBe(false)
        expect(isValidCloneFolderName('a\\b')).toBe(false)
        expect(isValidCloneFolderName('..')).toBe(false)
        expect(isValidCloneFolderName('a:b')).toBe(false)
        expect(isValidCloneFolderName('a?b')).toBe(false)
        expect(isValidCloneFolderName('repo.')).toBe(false)
    })

    it('explains the problem', () => {
        expect(cloneFolderError('')).toBe('Folder name is required')
        expect(cloneFolderError('a/b')).toContain('single folder')
    })
})

describe('joinClonePath', () => {
    it('joins with the parent separator style', () => {
        expect(joinClonePath('D:\\code', 'repo')).toBe('D:\\code\\repo')
        expect(joinClonePath('/tmp/code/', 'repo')).toBe('/tmp/code/repo')
    })
})
