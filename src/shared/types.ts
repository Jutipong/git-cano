export interface CommitNode {
    hash: string
    shortHash: string
    parents: string[]
    author: string
    date: string
    subject: string
    body?: string
    refs: string[]
    lane: number
}

export interface FileEntry {
    path: string
    staged: string
    unstaged: string
}

export interface RepoStatus {
    path: string
    name: string
    branch: string
    tracking: string | null
    ahead: number
    behind: number
    files: FileEntry[]
}

export interface BranchInfo {
    name: string
    current: boolean
    detached?: boolean
    commitHash?: string
    ahead?: number
    behind?: number
}

export interface DiffLine {
    type: 'add' | 'del' | 'ctx' | 'hunk' | 'meta'
    oldNo: number | null
    newNo: number | null
    text: string
}

export interface DiffMeta {
    binary: boolean
    image: boolean
}

export type GitignoreRuleKind = 'file' | 'extension' | 'directory'

export interface ApiError {
    message: string
}

export interface CommitFile {
    path: string
    status: string
    additions: number
    deletions: number
}

export interface CommitDetails {
    hash: string
    message: string
    author: string
    email: string
    date: string
    parents: string[]
    files: CommitFile[]
    diff: DiffLine[]
}

export interface StashEntry {
    index: number
    hash: string
    message: string
    date: string
}

export interface RepoState {
    merging: boolean
    rebasing: boolean
    bisectActive: boolean
}

export interface MenuItem {
    label: string
    action?: () => void
    danger?: boolean
    tone?: 'green' | 'orange'
    icon?: string
    separatorBefore?: boolean
}

export type RebaseCommand = 'pick' | 'reword' | 'squash' | 'fixup' | 'drop' | 'edit' | 'split'

export interface RebaseEntry {
    command: RebaseCommand
    hash: string
    message?: string
}

export interface RebaseOutcome {
    completed: boolean
    message: string
}

export interface TagInfo {
    name: string
    hash: string
}

export interface RemoteInfo {
    name: string
    fetchUrl: string
    pushUrl: string
}

export interface WorktreeInfo {
    path: string
    head: string
    branch: string | null
}

export interface BlameLine {
    hash: string
    author: string
    date: string
    lineNumber: number
    content: string
}

export interface AiConfig {
    token: string
    modelId: string
}

export interface AiTestResult {
    ok: boolean
    message: string
}

export interface GoModel {
    id: string
    name: string
}

export interface RemoteTestResult {
    ok: boolean
    message: string
}
