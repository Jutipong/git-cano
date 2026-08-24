import { useEffect, useState } from 'react'
import { GitCompare, X } from 'lucide-react'
import type { CommitNode } from '@shared/types'
import { renderDiffContent } from '../lib/highlight'

interface Props {
  file: string
  onClose: () => void
  notify: (message: string) => void
}

export default function FileHistoryModal({ file, onClose, notify }: Props) {
  const [history, setHistory] = useState<CommitNode[]>([])
  const [selectedHash, setSelectedHash] = useState<string | null>(null)
  const [diff, setDiff] = useState<string>('')

  useEffect(() => {
    window.api.fileHistory(file).then((commits) => {
      setHistory(commits)
      if (commits[0]) setSelectedHash(commits[0].hash)
    }).catch((error) => notify(String(error).replace(/^Error:\s*/, '')))
  }, [file, notify])

  useEffect(() => {
    if (!selectedHash) return
    window.api.commitFileDiff(selectedHash, file).then((lines) => {
      const text = lines.map((line) => (line.type === 'hunk' || line.type === 'meta' ? line.text : line.text)).join('\n')
      setDiff(text)
    }).catch(() => setDiff(''))
  }, [selectedHash, file])

  return (
    <div className="modal-overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="rebase-modal history-modal">
        <div className="rebase-modal-header">
          <GitCompare size={15} />
          <strong>History of</strong>
          <code className="rebase-base">{file}</code>
          <span className="spacer" />
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="history-body">
          <div className="history-list">
            {history.map((commit) => (
              <div
                key={commit.hash}
                className={`history-row${selectedHash === commit.hash ? ' selected' : ''}`}
                onClick={() => setSelectedHash(commit.hash)}
              >
                <code>{commit.shortHash}</code>
                <span className="subject-text">{commit.subject}</span>
                <span className="commit-author">{commit.author}</span>
              </div>
            ))}
            {history.length === 0 && <div className="sidebar-empty">No commits touch this file</div>}
          </div>
          <div className="history-diff">
            {diff.split('\n').map((text, index) => (
              <pre key={index} className={text.startsWith('+') ? 'hd-add' : text.startsWith('-') ? 'hd-del' : text.startsWith('@@') ? 'hd-hunk' : undefined}>
                {text.replace(/&/g, '&amp;').replace(/</g, '&lt;')}
              </pre>
            ))}
            {!diff && <div className="sidebar-empty">Select a commit</div>}
          </div>
        </div>
        <span hidden>{renderDiffContent.length}</span>
      </div>
    </div>
  )
}
