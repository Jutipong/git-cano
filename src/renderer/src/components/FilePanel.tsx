import { Check, FileDiff, Minus, Plus, RotateCcw } from 'lucide-react'
import { useState } from 'react'
import type { FileEntry } from '@shared/types'

interface Props {
  files: FileEntry[]
  selected: { path: string; staged: boolean } | null
  onSelect: (sel: { path: string; staged: boolean } | null) => void
  onChange: () => Promise<unknown>
  notify: (m: string) => void
}

const STATUS_LABEL: Record<string, string> = {
  M: 'Modified', A: 'Added', D: 'Deleted', '?': 'Untracked', R: 'Renamed', C: 'Copied', U: 'Conflict',
}

export default function FilePanel({ files, selected, onSelect, onChange, notify }: Props) {
  const staged = files.filter((file) => file.staged !== ' ' && file.staged !== '')
  const unstaged = files.filter((file) => file.staged === ' ' || file.staged === '')
  const [message, setMessage] = useState('')

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
    await run(() => window.api.commit(message.trim()), 'Committed successfully')
    setMessage('')
  }

  return (
    <div className="file-panel">
      <div className="panel-heading">
        <div className="panel-heading-title"><FileDiff size={16} /><strong>Changes</strong></div>
        <span className="panel-count">{files.length}</span>
      </div>
      <div className="commit-box">
        <div className="commit-box-label">COMMIT MESSAGE</div>
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
          <Check size={15} /> Commit changes <kbd>⌘↵</kbd>
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
    </div>
  )
}

function FileRow({ file, badge, selected, onClick, action }: { file: FileEntry; badge: string; selected: boolean; onClick: () => void; action?: React.ReactNode }) {
  const status = badge === '?' ? 'U' : badge
  return (
    <div className={`file-row${selected ? ' selected' : ''}`} onClick={onClick}>
      <span className={`badge b-${status.toLowerCase()}`}>{badge}</span>
      <span className="file-path" title={`${file.path} — ${STATUS_LABEL[badge] ?? ''}`}>{file.path}</span>
      {action}
    </div>
  )
}
