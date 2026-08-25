// Shared types between main / preload / renderer

export interface CommitNode {
    hash: string
    shortHash: string
    parents: string[]
    author: string
    date: string
    subject: string
    /** commit body (everything after the title line) — only fetched for the graph log */
    body?: string
    refs: string[] // e.g. ["HEAD -> main", "origin/main", "tag: v1.0"]
    lane: number
}

export interface FileEntry {
    path: string
    /** Index (staged) status: ' ' | A | M | D | R | C | U */
    staged: string
    /** Working dir status: ' ' | M | D | ? | U */
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
    /** commit SHA this branch points to */
    commitHash?: string
    /** commits on this branch not yet pushed to upstream */
    ahead?: number
    /** commits on upstream not yet pulled */
    behind?: number
}

export interface DiffLine {
    type: 'add' | 'del' | 'ctx' | 'hunk' | 'meta'
    oldNo: number | null
    newNo: number | null
    text: string
}

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
    /** accent color for the row: green (apply-like) or orange (pop-like) */
    tone?: 'green' | 'orange'
    /** icon key rendered before the label — must exist in ContextMenu's icon registry */
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
