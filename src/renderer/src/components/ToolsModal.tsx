import { useEffect, useState } from 'react'
import { Check, FolderPlus, Trash2, X } from 'lucide-react'

interface Props {
  bisectActive: boolean
  onClose: () => void
  refresh: () => Promise<unknown>
  notify: (message: string) => void
}

export default function ToolsModal({ bisectActive, onClose, refresh, notify }: Props) {
  const [tab, setTab] = useState<'bisect' | 'worktrees' | 'submodules'>('bisect')
  const [badRef, setBadRef] = useState('')
  const [goodRef, setGoodRef] = useState('')
  const [currentCommit, setCurrentCommit] = useState<string | null>(null)
  const [worktrees, setWorktrees] = useState<{ path: string; head: string; branch: string | null }[]>([])
  const [newWtPath, setNewWtPath] = useState('')
  const [newWtBranch, setNewWtBranch] = useState('')
  const [submodules, setSubmodules] = useState<string[]>([])

  useEffect(() => {
    if (tab === 'worktrees') void window.api.worktrees().then(setWorktrees).catch(() => {})
    if (tab === 'submodules') void window.api.submodules().then(setSubmodules).catch(() => {})
    if (tab === 'bisect' && bisectActive) {
      void window.api.log(1).then((log) => log[0] && setCurrentCommit(log[0].shortHash)).catch(() => {})
    }
  }, [tab, bisectActive])

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn()
      await refresh()
      notify(ok)
    } catch (error) {
      notify(String(error).replace(/^Error:\s*/, ''))
    }
  }

  return (
    <div className="modal-overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="rebase-modal tools-modal">
        <div className="rebase-modal-header">
          <strong>Advanced tools</strong>
          <span className="spacer" />
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="tools-tabs">
          {(['bisect', 'worktrees', 'submodules'] as const).map((name) => (
            <button key={name} className={`graph-filter${tab === name ? ' active' : ''}`} onClick={() => setTab(name)}>{name}</button>
          ))}
        </div>

        <div className="tools-body">
          {tab === 'bisect' && (
            bisectActive ? (
              <>
                <p className="tools-hint">Bisect in progress. Current commit:</p>
                <code className="rebase-base">{currentCommit ?? '…'}</code>
                <div className="tools-actions">
                  <button className="btn small" onClick={() => void run(() => window.api.bisectMark('good'), 'Marked good')}>Good</button>
                  <button className="btn danger small" onClick={() => void run(() => window.api.bisectMark('bad'), 'Marked bad')}>Bad</button>
                  <button className="btn small" onClick={() => void run(() => window.api.bisectMark('skip'), 'Skipped')}>Skip</button>
                  <span className="spacer" />
                  <button className="btn primary small" onClick={() => void run(() => window.api.bisectReset(), 'Bisect finished')}>Finish bisect</button>
                </div>
              </>
            ) : (
              <>
                <p className="tools-hint">Find the commit that introduced a bug by marking a known-bad and known-good ref.</p>
                <input placeholder="Bad ref (e.g. HEAD or main)" value={badRef} onChange={(event) => setBadRef(event.target.value)} />
                <input placeholder="Good ref (optional)" value={goodRef} onChange={(event) => setGoodRef(event.target.value)} />
                <div className="tools-actions">
                  <button
                    className="btn primary small"
                    disabled={!badRef.trim()}
                    onClick={() => {
                      void run(async () => {
                        await window.api.bisectStart(badRef.trim(), goodRef.trim() || undefined)
                        await refresh()
                      }, 'Bisect started')
                    }}
                  >
                    Start bisect
                  </button>
                </div>
              </>
            )
          )}

          {tab === 'worktrees' && (
            <>
              {worktrees.map((wt) => (
                <div className="remote-row" key={wt.path}>
                  <FolderPlus size={13} />
                  <code>{wt.path}</code>
                  <span className="muted">{wt.branch ? `⎇ ${wt.branch}` : wt.head.slice(0, 7)}</span>
                  <span className="spacer" />
                  {!wt.path.endsWith('(bare)') && wt.branch !== null && (
                    <button className="icon-btn danger" title="Remove worktree" onClick={() => {
                      if (window.confirm(`Remove worktree "${wt.path}"?`)) void run(() => window.api.removeWorktree(wt.path), 'Worktree removed')
                    }}><Trash2 size={13} /></button>
                  )}
                </div>
              ))}
              <div className="remote-add">
                <input placeholder="/path/to/worktree" value={newWtPath} onChange={(event) => setNewWtPath(event.target.value)} />
                <input placeholder="new branch name (optional)" value={newWtBranch} onChange={(event) => setNewWtBranch(event.target.value)} />
                <button className="btn primary small" disabled={!newWtPath.trim()} onClick={() => {
                  void run(() => window.api.addWorktree(newWtPath.trim(), newWtBranch.trim() || undefined), 'Worktree added')
                  setNewWtPath(''); setNewWtBranch('')
                }}>Add</button>
              </div>
            </>
          )}

          {tab === 'submodules' && (
            submodules.length > 0 ? (
              <>
                {submodules.map((name) => <div key={name} className="remote-row"><Check size={13} /><span>{name}</span></div>)}
                <div className="tools-actions">
                  <button className="btn primary small" onClick={() => void run(() => window.api.updateSubmodules(), 'Submodules updated')}>
                    Update all (--init --recursive)
                  </button>
                </div>
              </>
            ) : (
              <p className="tools-hint">This repository has no submodules (.gitmodules not found)</p>
            )
          )}
        </div>
      </div>
    </div>
  )
}
