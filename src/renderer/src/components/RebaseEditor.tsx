import { ArrowDown, ArrowUp, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { CommitNode } from '@shared/types'

type Command = 'pick' | 'reword' | 'squash' | 'fixup' | 'drop'

interface Entry {
  command: Command
  hash: string
  shortHash: string
  author: string
  subject: string
  message: string
}

interface Props {
  baseRef: string
  onCancel: () => void
  onComplete: (message: string) => void
}

const COMMANDS: Command[] = ['pick', 'reword', 'squash', 'fixup', 'drop']

export default function RebaseEditor({ baseRef, onCancel, onComplete }: Props) {
  const [entries, setEntries] = useState<Entry[] | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    window.api.rebasePlan(baseRef).then((commits) => {
      if (cancelled) return
      setEntries(
        commits.map((commit: CommitNode) => ({
          command: 'pick' as Command,
          hash: commit.hash,
          shortHash: commit.shortHash,
          author: commit.author,
          subject: commit.subject,
          message: commit.subject,
        })),
      )
    }).catch((err) => setError(String(err).replace(/^Error:\s*/, '')))
    return () => { cancelled = true }
  }, [baseRef])

  const update = (index: number, patch: Partial<Entry>) => {
    setEntries((current) => current?.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)) ?? null)
  }

  const move = (index: number, delta: -1 | 1) => {
    setEntries((current) => {
      if (!current) return current
      const target = index + delta
      if (target < 0 || target >= current.length) return current
      const next = [...current]
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  const start = async () => {
    if (!entries) return
    setRunning(true)
    setError(null)
    try {
      const result = await window.api.rebaseExecute(
        baseRef,
        entries.map((entry) => ({ command: entry.command, hash: entry.hash, message: entry.message })),
      )
      onComplete(result)
    } catch (err) {
      setError(String(err).replace(/^Error:\s*/, ''))
      setRunning(false)
    }
  }

  const activeCount = entries?.filter((entry) => entry.command !== 'drop').length ?? 0

  return (
    <div className="modal-overlay" onMouseDown={(event) => event.target === event.currentTarget && !running && onCancel()}>
      <div className="rebase-modal">
        <div className="rebase-modal-header">
          <strong>Interactive rebase onto</strong>
          <code className="rebase-base">{baseRef}</code>
          <span className="spacer" />
          <button className="icon-btn" onClick={onCancel} disabled={running}><X size={16} /></button>
        </div>

        {error && <div className="rebase-error">{error}</div>}

        {!entries && !error && <div className="rebase-loading">Loading commits…</div>}

        {entries && entries.length === 0 && <div className="rebase-loading">No commits between HEAD and {baseRef}</div>}

        {entries && entries.length > 0 && (
          <div className="rebase-list">
            {entries.map((entry, index) => (
              <div className={`rebase-row${entry.command === 'drop' ? ' dropped' : ''}`} key={entry.hash}>
                <select
                  className={`rebase-command c-${entry.command}`}
                  value={entry.command}
                  onChange={(event) => update(index, { command: event.target.value as Command })}
                  disabled={running}
                >
                  {COMMANDS.map((command) => <option key={command} value={command}>{command}</option>)}
                </select>
                <code className="rebase-hash">{entry.shortHash}</code>
                <input
                  className="rebase-message"
                  value={entry.message}
                  placeholder={entry.subject}
                  disabled={running || (entry.command !== 'reword' && entry.command !== 'squash')}
                  onChange={(event) => update(index, { message: event.target.value })}
                />
                <span className="rebase-author">{entry.author}</span>
                <button className="icon-btn" title="Move up" disabled={running || index === 0} onClick={() => move(index, -1)}><ArrowUp size={13} /></button>
                <button className="icon-btn" title="Move down" disabled={running || index === entries.length - 1} onClick={() => move(index, 1)}><ArrowDown size={13} /></button>
                <button
                  className={`icon-btn${entry.command === 'drop' ? ' accent-icon' : ' danger'}`}
                  title={entry.command === 'drop' ? 'Restore commit' : 'Drop commit'}
                  disabled={running}
                  onClick={() => update(index, { command: entry.command === 'drop' ? 'pick' : 'drop' })}
                >
                  {entry.command === 'drop' ? '+' : <Trash2 size={13} />}
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="rebase-modal-footer">
          <span className="rebase-hint">
            Reword/Squash: edit the message · Fixup: keeps the previous message · Drag order via arrows
          </span>
          <span className="spacer" />
          <button className="btn small" onClick={onCancel} disabled={running}>Cancel</button>
          <button className="btn primary small" disabled={!entries || entries.length === 0 || running} onClick={() => void start()}>
            {running ? 'Rebasing…' : `Start rebase (${activeCount})`}
          </button>
        </div>
      </div>
    </div>
  )
}
