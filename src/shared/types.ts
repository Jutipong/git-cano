export interface CommitNode {
    hash: string
    shortHash: string
    parents: string[]
    author: string
    authorEmail?: string
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

/** What to do with uncommitted changes when checking out the new branch. */
export type LocalChangesMode = 'keep' | 'stash' | 'discard'

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

/** The three unmerged stages of a conflicted file (`:1:` base, `:2:` ours, `:3:` theirs). */
export interface ConflictVersions {
    ours: string | null
    base: string | null
    theirs: string | null
    binary: boolean
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

/** Peek at the latest undoable action without consuming it (drives the Undo toast button). */
export interface UndoPreview {
    id: number
    label: string
}

/** One `HEAD@{n}` reflog entry — newest first, index 0 is the current tip. */
export interface ReflogEntry {
    index: number
    hash: string
    shortHash: string
    selector: string
    action: string
    message: string
    date: string
}

export interface RepoState {
    merging: boolean
    rebasing: boolean
    cherryPicking: boolean
    bisectActive: boolean
    /** While merging: the branch (or short hash) being merged in — the "theirs" side. */
    mergeSource?: string | null
    /** While cherry-picking: short hash of the commit being picked — the "theirs" side. */
    cherryPickSource?: string | null
}

/** Result of a dry-run merge check (`git merge-tree --write-tree`). */
export interface MergeCheck {
    /** False when the installed git is too old for merge-tree --write-tree */
    supported: boolean
    /** Target can be fast-forwarded to source — no conflicts possible */
    fastForward: boolean
    /** Files that would conflict */
    conflicts: string[]
}

export type MergeMode = 'default' | 'ff-only' | 'no-ff'

export interface MenuItem {
    label: string
    action?: () => void
    danger?: boolean
    /** Teal accent (e.g. Solo) — mirrors danger, generic styling only */
    accent?: boolean
    icon?: string
    separatorBefore?: boolean
}

export interface OpenInTargets {
    /** Repo contains .NET solution/project files */
    csharp: boolean
    /** Path to Kiro.exe when Kiro IDE is installed */
    kiro: string | null
    /** Path to rider64.exe when Rider is installed */
    rider: string | null
    /** Path to devenv.exe when Visual Studio with the managed-desktop workload is installed */
    visualStudio: string | null
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

export interface SquashPlan {
    base: string
    target: string
    commits: CommitNode[]
    defaultMessage: string
    dirty: boolean
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
    /** Commit subject (`summary` in porcelain) — absent for uncommitted lines. */
    summary?: string
}

/** 'none' disables all AI features. */
export type AiProvider = 'opencode-go' | 'openrouter' | 'none'

/** Which working-tree changes to include as AI context: staged only, or everything. */
export type AiContextScope = 'staged' | 'all'

export interface AiProviderConfig {
    token: string
    modelId: string
    models: GoModel[]
}

export interface AiConfig {
    provider: AiProvider
    opencodeGo: AiProviderConfig
    openrouter: AiProviderConfig
    /** Extra user instructions appended to the commit-message system prompt (VS Code-style). */
    commitInstructions: string
}

export interface AiTestResult {
    ok: boolean
    message: string
}

export interface GoModel {
    id: string
    name: string
    /** Free-tier model (Zen free lineup or zero-price OpenRouter) — shows a Free badge. */
    free?: boolean
}

export interface RemoteTestResult {
    ok: boolean
    message: string
}

export interface AuthConfig {
    githubToken: string
    sshKeyPath: string
}

export interface SshKeyInfo {
    name: string
    publicKeyPath: string
    privateKeyPath: string
    publicKey: string
    fingerprint: string
    active: boolean
}

export interface SshTestResult {
    ok: boolean
    message: string
}

export interface GithubUser {
    login: string
    name: string
    email: string
    avatarUrl: string
    htmlUrl: string
    bio: string
    publicRepos: number
    followers: number
}

/** Progress pushed from the main process while electron-updater downloads (Setup .exe only). */
export interface UpdateProgress {
    percent: number
    bytesPerSecond: number
    transferred: number
    total: number
}
