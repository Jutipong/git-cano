import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import type { RepoStatus } from '@shared/types'

interface Props {
  onOpened: (status: RepoStatus) => void
  notify: (m: string) => void
}

export default function Welcome({ onOpened, notify }: Props) {
  const [recent, setRecent] = useState<string[]>([])
  const [cloneUrl, setCloneUrl] = useState('')

  useEffect(() => {
    window.api.recentList().then(setRecent).catch(() => {})
  }, [])

  const open = async (fn: () => Promise<RepoStatus | null>) => {
    try {
      const status = await fn()
      if (status) onOpened(status)
    } catch (err) {
      notify(String(err).replace(/^Error:\s*/, ''))
    }
  }

  const removeRecent = async (entry: string) => {
    await window.api.recentRemove(entry).catch(() => {})
    setRecent((current) => current.filter((item) => item !== entry))
  }

  return (
    <div className="welcome">
      <h1>🔱 Open Git</h1>
      <p className="tagline">A lightweight Git GUI — basic features only</p>

      <div className="welcome-actions">
        <button className="btn primary" onClick={() => void open(() => window.api.pickAndOpen())}>
          Open a Repository
        </button>
        <button className="btn" onClick={() => void open(() => window.api.init())}>
          Init New Repository
        </button>
      </div>

      <div className="clone-box">
        <input
          placeholder="https://github.com/user/repo.git"
          value={cloneUrl}
          onChange={(e) => setCloneUrl(e.target.value)}
        />
        <button className="btn" disabled={!cloneUrl.trim()} onClick={() => void open(() => window.api.clone(cloneUrl.trim()))}>
          Clone URL
        </button>
      </div>

      {recent.length > 0 && (
        <div className="recent">
          <h3>Recent repositories</h3>
          {recent.map((entry) => (
            <div key={entry} className="recent-item" onClick={() => void open(() => window.api.openPath(entry))}>
              <span className="recent-label">📂 {entry}</span>
              <button
                className="icon-btn recent-remove"
                title={`Remove ${entry} from list`}
                onClick={(event) => {
                  event.stopPropagation()
                  void removeRecent(entry)
                }}
              >
                <X size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
