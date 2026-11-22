import {
    applyStash,
    createStash,
    dropStash,
    getStashFileContent,
    getStashFileDiff,
    getStashFileMeta,
    getStashFiles,
    getStashImageVersion,
    listStashes,
} from '../git'
import { handleRepo } from './core'

/** Stash slice IPC: list/create/apply/drop and the stash file tree + previews. */

export function registerStashIpc(): void {
    handleRepo('stash:list', () => listStashes())
    handleRepo('stash:create', (message: string) => createStash(message as string))
    handleRepo('stash:apply', (index: number, pop: boolean) => applyStash(index as number, pop as boolean))
    handleRepo('stash:drop', (index: number) => dropStash(index as number))
    handleRepo('stash:files', (hash: string) => getStashFiles(hash as string))
    handleRepo('stash:fileDiff', (hash: string, file: string, context?: number) =>
        getStashFileDiff(hash as string, file as string, typeof context === 'number' ? context : undefined)
    )
    handleRepo('stash:fileMeta', (hash: string, file: string) => getStashFileMeta(hash as string, file as string))
    handleRepo('stash:imageVersion', (hash: string, file: string) => getStashImageVersion(hash as string, file as string))
    handleRepo('stash:fileContent', (hash: string, file: string) => getStashFileContent(hash as string, file as string))
}
