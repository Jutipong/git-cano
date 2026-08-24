import { useEffect, useState } from 'react'

export default function Welcome({ onOpened, notify }: { onOpened: () => void; notify: (m: string) => void }) {
  const [recent, setRecent] = useState<string[]>([])
  const [cloneUrl, setCloneUrl] = useState('')

  useEffect(() => {
    window.api.recentList().then(setRecent).catch(() => {})
  }, [])

  const open = async (fn: () => Promise<unknown>) => {
    try {
      await fn()
      onOpened()
    } catch (err) {
      notify(String(err).replace(/^Error:\s*/, ''))
    }
  }

  return (
    <div className="welcome">
      <h1>🐙 GitKraken X</h1>
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
        <button
          className="btn"
          disabled={!cloneUrl.trim()}
          onClick={() => void open(() => window.api.clone(cloneUrl.trim()))}
        >
          Clone URL
        </button>
      </div>

      {recent.length > 0 && (
        <div className="recent">
          <h3>Recent repositories</h3>
          {recent.map((r) => (
            <div key={r} className="recent-item" onClick={() => void open(() => window.api.openPath(r))}>
              📂 {r}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
