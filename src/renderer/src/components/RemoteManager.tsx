import { useEffect, useState } from 'react'
import { Link2Off, Plus, Tag as TagIcon, X } from 'lucide-react'

interface Props {
  onClose: () => void
  refresh: () => Promise<unknown>
  notify: (message: string) => void
}

interface RemoteEntry { name: string; url: string }

export default function RemoteManager({ onClose, refresh, notify }: Props) {
  const [remotes, setRemotes] = useState<RemoteEntry[]>([])
  const [newName, setNewName] = useState('')
  const [newUrl, setNewUrl] = useState('')
  const [editingUrl, setEditingUrl] = useState<Record<string, string>>({})

  const loadRemotes = () => window.api.remotesFull().then(setRemotes).catch((error) => notify(String(error)))
  useEffect(() => { void loadRemotes() }, [])

  const run = async (fn: () => Promise<unknown>, successMessage: string) => {
    try {
      await fn()
      await loadRemotes()
      await refresh()
      notify(successMessage)
    } catch (error) {
      notify(String(error).replace(/^Error:\s*/, ''))
    }
  }

  return (
    <div className="modal-overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="rebase-modal remote-modal">
        <div className="rebase-modal-header">
          <strong>Manage remotes</strong>
          <span className="spacer" />
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>

        <div className="remote-list">
          {remotes.map((remote) => (
            <div className="remote-row" key={remote.name}>
              <TagIcon size={13} />
              <strong>{remote.name}</strong>
              <input
                className="remote-url"
                value={editingUrl[remote.name] ?? remote.url}
                onChange={(event) => setEditingUrl((current) => ({ ...current, [remote.name]: event.target.value }))}
              />
              {(editingUrl[remote.name] ?? remote.url) !== remote.url && (
                <button className="detail-action" onClick={() => void run(() => window.api.setRemoteUrl(remote.name, editingUrl[remote.name]), `URL of ${remote.name} updated`)}>
                  Save URL
                </button>
              )}
              <button className="icon-btn danger" title={`Remove ${remote.name}`} onClick={() => {
                if (window.confirm(`Remove remote "${remote.name}"?`)) void run(() => window.api.removeRemote(remote.name), `Remote ${remote.name} removed`)
              }}>
                <Link2Off size={13} />
              </button>
            </div>
          ))}
          {remotes.length === 0 && <div className="sidebar-empty">No remotes configured</div>}
        </div>

        <div className="remote-add">
          <input placeholder="name" value={newName} onChange={(event) => setNewName(event.target.value)} />
          <input placeholder="https://github.com/user/repo.git" value={newUrl} onChange={(event) => setNewUrl(event.target.value)} />
          <button
            className="btn primary small"
            disabled={!newName.trim() || !newUrl.trim()}
            onClick={() => {
              void run(() => window.api.addRemote(newName.trim(), newUrl.trim()), `Remote ${newName} added`)
              setNewName(''); setNewUrl('')
            }}
          >
            <Plus size={13} /> Add remote
          </button>
        </div>

        <div className="rebase-modal-footer">
          <span className="rebase-hint">Editing a URL only changes where fetch/push points</span>
          <span className="spacer" />
          <button className="btn small" onClick={() => void run(() => window.api.fetch(), 'Fetched all remotes')}>Fetch all</button>
          <button className="btn primary small" onClick={() => void run(() => window.api.pushTags(), 'Tags pushed')}>Push tags</button>
        </div>
      </div>
    </div>
  )
}
