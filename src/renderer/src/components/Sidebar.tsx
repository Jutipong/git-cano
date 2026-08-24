import { useEffect, useRef, useState } from 'react'
import { ChevronDown, GitBranch, GitMerge, Globe2, Plus, RefreshCw, Trash2 } from 'lucide-react'
import type { MenuItem, RepoStatus } from '@shared/types'
import StashPanel from './StashPanel'
import ContextMenu, { type MenuState } from './ContextMenu'

interface Props {
  repo: RepoStatus
  refresh: () => Promise<unknown>
  notify: (m: string) => void
  width?: number
  onInteractiveRebase: (baseRef: string) => void
}

export default function Sidebar({ repo, refresh, notify, width, onInteractiveRebase }: Props) {
  const [local, setLocal] = useState<{ name: string; current: boolean }[]>([])
  const [remote, setRemote] = useState<{ name: string; current: boolean }[]>([])
  const [showNew, setShowNew] = useState(false)
  const [newName, setNewName] = useState('')
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const loadBranches = () =>
    window.api.branches().then((branches) => {
      setLocal(branches.local)
      setRemote(branches.remote)
    }).catch(() => {})

  useEffect(() => {
    loadBranches()
  }, [repo])

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn()
      await refresh()
      loadBranches()
      notify(ok)
    } catch (err) {
      notify(String(err).replace(/^Error:\s*/, ''))
    }
  }

  const buildBranchMenu = (branch: { name: string; current: boolean }): MenuItem[] => [
    ...(branch.current ? [] : [{ label: `Checkout ${branch.name}`, action: () => void run(() => window.api.checkout(branch.name), `Checked out ${branch.name}`) }]),
    ...(branch.current ? [] : [{ label: 'Merge into HEAD', action: () => void run(() => window.api.mergeBranch(branch.name), `Merged ${branch.name}`) }, { label: 'Rebase onto this branch', action: () => void run(() => window.api.rebaseOnto(branch.name), `Rebased onto ${branch.name}`) }]),
    ...(!branch.current ? [{ label: 'Interactive rebase onto this branch…', separatorBefore: true as const, action: () => onInteractiveRebase(branch.name) }] : []),
    { label: 'Rename…', separatorBefore: true, action: () => {
        const next = window.prompt(`Rename branch "${branch.name}" to:`, branch.name)
        if (next && next !== branch.name) void run(() => window.api.renameBranch(branch.name, next.trim()), 'Branch renamed')
      } },
    ...(!branch.current ? [{ label: `Delete ${branch.name}`, danger: true, separatorBefore: true as const, action: () => {
        if (window.confirm(`Delete branch "${branch.name}"?`)) void run(() => window.api.deleteBranch(branch.name), `Deleted ${branch.name}`)
      } }] : []),
  ]

  const handleDrop = (targetBranch: string, event: React.DragEvent) => {
    event.preventDefault()
    setDropTarget(null)
    const payload = event.dataTransfer.getData('text/plain')
    if (!payload) return
    const [kind, value] = payload.split(':')
    if (kind === 'commit') {
      // dropping a commit on a branch offers to reset that branch to the commit
      const mode = window.confirm(
        `Reset "${targetBranch}" to commit ${value.slice(0, 7)}?\n\nOK = Hard reset (discard changes)\nCancel = Soft reset (keep changes staged)`,
      )
      void run(() => window.api.resetTo(value, mode ? 'hard' : 'soft'), `Reset ${targetBranch}`)
    } else if (kind === 'branch' && value !== targetBranch) {
      if (window.confirm(`Merge "${value}" into "${targetBranch}"?\n(This will checkout "${targetBranch}" first)`)) {
        void run(async () => {
          await window.api.checkout(targetBranch)
          await window.api.mergeBranch(value)
        }, `Merged ${value} into ${targetBranch}`)
      }
    }
  }

  return (
    <aside className="sidebar" style={width ? { width, flexBasis: width } : undefined}>
      <div className="sidebar-repo-card">
        <div className="sidebar-repo-icon"><GitBranch size={18} /></div>
        <div className="sidebar-repo-copy">
          <strong>{repo.name}</strong>
          <span>{repo.branch}</span>
        </div>
        <ChevronDown size={15} className="muted-icon" />
      </div>

      <div className="sidebar-section">
        <div className="section-header">
          <h3>LOCAL BRANCHES <span>{local.length}</span></h3>
          <button className="icon-btn accent-icon" title="New branch" onClick={() => setShowNew((value) => !value)}>
            <Plus size={15} />
          </button>
        </div>

        {showNew && (
          <form
            className="new-branch"
            onSubmit={(event) => {
              event.preventDefault()
              if (!newName.trim()) return
              void run(() => window.api.createBranch(newName.trim(), true), `Created branch ${newName}`)
              setNewName('')
              setShowNew(false)
            }}
          >
            <input ref={inputRef} autoFocus placeholder="New branch name" value={newName} onChange={(event) => setNewName(event.target.value)} />
            <button type="submit" className="btn primary small">Create</button>
          </form>
        )}

        {local.map((branch) => (
          <div
            key={branch.name}
            className={`branch-row${branch.current ? ' current' : ''}${dropTarget === branch.name ? ' drop-target' : ''}`}
            onClick={() => !branch.current && void run(() => window.api.checkout(branch.name), `Checked out ${branch.name}`)}
            onContextMenu={(event) => {
              event.preventDefault()
              setMenu({ x: event.clientX, y: event.clientY, items: buildBranchMenu(branch) })
            }}
            draggable={!branch.current}
            onDragStart={(event) => event.dataTransfer.setData('text/plain', `branch:${branch.name}`)}
            onDragOver={(event) => {
              if (event.dataTransfer.types.includes('text/plain')) {
                event.preventDefault()
                setDropTarget(branch.name)
              }
            }}
            onDragLeave={() => setDropTarget(null)}
            onDrop={(event) => handleDrop(branch.name, event)}
          >
            <GitBranch size={14} />
            <span className="branch-name">{branch.name}</span>
            {branch.current && <span className="current-badge">HEAD</span>}
            <span className="row-actions">
              {!branch.current && (
                <>
                  <button className="icon-btn" title="Merge into current branch" onClick={(event) => { event.stopPropagation(); void run(() => window.api.mergeBranch(branch.name), `Merged ${branch.name}`) }}>
                    <GitMerge size={14} />
                  </button>
                  <button className="icon-btn danger" title="Delete branch" onClick={(event) => {
                    event.stopPropagation()
                    if (window.confirm(`Delete branch "${branch.name}"?`)) void run(() => window.api.deleteBranch(branch.name), `Deleted ${branch.name}`)
                  }}>
                    <Trash2 size={14} />
                  </button>
                </>
              )}
            </span>
          </div>
        ))}
      </div>

      <div className="sidebar-section remote-section">
        <div className="section-header">
          <h3>REMOTE BRANCHES <span>{remote.length}</span></h3>
        </div>
        {remote.length === 0 && <div className="sidebar-empty"><Globe2 size={13} /> Fetch a remote to see branches</div>}
        {remote.map((branch) => (
          <div key={branch.name} className="branch-row remote" title="Checkout remote branch" onClick={() => void run(() => window.api.checkout(branch.name.replace(/^remotes\//, '')), `Checked out ${branch.name}`)}>
            <Globe2 size={14} />
            <span>{branch.name.replace(/^remotes\//, '')}</span>
          </div>
        ))}
      </div>

      <StashPanel repoPath={repo.path} refresh={refresh} notify={notify} />

      <div className="sidebar-bottom">
        <button className="sidebar-bottom-button" onClick={() => void run(refresh, 'Refreshed')}>
          <RefreshCw size={14} /> Refresh repository
        </button>
      </div>

      <ContextMenu menu={menu} onClose={() => setMenu(null)} />
    </aside>
  )
}
