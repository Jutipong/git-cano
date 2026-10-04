export interface WorkspaceRepoEntry {
    /** Absolute repo path — the switch target. */
    path: string
    /** Repo folder name, matching `RepoStatus.name`. */
    name: string
    /** Workspace that opens this repo. */
    workspace: string
    isCurrentWorkspace: boolean
    /** Only ever true for the current workspace's selected tab. */
    isActiveTab: boolean
}

/** Repo folder name from an absolute path — mirrors `path.basename(dir)` in the main process. */
export function repoNameFromPath(repoPath: string): string {
    const segments = repoPath.split(/[\\/]+/).filter(Boolean)
    return segments[segments.length - 1] ?? repoPath
}

/**
 * Every repository open in ANY workspace, for cross-workspace search (the command palette's `Repo…`
 * mode). The current workspace leads — its live tabs first (they carry the real names and the active
 * flag), then other workspaces in `names` order following their persisted session.
 *
 * The same repo MAY appear once per workspace that opens it, and those rows are deliberately NOT deduped:
 * each row is its own "switch to that workspace with this repo focused" target, so collapsing them would
 * make the other workspaces look like they don't hold the repo at all. Only the current workspace is
 * guarded, since its live tabs and its persisted session can list the same path twice mid-switch.
 *
 * Sessions of *other* workspaces are persisted path lists, so their names are derived from the path — the
 * folder is gone by the time we look anyway.
 */
export function collectWorkspaceRepos(
    names: string[],
    activeWorkspace: string,
    sessions: Record<string, { paths: string[] } | undefined>,
    tabs: { path: string; name: string }[],
    activeTab: number
): WorkspaceRepoEntry[] {
    const entries: WorkspaceRepoEntry[] = []
    const seen = new Set<string>()
    const claim = (repoPath: string) => {
        if (seen.has(repoPath)) return false
        seen.add(repoPath)
        return true
    }

    for (const [index, tab] of tabs.entries()) {
        if (!claim(tab.path)) continue
        entries.push({
            path: tab.path,
            name: tab.name,
            workspace: activeWorkspace,
            isCurrentWorkspace: true,
            isActiveTab: index === activeTab,
        })
    }
    // `switchWorkspace` empties `tabs` before reopening the destination, so the palette (openable
    // mid-switch) can still find the repos of the workspace it is already in.
    for (const repoPath of sessions[activeWorkspace]?.paths ?? []) {
        if (!claim(repoPath)) continue
        entries.push({
            path: repoPath,
            name: repoNameFromPath(repoPath),
            workspace: activeWorkspace,
            isCurrentWorkspace: true,
            isActiveTab: false,
        })
    }
    // Deliberately NOT deduped across workspaces — one row per (workspace, path) pair, which is what the
    // palette keys on. Only a path repeated *inside one* session is collapsed, so a pair can never repeat.
    for (const workspace of names) {
        if (workspace === activeWorkspace) continue
        const claimed = new Set<string>()
        for (const repoPath of sessions[workspace]?.paths ?? []) {
            if (claimed.has(repoPath)) continue
            claimed.add(repoPath)
            entries.push({
                path: repoPath,
                name: repoNameFromPath(repoPath),
                workspace,
                isCurrentWorkspace: false,
                isActiveTab: false,
            })
        }
    }
    return entries
}