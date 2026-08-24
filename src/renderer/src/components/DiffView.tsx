import { useEffect, useState } from 'react'
import type { DiffLine } from '@shared/types'

interface Props {
  file: { path: string; staged: boolean } | null
}

export default function DiffView({ file }: Props) {
  const [lines, setLines] = useState<DiffLine[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!file) {
      setLines([])
      return
    }
    let cancelled = false
    setLoading(true)
    window.api
      .diff(file.path, file.staged)
      .then((l) => {
        if (!cancelled) setLines(l)
      })
      .catch(() => setLines([]))
      .finally(() => setLoading(false))
    return () => {
      cancelled = true
    }
  }, [file])

  if (!file)
    return (
      <div className="diff-view empty">
        <p>Select a file to view its diff</p>
      </div>
    )

  return (
    <div className="diff-view">
      <div className="diff-header">
        <strong>{file.path}</strong>
        <span className="chip">{file.staged ? 'staged' : 'working directory'}</span>
        {loading && <span className="muted">loading…</span>}
      </div>
      <div className="diff-body">
        {lines.map((l, i) => (
          <div key={i} className={`diff-line ${l.type}`}>
            <span className="ln">{l.oldNo ?? ''}</span>
            <span className="ln">{l.newNo ?? ''}</span>
            <pre>{l.text}</pre>
          </div>
        ))}
        {lines.length <= 1 && !loading && (
          <div className="diff-empty">No diff available (new or binary file?)</div>
        )}
      </div>
    </div>
  )
}
