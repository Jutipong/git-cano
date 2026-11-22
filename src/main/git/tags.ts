import { authGitEnv } from '../auth'
import { baseEnv, getRepo, plainGit, withAuthEnv } from './repo'

/** Tag slice: list/create/delete tags and their remote counterparts. */

export interface TagRef {
    name: string
    hash: string
}

export async function listTags(): Promise<TagRef[]> {
    const { git: g } = getRepo()
    const SEP = '\x1f'
    const text = await g.raw([
        'for-each-ref',
        'refs/tags',
        '--sort=refname', // tiebreak for equal dates
        '--sort=-creatordate', // primary: newest → oldest by creation date
        // `%(refname:short)` disambiguates against same-named branches (tag `backup` →
        // `tags/backup`), and that name then fails `git tag -d`. `lstrip=2` always strips
        // exactly `refs/tags/`, so the name round-trips through delete/push unchanged.
        `--format=%(refname:lstrip=2)${SEP}%(*objectname)${SEP}%(objectname)`,
    ])
    return text
        .split('\n')
        .filter(Boolean)
        .map(line => {
            const [name, peeled, object] = line.split(SEP)
            return { name, hash: peeled || object }
        })
}

export async function createTag(name: string, targetHash: string | null, message?: string): Promise<void> {
    const { git: g } = getRepo()
    if (!name.trim()) throw new Error('Tag name is required')
    const args = ['tag']
    if (message?.trim()) args.push('-a', name.trim(), '-m', message.trim())
    else args.push(name.trim())
    if (targetHash) args.push(targetHash)
    await g.raw(args)
}

export async function deleteTag(name: string): Promise<void> {
    const { git: g } = getRepo()
    await g.raw(['tag', '-d', name])
}

export async function pushTag(name: string): Promise<string> {
    await withAuthEnv(git => git.push(['origin', `refs/tags/${name.trim()}`]))
    return `Tag ${name.trim()} pushed`
}

export async function listRemoteTags(): Promise<string[]> {
    const { path: p } = getRepo()
    // Use a separate git instance so this network request cannot block local status/log operations.
    const remoteGit = plainGit(p)
    remoteGit.env({ ...baseEnv(), ...authGitEnv() })
    try {
        const out = await remoteGit.raw(['ls-remote', '--tags', 'origin'])
        const names = new Set<string>()
        for (const line of out.split('\n')) {
            const ref = line.split('\t')[1] ?? ''
            if (!ref.startsWith('refs/tags/')) continue
            names.add(ref.slice('refs/tags/'.length).replace(/\^\{\}$/, ''))
        }
        return [...names]
    } catch {
        return []
    }
}

export async function deleteRemoteTag(name: string): Promise<string> {
    await withAuthEnv(git => git.push(['origin', `:refs/tags/${name.trim()}`]))
    return `Remote tag ${name.trim()} deleted`
}
