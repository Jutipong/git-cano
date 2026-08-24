import {
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  FolderGit2,
  GitBranch,
  MoreHorizontal,
  Moon,
  RefreshCw,
  Search,
  Sun,
} from 'lucide-react'
import type { RepoStatus } from '@shared/types'
import { useState } from 'react'

interface Props {
  repo: RepoStatus
  refresh: () => Promise<unknown>
  notify: (m: string) => void
  search: string
  onSearch: (value: string) => void
}

export default function Toolbar({ repo, refresh, notify, search, onSearch }: Props) {
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme ?? 'dark')

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    document.documentElement.dataset.theme = next
    localStorage.setItem('gkx-theme', next)
    notify(`${next === 'dark' ? 'Dark' : 'Light'} theme`)
  }
  const act = async (label: string, fn: () => Promise<unknown>) => {
    try {
      const result = await fn()
      await refresh()
      notify(result ? String(result) : `${label} completed`)
    } catch (err) {
      notify(String(err).replace(/^Error:\s*/, ''))
    }
  }

  return (
    <header className="toolbar">
      <div className="product-mark" aria-label="GitKraken X">
        <span className="product-mark-icon">G</span>
        <span>GitKraken X</span>
      </div>
      <div className="toolbar-divider" />
      <div className="repo-context">
        <FolderGit2 size={17} />
        <div className="repo-context-copy">
          <strong>{repo.name}</strong>
          <span title={repo.path}>{repo.path}</span>
        </div>
      </div>
      <div className="toolbar-divider" />
      <div className="branch-chip" title="Current branch">
        <GitBranch size={15} />
        <span>{repo.branch}</span>
        {repo.tracking && (
          <span className="ahead-behind">
            {repo.ahead > 0 && `↑${repo.ahead}`}
            {repo.behind > 0 && `↓${repo.behind}`}
          </span>
        )}
      </div>
      <div className="spacer" />
      <button className="toolbar-icon-button" title="Refresh" onClick={() => void act('Refresh', refresh)}>
        <RefreshCw size={16} />
      </button>
      <label className="commit-search" title="Search commits">
        <Search size={15} />
        <input placeholder="Search commits" value={search} onChange={(event) => onSearch(event.target.value)} />
        {search && <button type="button" className="search-clear" onClick={() => onSearch('')}>×</button>}
      </label>
      <div className="toolbar-divider" />
      <div className="remote-actions">
        <button className="toolbar-action" onClick={() => void act('Fetch', () => window.api.fetch())}>
          <ArrowDownToLine size={15} />
          <span>Fetch</span>
        </button>
        <button className="toolbar-action" onClick={() => void act('Pull', () => window.api.pull())}>
          <ArrowDown size={15} />
          <span>Pull</span>
        </button>
        <button className="toolbar-action primary-action" onClick={() => void act('Push', () => window.api.push())}>
          <ArrowUp size={15} />
          <span>Push</span>
        </button>
      </div>
      <button className="toolbar-icon-button" title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} onClick={toggleTheme}>
        {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
      </button>
      <button className="toolbar-icon-button" title="More actions" onClick={() => notify('More actions are coming soon')}>
        <MoreHorizontal size={18} />
      </button>
    </header>
  )
}
