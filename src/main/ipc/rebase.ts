import { getRebasePlan, getSquashPlan, squashCommits, startInteractiveRebase } from '../git'
import { handleRepo } from './core'

/** History-rewrite IPC: interactive rebase planning/start and HEAD-range squash. */

export function registerRebaseIpc(): void {
    handleRepo('rebase:plan', (ref: string, _dir?: string) =>
        getRebasePlan(ref as string, typeof _dir === 'string' && _dir ? (_dir as string) : undefined)
    )
    handleRepo('rebase:start', (baseRef: string, entries, _dir?: string) =>
        startInteractiveRebase(
            baseRef as string,
            entries as never[],
            typeof _dir === 'string' && _dir ? (_dir as string) : undefined
        )
    )
    handleRepo('squash:plan', (target: string) => getSquashPlan(target as string))
    handleRepo('squash:run', (base: string, message: string) => squashCommits(base as string, message as string))
}
