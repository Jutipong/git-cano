import { useCallback, useEffect, useRef, useState } from 'react'
import type { CommitNode, MenuItem, RepoState, RepoStatus } from '@shared/types'
import Welcome from './components/Welcome'
import Toolbar from './components/Toolbar'
import Sidebar from './components/Sidebar'
import GraphView from './components/GraphView'
import FilePanel from './components/FilePanel'
import DiffView from './components/DiffView'
import CommitDetails from './components/CommitDetails'
import ConflictBanner from './components/ConflictBanner'
import RebaseEditor from './components/RebaseEditor'

export default function App() {
  const [repo, setRepo] = useState<RepoStatus | null>(null)
  const [commits, setCommits] = useState<CommitNode[]>([])
  const [selectedFile, setSelectedFile] = useState<{ path: string; staged: boolean } | null>(null)
  const [selectedCommit, setSelectedCommit] = useState<CommitNode | null>(null)
  const [search, setSearch] = useState('')
  const [sidebarWidth, setSidebarWidth] = useState(244)
  const [rightPanelWidth, setRightPanelWidth] = useState(410)
  const [repoState, setRepoState] = useState<RepoState>({ merging: false, rebasing: false })
  const [rebaseBase, setRebaseBase] = useState<string | null>(null)
  const resizeRef = useRef<{ side: 'left' | 'right'; startX: number; startWidth: number } | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const notify = useCallback((msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 4000)
  }, [])

  const refresh = useCallback(async () => {
    try {
      const [status, log, branches, state] = await Promise.all([
        window.api.status(),
        window.api.log(),
        window.api.branches(),
        window.api.repoState(),
      ])
      setCommits(log)
      setRepo(status)
      setRepoState(state)
      return branches
    } catch (err) {
      notify(String(err))
      return undefined
    }
  }, [notify])

  useEffect(() => {
    if (!repo) return
    const id = setInterval(() => void refresh(), 5000)
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return
      if (event.key.toLowerCase() === 'r' && !event.shiftKey) {
        event.preventDefault()
        void refresh()
        notify('Repository refreshed')
      }
      if (event.shiftKey && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        document.querySelector<HTMLInputElement>('.commit-search input')?.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      clearInterval(id)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [repo, refresh, notify])

  const beginResize = (side: 'left' | 'right', event: React.MouseEvent) => {
    event.preventDefault()
    resizeRef.current = { side, startX: event.clientX, startWidth: side === 'left' ? sidebarWidth : rightPanelWidth }
    const onMove = (moveEvent: MouseEvent) => {
      const resize = resizeRef.current
      if (!resize) return
      const delta = moveEvent.clientX - resize.startX
      if (resize.side === 'left') setSidebarWidth(Math.min(380, Math.max(190, resize.startWidth + delta)))
      else setRightPanelWidth(Math.min(600, Math.max(320, resize.startWidth - delta)))
    }
    const onEnd = () => {
      resizeRef.current = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onEnd)
    }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onEnd)
  }

  const buildCommitMenu = useCallback((commit: CommitNode): MenuItem[] => [
    {
      label: `Checkout ${commit.shortHash}`,
      action: () => void (async () => {
        try { await window.api.checkoutCommit(commit.hash); await refresh(); notify(`Checked out ${commit.shortHash}`) } catch (err) { notify(String(err).replace(/^Error:\s*/, '')) }
      })(),
    },
    {
      label: 'Create branch here…',
      action: () => void (async () => {
        const name = window.prompt(`Create branch at ${commit.shortHash}:`)
        if (name?.trim()) {
          try { await window.api.createBranch(name.trim(), false); await refresh(); notify(`Created branch ${name.trim()}`) } catch (err) { notify(String(err).replace(/^Error:\s*/, '')) }
        }
      })(),
    },
    {
      label: 'Cherry-pick onto HEAD',
      separatorBefore: true,
      action: () => void (async () => {
        try { await window.api.cherryPick(commit.hash); await refresh(); notify('Cherry-picked') } catch (err) { notify(String(err).replace(/^Error:\s*/, '')) }
      })(),
    },
    {
      label: 'Revert this commit',
      action: () => void (async () => {
        if (!window.confirm(`Revert commit ${commit.shortHash}?`)) return
        try { await window.api.revertCommit(commit.hash); await refresh(); notify('Commit reverted') } catch (err) { notify(String(err).replace(/^Error:\s*/, '')) }
      })(),
    },
    {
      label: 'Interactive rebase onto this commit…',
      separatorBefore: true,
      action: () => setRebaseBase(commit.hash),
    },
    {
      label: `Reset current branch to ${commit.shortHash} (hard)`,
      danger: true,
      separatorBefore: true,
      action: () => void (async () => {
        if (!window.confirm(`Hard reset "${repo?.branch}" to ${commit.shortHash}?\nAll uncommitted changes will be lost.`)) return
        try { await window.api.resetTo(commit.hash, 'hard'); await refresh(); notify(`Reset to ${commit.shortHash}`) } catch (err) { notify(String(err).replace(/^Error:\s*/, '')) }
      })(),
    },
  ], [repo, refresh, notify])

  if (!repo) return <Welcome onOpened={() => void refresh()} notify={notify} />

  const conflicts = repo.files.filter((f) => f.staged === 'U' || f.unstaged === 'U').map((f) => f.path)

  return (
    <div className="app">
      <Toolbar repo={repo} refresh={refresh} notify={notify} search={search} onSearch={setSearch} />
      {(repoState.merging || repoState.rebasing || conflicts.length > 0) && (
        <ConflictBanner conflicts={conflicts} state={repoState} refresh={refresh} notify={notify} />
      )}
      {rebaseBase && (
        <RebaseEditor
          baseRef={rebaseBase}
          onCancel={() => setRebaseBase(null)}
          onComplete={(message) => {
            setRebaseBase(null)
            void refresh()
            notify(message)
          }}
        />
      )}
      <div className="app-body">
        <Sidebar repo={repo} refresh={refresh} notify={notify} width={sidebarWidth} onInteractiveRebase={setRebaseBase} />
        <div className="panel-splitter" onMouseDown={(event) => beginResize('left', event)} />
        <div className="center-column">
          <GraphView commits={commits} query={search} onSelectCommit={setSelectedCommit} buildCommitMenu={buildCommitMenu} />
          {selectedCommit && <CommitDetails commit={selectedCommit} refresh={refresh} notify={notify} />}
        </div>
        <div className="panel-splitter" onMouseDown={(event) => beginResize('right', event)} />
        <div className="right-pane" style={{ width: rightPanelWidth, flexBasis: rightPanelWidth }}>
          <FilePanel files={repo.files} selected={selectedFile} onSelect={setSelectedFile} onChange={refresh} notify={notify} />
          <DiffView file={selectedFile} />
        </div>
      </div>
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
