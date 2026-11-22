import {
    getBlame,
    getCachedLog,
    getCommitBody,
    getCommitDetails,
    getFileHistory,
    getLog,
    getLogPage,
    getSoloLog,
    getSoloLogPage,
    listReflog,
    restoreReflog,
} from '../git'
import { handleRepo } from './core'

/** History slice IPC: graph log, commit details/body, file history, blame and reflog. */

export function registerHistoryIpc(): void {
    handleRepo('repo:log', (_limit?: number) => getLog(typeof _limit === 'number' ? _limit : 500))
    handleRepo('repo:logCached', (_limit?: number) => getCachedLog(typeof _limit === 'number' ? _limit : 500))
    handleRepo('repo:logPage', (_offset?: number, _limit?: number) =>
        getLogPage(typeof _offset === 'number' ? _offset : 0, typeof _limit === 'number' ? _limit : 500)
    )
    handleRepo('repo:logSolo', (branch?: string, _limit?: number) => getSoloLog(branch as string, typeof _limit === 'number' ? _limit : 500))
    handleRepo('repo:logSoloPage', (branch?: string, _offset?: number, _limit?: number) =>
        getSoloLogPage(branch as string, typeof _offset === 'number' ? _offset : 0, typeof _limit === 'number' ? _limit : 500)
    )
    handleRepo('commit:details', (hash: string) => getCommitDetails(hash as string))
    handleRepo('commit:body', (hash: string, _dir?: string) =>
        getCommitBody(hash as string, typeof _dir === 'string' && _dir ? (_dir as string) : undefined)
    )
    handleRepo('reflog:list', (limit?: number) => listReflog(typeof limit === 'number' ? limit : 100))
    handleRepo('reflog:restore', (ref: string) => restoreReflog(ref as string))
    handleRepo('file:history', (file: string) => getFileHistory(file as string))
    handleRepo('file:blame', (file: string, rev?: string) =>
        getBlame(file as string, typeof rev === 'string' && rev.trim() ? rev : undefined)
    )
}
