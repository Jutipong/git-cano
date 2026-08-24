import { Check, FileDiff, History, Minus, Plus, RotateCcw, ScanSearch } from 'lucide-react'
import { useState } from 'react'
import type { FileEntry } from '@shared/types'

interface Props {
  files: FileEntry[]
  selected: { path: string; staged: boolean } | null
  onSelect: (sel: { path: string; staged: boolean } | null) => void
  onChange: () => Promise<unknown>
  notify: (m: string) => void
  onShowHistory: (path: string) => void
  onShowBlame: (path: string) => void
}

const STATUS_LABEL: Record<string, string> = {
  M: 'Modified', A: 'Added', D: 'Deleted', '?': 'Untracked', R: 'Renamed', C: 'Copied', U: 'Conflict',
}

export default function FilePanel({ files, selected, onSelect, onChange, notify, onShowHistory, onShowBlame }: Props) {
  const staged = files.filter((file) => file.staged !== ' ' && file.staged !== '')
  const unstaged = files.filter((file) => file.staged === ' ' || file.staged === '')
  const [message, setMessage] = useState('')
  const [amend, setAmend] = useState(false)
  const [menu, setMenu] = useState<{ x: number; y: number; path: string } | null>(null)

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn()
      await onChange()
      notify(ok)
    } catch (err) {
      notify(String(err).replace(/^Error:\s*/, ''))
    }
  }

  const doCommit = async () => {
    if (!message.trim()) return notify('Enter a commit message first')
    if (amend && !window.confirm('Amend the last commit with the currently staged changes?')) return
    await run(() => window.api.commitWithAmend(message.trim(), amend), amend ? 'Commit amended' : 'Committed successfully')
    setMessage('')
    setAmend(false)
  }

  const toggleAmend = async () => {
    const next = !amend
    setAmend(next)
    if (next && !message.trim()) {
      try { setMessage(await window.api.lastCommitMessage().then((value) => value.split('\n')[0])) } catch { /* ignore */ }
    }
  }

  return (
    <div className="file-panel">
      <div className="panel-heading">
        <div className="panel-heading-title"><FileDiff size={16} /><strong>Changes</strong></div>
        <span className="panel-count">{files.length}</span>
      </div>
      <div className="commit-box">
        <label className="amend-toggle">
          <input type="checkbox" checked={amend} onChange={() => void toggleAmend()} />
          Amend last commit
        </label>
        <textarea
          placeholder="Summary of changes"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') void doCommit()
          }}
          rows={2}
        />
        <button className="btn primary commit-btn" disabled={!message.trim() || staged.length === 0} onClick={() => void doCommit()}>
          <Check size={15} /> {amend ? 'Amend commit' : 'Commit changes'} <kbd>⌘↵</kbd>
        </button>
        {staged.length === 0 && files.length > 0 && <div className="commit-hint">Stage at least one file to commit</div>}
      </div>

      <div className="file-groups">
        <div className="group-header">
          <h4>Staged files <span>{staged.length}</span></h4>
          {staged.length > 0 && <button className="link-btn" onClick={() => void run(() => window.api.unstageAll(), 'Unstaged all files')}>Unstage all</button>}
        </div>
        {staged.map((file) => (
          <FileRow
            key={`staged:${file.path}`}
            file={file}
            badge={file.staged}
            selected={selected?.path === file.path && selected.staged}
            onClick={() => onSelect({ path: file.path, staged: true })}
            action={<button className="icon-btn" title="Unstage" onClick={(event) => { event.stopPropagation(); void run(() => window.api.unstage([file.path]), 'File unstaged') }}><Minus size={14} /></button>}
          />
        ))}
        {staged.length === 0 && <div className="group-empty">No staged files</div>}

        <div className="group-header">
          <h4>Unstaged changes <span>{unstaged.length}</span></h4>
          {unstaged.length > 0 && <button className="link-btn" onClick={() => void run(() => window.api.stageAll(), 'Staged all files')}>Stage all</button>}
        </div>
        {unstaged.map((file) => (
          <FileRow
            key={`unstaged:${file.path}`}
            file={file}
            badge={file.unstaged}
            selected={selected?.path === file.path && !selected.staged}
            onClick={() => onSelect({ path: file.path, staged: false })}
            onContextMenu={(event) => {
              event.preventDefault()
              setMenu({ x: event.clientX, y: event.clientY, path: file.path })
            }}
            action={
              <>
                <button className="icon-btn" title="Stage" onClick={(event) => { event.stopPropagation(); void run(() => window.api.stage([file.path]), 'File staged') }}><Plus size={14} /></button>
                <button className="icon-btn danger" title="Discard changes" onClick={(event) => { event.stopPropagation(); if (window.confirm(`Discard changes to "${file.path}"?`)) void run(() => window.api.discardFile(file.path), 'Changes discarded') }}><RotateCcw size={13} /></button>
              </>
            }
          />
        ))}
        {unstaged.length === 0 && <div className="group-empty">Working tree clean</div>}
      </div>
      {menu && (
        <div className="context-menu" style={{ left: Math.min(menu.x, window.innerWidth - 200), top: Math.min(menu.y, window.innerHeight - 90) }} onMouseLeave={() => setMenu(null)}>
          <button className="context-menu-item" onClick={() => { onShowHistory(menu.path); setMenu(null) }}><History size={12} style={{ marginRight: 6 }} />View history</button>
          <button className="context-menu-item" onClick={() => { onShowBlame(menu.path); setMenu(null) }}><ScanSearch size={12} style={{ marginRight: 6 }} />Blame</button>
        </div>
      )}
    </div>
  )
}

function FileRow({ file, badge, selected, onClick, onContextMenu, action }: { file: FileEntry; badge: string; selected: boolean; onClick: () => void; onContextMenu?: (event: React.MouseEvent) => void; action?: React.ReactNode }) {
  const status = badge === '?' ? 'U' : badge
  return (
    <div className={`file-row${selected ? ' selected' : ''}`} onClick={onClick} onContextMenu={onContextMenu}>
      <span className={`badge b-${status.toLowerCase()}`}>{badge}</span>
      <span className="file-path" title={`${file.path} — ${STATUS_LABEL[badge] ?? ''}`}>{file.path}</span>
      {action}
    </div>
  )
}
