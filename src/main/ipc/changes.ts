import {
    addIgnoreRule,
    discard,
    discardUnstaged,
    getCommitFileContent,
    getCommitFileDiff,
    getCommitFileMeta,
    getCommitImageVersion,
    getDiff,
    getDiffMeta,
    getImageVersion,
    getMarkdownImage,
    getRawPatch,
    getWorkdirFileContent,
    listFiles,
    stage,
    stageAll,
    stageHunks,
    unstage,
    unstageAll,
} from '../git'
import { handleRepo } from './core'

/** Changes/files slice IPC: working-tree diff, staging, previews, hunk patches and gitignore rules. */

export function registerChangesIpc(): void {
    handleRepo('file:diff', (file: string, staged: boolean, context?: number) =>
        getDiff(file as string, staged as boolean, typeof context === 'number' ? context : undefined)
    )
    handleRepo('file:diffMeta', (file: string, staged: boolean) => getDiffMeta(file as string, staged as boolean))
    handleRepo('file:image', (file: string, source: 'workdir' | 'index' | 'head') =>
        getImageVersion(file as string, source as 'workdir' | 'index' | 'head')
    )
    handleRepo('file:commitDiff', (hash: string, file: string, context?: number) =>
        getCommitFileDiff(hash as string, file as string, typeof context === 'number' ? context : undefined)
    )
    handleRepo('file:commitMeta', (hash: string, file: string) => getCommitFileMeta(hash as string, file as string))
    handleRepo('file:commitImage', (hash: string, file: string) => getCommitImageVersion(hash as string, file as string))
    handleRepo('file:content', (file: string, staged: boolean) => getWorkdirFileContent(file as string, staged as boolean))
    handleRepo('file:commitContent', (hash: string, file: string) => getCommitFileContent(hash as string, file as string))
    handleRepo('markdown:image', (mdFile: string, src: string, commitHash?: string | null, stashHash?: string | null) =>
        getMarkdownImage(
            mdFile as string,
            src as string,
            typeof commitHash === 'string' && commitHash ? commitHash : null,
            typeof stashHash === 'string' && stashHash ? stashHash : null
        )
    )
    handleRepo('file:list', (hash?: string) => listFiles(typeof hash === 'string' && hash.trim() ? hash : undefined))
    handleRepo('file:addIgnoreRule', (rule: string, dir?: string) =>
        addIgnoreRule(rule as string, typeof dir === 'string' && dir ? dir : undefined)
    )
    handleRepo('file:stage', (paths: string[]) => stage(paths as string[]))
    handleRepo('file:stageAll', (_dir?: string) => stageAll(typeof _dir === 'string' && _dir ? _dir : undefined))
    handleRepo('file:unstage', (paths: string[]) => unstage(paths as string[]))
    handleRepo('file:unstageAll', () => unstageAll())
    handleRepo('file:discard', (p: string) => discard(p as string))
    handleRepo('file:discardUnstaged', () => discardUnstaged())
    handleRepo('patch:raw', (file: string, staged: boolean) => getRawPatch(file as string, staged as boolean))
    handleRepo('patch:stageHunks', (file: string, stagedView: boolean, hunks: number[], reverse: boolean) =>
        stageHunks(file as string, stagedView as boolean, hunks as number[], reverse as boolean)
    )
}
