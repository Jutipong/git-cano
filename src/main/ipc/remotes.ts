import {
    addRemote,
    createTag,
    deleteRemoteTag,
    deleteTag,
    fetchAll,
    hasRemote,
    listRemoteTags,
    listRemotes,
    listTags,
    pull,
    push,
    pushTag,
    setRemoteUrl,
    testRemoteUrl,
} from '../git'
import { handle, handleRepo } from './core'

/** Remote + tag slice IPC: fetch/push/pull, remote config and tag sync. */

export function registerRemotesIpc(): void {
    handleRepo('remote:fetch', () => fetchAll())
    handleRepo('remote:push', (force: boolean, _dir?: string) =>
        push(Boolean(force), typeof _dir === 'string' && _dir ? (_dir as string) : undefined)
    )
    handleRepo('remote:pull', (rebase: boolean) => pull(Boolean(rebase)))
    handleRepo('remote:has', () => hasRemote())
    handleRepo('remote:listFull', () => listRemotes())
    handleRepo('remote:addNew', (name: string, url: string) => addRemote(name as string, url as string))
    handleRepo('remote:setUrl', (name: string, url: string) => setRemoteUrl(name as string, url as string))
    // Not repo-gated: the URL test runs before a repository is involved.
    handle('remote:testUrl', (url: string) => testRemoteUrl(url as string))
    handleRepo('tag:list', () => listTags())
    handleRepo('tag:create', (name: string, hash: string | null, message?: string) =>
        createTag(name as string, (hash as string) || null, message as string | undefined)
    )
    handleRepo('tag:delete', (name: string) => deleteTag(name as string))
    handleRepo('tag:pushOne', (name: string) => pushTag(name as string))
    handleRepo('tag:remoteList', () => listRemoteTags())
    handleRepo('tag:remoteDelete', (name: string) => deleteRemoteTag(name as string))
}
