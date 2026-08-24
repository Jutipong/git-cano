import { useCallback, useEffect, useRef, useState } from 'react'
import type { CommitNode, MenuItem, RepoState, RepoStatus } from '@shared/types'
import Welcome from './components/Welcome'
import Toolbar from './components/Toolbar'
import TabBar from './components/TabBar'
import Sidebar from './components/Sidebar'
import GraphView from './components/GraphView'
import FilePanel from './components/FilePanel'
import DiffView from './components/DiffView'
import CommitDetails from './components/CommitDetails'
import ConflictBanner from './components/ConflictBanner'
import RebaseEditor from './components/RebaseEditor'
import FileHistoryModal from './components/FileHistoryModal'
import BlameModal from './components/BlameModal'
import ToolsModal from './components/ToolsModal'

const PAGE_SIZE = 500

interface Tab {
  path: string
  name: string
  status: RepoStatus
}

function loadSavedSession(): { paths: string[]; active: number } {
  try {
    const raw = localStorage.getItem('ogit-session')
    if (raw) return JSON.parse(raw) as { paths: string[]; active: number }
  } catch {}
  return { paths: [], active: 0 }
}

export default function App() {
  const [tabs, setTabs] = useState<Tab[]>([])
  const [activeTab, setActiveTab] = useState(0)
  const [commits, setCommits] = useState<CommitNode[]>([])
  const [logLimit, setLogLimit] = useState(PAGE_SIZE)
  const [hasMoreCommits, setHasMoreCommits] = useState(false)
  const [selectedFile, setSelectedFile] = useState<{ path: string; staged: boolean } | null>(null)
  const [selectedCommit, setSelectedCommit] = useState<CommitNode | null>(null)
  const [search, setSearch] = useState('')
  const [sidebarWidth, setSidebarWidth] = useState(244)
  const [rightPanelWidth, setRightPanelWidth] = useState(410)
  const [repoState, setRepoState] = useState<RepoState>({ merging: false, rebasing: false, bisectActive: false })
  const [rebaseBase, setRebaseBase] = useState<string | null>(null)
  const [historyFile, setHistoryFile] = useState<string | null>(null)
  const [blameFile, setBlameFile] = useState<string | null>(null)
  const [toolsOpen, setToolsOpen] = useState(false)
  const resizeRef = useRef<{ side: 'left' | 'right'; startX: number; startWidth: number } | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const repo = tabs[activeTab]?.status ?? null

  const notify = useCallback((msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 4000)
  }, [])

  /** open (or focus) a repository as a new tab */
  const addTab = useCallback((status: RepoStatus) => {
    void window.api.recentAdd(status.path).catch(() => {})
    setTabs((current) => {
      const existing = current.findIndex((tab) => tab.path === status.path)
      if (existing >= 0) {
        const next = [...current]
        next[existing] = { ...next[existing], status }
        setActiveTab(existing)
        return next
      }
      setActiveTab(current.length)
      return [...current, { path: status.path, name: status.name, status }]
    })
  }, [])

  const refresh = useCallback(async () => {
    try {
      const [status, log, branches, state] = await Promise.all([
        window.api.status(),
        window.api.log(logLimit),
        window.api.branches(),
        window.api.repoState(),
      ])
      setCommits(log)
      // git log with --max-count=N+1 tells us whether more exist
      setHasMoreCommits(log.length >= logLimit)
      setRepoState(state)
      setTabs((current) => {
        if (!current.length) return current
        const index = current.findIndex((tab) => tab.path === status.path)
        if (index === -1) return current
        const next = [...current]
        next[index] = { ...next[index], status }
        return next
      })
      return branches
    } catch (err) {
      notify(String(err))
      return undefined
    }
  }, [notify, logLimit])

  /* session restore: reopen previously opened repositories on first launch */
  const restoredRef = useRef(false)
  useEffect(() => {
    if (restoredRef.current) return
    restoredRef.current = true
    void (async () => {
      const saved = loadSavedSession()
      // no saved session -> fall back to the most recently used repository (if any)
      const paths = saved.paths.length
        ? saved.paths
        : (await window.api.recentList().catch(() => [] as string[])).slice(0, 1)
      let openedCount = 0
      for (const path of paths) {
        try {
          addTab(await window.api.openPath(path))
          openedCount++
        } catch {
          /* repo was moved/deleted — skip it */
        }
      }
      if (openedCount > 0 && saved.active > 0) {
        setActiveTab(Math.min(saved.active, openedCount - 1))
      }
    })()
  }, [addTab])

  /* persist open tabs for next launch */
  useEffect(() => {
    if (!tabs.length) return
    localStorage.setItem(
      'ogit-session',
      JSON.stringify({ paths: tabs.map((tab) => tab.path), active: activeTab }),
    )
  }, [tabs, activeTab])

  /* refresh whenever the active tab or its repo changes */
  useEffect(() => {
    if (!repo) return
    void window.api.setActiveRepo(repo.path).then(() => refresh()).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo?.path])

  useEffect(() => {
    if (!repo) return
    const id = setInterval(() => void refresh(), 8000)
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
      if (event.key.toLowerCase() === 'p' && event.shiftKey) {
        event.preventDefault()
        document.querySelector<HTMLButtonElement>('.tab-new')?.click()
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
      label: 'Create tag here…',
      action: () => void (async () => {
        const name = window.prompt(`Tag name at ${commit.shortHash}:`)
        if (name?.trim()) {
          try { await window.api.createTag(name.trim(), commit.hash); await refresh(); notify(`Tag ${name.trim()} created`) } catch (err) { notify(String(err).replace(/^Error:\s*/, '')) }
        }
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
      label: `Reset current branch to ${commit.shortHash} (hard)`,
      danger: true,
      separatorBefore: true,
      action: () => void (async () => {
        if (!window.confirm(`Hard reset "${repo?.branch}" to ${commit.shortHash}?\nAll uncommitted changes will be lost.`)) return
        try { await window.api.resetTo(commit.hash, 'hard'); await refresh(); notify(`Reset to ${commit.shortHash}`) } catch (err) { notify(String(err).replace(/^Error:\s*/, '')) }
      })(),
    },
  ], [repo, refresh, notify])

  const closeTab = async (index: number) => {
    const tab = tabs[index]
    const stillOpen = await window.api.closeRepo(tab.path)
    const remaining = tabs.filter((_, i) => i !== index)
    setTabs(remaining)
    setActiveTab((current) => Math.max(0, current > index ? current - 1 : Math.min(current, remaining.length - 1)))
    // closing the very last tab means the user ended their session -> start fresh next launch
    if (remaining.length === 0) localStorage.removeItem('ogit-session')
    if (!stillOpen) {
      setCommits([])
      setSelectedCommit(null)
    }
  }

  if (!repo) return <Welcome onOpened={addTab} notify={notify} />

  const conflicts = repo.files.filter((f) => f.staged === 'U' || f.unstaged === 'U').map((f) => f.path)

  return (
    <div className="app">
      <Toolbar repo={repo} refresh={refresh} notify={notify} search={search} onSearch={setSearch} bisectActive={repoState.bisectActive} onOpenTools={() => setToolsOpen(true)} />
      {(repoState.merging || repoState.rebasing || conflicts.length > 0) && (
        <ConflictBanner conflicts={conflicts} state={repoState} refresh={refresh} notify={notify} />
      )}
      <TabBar tabs={tabs} activeIndex={activeTab} onSelect={setActiveTab} onClose={(index) => void closeTab(index)} onOpenNew={() => void window.api.pickAndOpen().then((status) => status && addTab(status)).catch((err) => notify(String(err)))} />
      <div className="app-body">
        <Sidebar repo={repo} refresh={refresh} notify={notify} width={sidebarWidth} onInteractiveRebase={setRebaseBase} />
        <div className="panel-splitter" onMouseDown={(event) => beginResize('left', event)} />
        <div className="center-column">
          <GraphView
            commits={commits}
            query={search}
            hasMore={hasMoreCommits}
            onLoadMore={() => setLogLimit((limit) => limit + PAGE_SIZE)}
            onSelectCommit={setSelectedCommit}
            buildCommitMenu={buildCommitMenu}
          />
          {selectedCommit && <CommitDetails commit={selectedCommit} refresh={refresh} notify={notify} />}
        </div>
        <div className="panel-splitter" onMouseDown={(event) => beginResize('right', event)} />
        <div className="right-pane" style={{ width: rightPanelWidth, flexBasis: rightPanelWidth }}>
          <FilePanel
            files={repo.files}
            selected={selectedFile}
            onSelect={setSelectedFile}
            onChange={refresh}
            notify={notify}
            onShowHistory={setHistoryFile}
            onShowBlame={setBlameFile}
          />
          <DiffView file={selectedFile} refresh={refresh} notify={notify} />
        </div>
      </div>
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
      {historyFile && (
        <FileHistoryModal file={historyFile} onClose={() => setHistoryFile(null)} notify={notify} />
      )}
      {blameFile && <BlameModal file={blameFile} onClose={() => setBlameFile(null)} notify={notify} />}
      {toolsOpen && (
        <ToolsModal bisectActive={repoState.bisectActive} onClose={() => setToolsOpen(false)} refresh={refresh} notify={notify} />
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
