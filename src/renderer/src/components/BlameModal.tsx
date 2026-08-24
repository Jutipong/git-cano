import { useEffect, useState } from 'react'
import { X } from 'lucide-react'

interface BlameLine {
  hash: string
  author: string
  date: string
  lineNumber: number
  content: string
}

interface Props {
  file: string
  onClose: () => void
  notify: (message: string) => void
}

export default function BlameModal({ file, onClose, notify }: Props) {
  const [lines, setLines] = useState<BlameLine[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    window.api.blame(file).then(setLines).catch((error) =>
      notify(String(error).replace(/^Error:\s*/, ''))
    ).finally(() => setLoading(false))
  }, [file, notify])

  // alternate background per commit block for readability
  let blockIndex = -1
  let lastHash = ''
  const shadeOf = new Map<string, number>()
  for (const line of lines) {
    if (!shadeOf.has(line.hash)) shadeOf.set(line.hash, ++blockIndex % 2)
    lastHash = lastHash // no-op keep order stable
  }

  return (
    <div className="modal-overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="rebase-modal blame-modal">
        <div className="rebase-modal-header">
          <strong>Blame</strong>
          <code className="rebase-base">{file}</code>
          <span className="spacer" />
          {loading && <span className="muted">loading…</span>}
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="blame-body">
          {lines.map((line) => (
            <div key={line.lineNumber} className={`blame-line shade-${shadeOf.get(line.hash) ?? 0}`}>
              <code className="blame-hash">{line.hash.slice(0, 7)}</code>
              <span className="blame-author">{line.author}</span>
              <span className="blame-date">{new Date(line.date).toLocaleDateString(undefined, { year: '2-digit', month: 'short', day: 'numeric' })}</span>
              <span className="blame-ln">{line.lineNumber}</span>
              <pre>{line.content}</pre>
            </div>
          ))}
          {!loading && lines.length === 0 && <div className="sidebar-empty">Nothing to blame</div>}
        </div>
      </div>
    </div>
  )
}
