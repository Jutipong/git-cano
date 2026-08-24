import { Archive, Check, ChevronDown, ChevronRight, Inbox, Plus, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { StashEntry } from '@shared/types'

interface Props {
  repoPath: string
  refresh: () => Promise<unknown>
  notify: (message: string) => void
}

export default function StashPanel({ repoPath, refresh, notify }: Props) {
  const [stashes, setStashes] = useState<StashEntry[]>([])
  const [expanded, setExpanded] = useState(false)
  const [creating, setCreating] = useState(false)
  const [message, setMessage] = useState('')

  const load = () => window.api.stashes().then(setStashes).catch(() => {})
  useEffect(() => { void load() }, [repoPath])

  const run = async (fn: () => Promise<unknown>, success: string) => {
    try {
      await fn()
      await load()
      await refresh()
      notify(success)
    } catch (error) {
      notify(String(error).replace(/^Error:\s*/, ''))
    }
  }

  const create = async () => {
    await run(() => window.api.createStash(message.trim() || 'WIP', true), 'Changes stashed')
    setMessage('')
    setCreating(false)
  }

  return (
    <div className="sidebar-section stash-section">
      <div className="section-header">
        <button className="section-toggle" onClick={() => setExpanded((value) => !value)}>
          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          <h3><Archive size={13} /> STASHES <span>{stashes.length}</span></h3>
        </button>
        <button className="icon-btn accent-icon" title="Create stash" onClick={() => { setExpanded(true); setCreating(true) }}>
          <Plus size={15} />
        </button>
      </div>
      {expanded && (
        <>
          {creating && (
            <div className="stash-create">
              <input autoFocus placeholder="Stash message" value={message} onChange={(event) => setMessage(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void create() }} />
              <div className="stash-create-actions">
                <button className="btn primary small" onClick={() => void create()}><Check size={13} /> Save</button>
                <button className="btn small" onClick={() => setCreating(false)}>Cancel</button>
              </div>
            </div>
          )}
          {stashes.length === 0 && !creating && <div className="sidebar-empty"><Inbox size={13} /> No stashes</div>}
          {stashes.map((stash) => (
            <div className="stash-row" key={`${stash.hash}-${stash.index}`}>
              <div className="stash-copy">
                <strong>{stash.message.replace(/^On [^:]+: /, '')}</strong>
                <span>{formatDate(stash.date)}</span>
              </div>
              <div className="stash-actions">
                <button className="icon-btn" title="Apply" onClick={() => void run(() => window.api.applyStash(stash.index, false), 'Stash applied')}>Apply</button>
                <button className="icon-btn" title="Pop" onClick={() => void run(() => window.api.applyStash(stash.index, true), 'Stash popped')}>Pop</button>
                <button className="icon-btn danger" title="Drop" onClick={() => { if (window.confirm(`Drop ${stash.message}?`)) void run(() => window.api.dropStash(stash.index), 'Stash dropped') }}><Trash2 size={13} /></button>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  )
}

function formatDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
