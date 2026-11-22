/**
 * Barrel for the git feature slices. The data flow is renderer → preload → ipc/<feature>.ts → git/<feature>.ts → simple-git.
 * Keep new operations in the slice that owns the behaviour and re-export them here so main-process callers keep importing from './git'.
 */
export * from './repo'
export * from './undo'
export * from './history'
export * from './changes'
export * from './files'
export * from './preview'
export * from './commitContent'
export * from './stash'
export * from './branches'
export * from './remotes'
export * from './tags'
export * from './conflicts'
export * from './rebase'
export * from './commits'
export * from './format'
