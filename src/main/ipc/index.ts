import { registerAiIpc } from './ai'
import { registerAppIpc } from './app'
import { registerAuthIpc } from './auth'
import { registerBranchesIpc } from './branches'
import { registerChangesIpc } from './changes'
import { registerCommitsIpc } from './commits'
import { registerConflictsIpc } from './conflicts'
import { registerHistoryIpc } from './history'
import { registerRebaseIpc } from './rebase'
import { registerRemotesIpc } from './remotes'
import { registerRepoIpc } from './repo'
import { registerStashIpc } from './stash'
import { registerTerminalIpc } from './terminal'

/** Registers every IPC slice exactly once, before the first window is created. */
export function registerIpcHandlers(): void {
    registerAppIpc()
    registerRepoIpc()
    registerHistoryIpc()
    registerChangesIpc()
    registerStashIpc()
    registerBranchesIpc()
    registerRemotesIpc()
    registerConflictsIpc()
    registerRebaseIpc()
    registerCommitsIpc()
    registerAiIpc()
    registerAuthIpc()
    registerTerminalIpc()
}
