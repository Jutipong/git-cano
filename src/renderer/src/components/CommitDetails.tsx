import { ChevronDown, ChevronRight, GitCommit, GitFork, Hash, RotateCcw, UserRound } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { CommitDetails as CommitDetailsData, CommitNode, DiffLine } from '@shared/types'

interface Props {
  commit: CommitNode
  refresh: () => Promise<unknown>
  notify: (message: string) => void
}

const STATUS_COLOR: Record<string, string> = { A: 'b-a', M: 'b-m', D: 'b-d', U: 'b-u' }

export default function CommitDetails({ commit, refresh, notify }: Props) {
  const [details, setDetails] = useState<CommitDetailsData | null>(null)
  const [openFile, setOpenFile] = useState<string | null>(null)
  const [fileDiff, setFileDiff] = useState<DiffLine[]>([])
  const [showFiles, setShowFiles] = useState(true)

  useEffect(() => {
    let cancelled = false
    setDetails(null)
    setOpenFile(null)
    window.api.commitDetails(commit.hash).then((value) => {
      if (!cancelled) setDetails(value)
    }).catch((error) => notify(String(error).replace(/^Error:\s*/, '')))
    return () => { cancelled = true }
  }, [commit.hash, notify])

  useEffect(() => {
    if (!openFile) return
    let cancelled = false
    window.api.commitFileDiff(commit.hash, openFile).then((diff) => {
      if (!cancelled) setFileDiff(diff)
    }).catch(() => setFileDiff([]))
    return () => { cancelled = true }
  }, [commit.hash, openFile])

  const action = async (label: string, fn: () => Promise<unknown>) => {
    try {
      await fn()
      await refresh()
      notify(label)
    } catch (error) {
      notify(String(error).replace(/^Error:\s*/, ''))
    }
  }

  const message = details?.message || commit.subject
  const summary = message.split('\n')[0]
  const body = message.split('\n').slice(2).join('\n').trim()

  return (
    <section className="commit-details">
      <div className="commit-details-heading">
        <div className="commit-details-title"><GitCommit size={16} /><strong>Commit details</strong></div>
        <span className="commit-details-hash"><Hash size={13} />{commit.shortHash}</span>
      </div>
      <div className="commit-details-content">
        <div className="commit-details-summary">{summary}</div>
        {body && <div className="commit-details-body">{body}</div>}
        <div className="commit-meta">
          <span><UserRound size={14} />{details?.author || commit.author}</span>
          <span>{formatDate(details?.date || commit.date)}</span>
          <button className="detail-action" onClick={() => setShowFiles((value) => !value)}>
            {showFiles ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            {details ? `${details.files.length} changed files` : 'Loading…'}
          </button>
          <span className="spacer" />
          <button className="detail-action" title="Checkout this commit" onClick={() => void action('Checked out commit (detached HEAD)', () => window.api.checkoutCommit(commit.hash))}>Checkout</button>
          <button className="detail-action" title="Cherry-pick onto current branch" onClick={() => void action('Cherry-picked', () => window.api.cherryPick(commit.hash))}>Cherry-pick</button>
          <button className="detail-action danger" title="Revert this commit" onClick={() => {
            if (window.confirm(`Revert commit ${commit.shortHash}?`)) void action('Commit reverted', () => window.api.revertCommit(commit.hash))
          }}><RotateCcw size={12} /> Revert</button>
        </div>
        <div className="commit-ref-list">
          {commit.refs.map((ref) => <span key={ref} className="ref-chip">{ref}</span>)}
          {commit.parents.length > 0 && <span className="parent-meta"><GitFork size={13} /> Parent {commit.parents[0].slice(0, 7)}</span>}
        </div>

        {showFiles && details && details.files.length > 0 && (
          <div className="commit-files">
            {details.files.map((file) => (
              <div key={file.path}>
                <div
                  className={`commit-file-row${openFile === file.path ? ' selected' : ''}`}
                  onClick={() => setOpenFile(openFile === file.path ? null : file.path)}
                >
                  <span className={`badge ${STATUS_COLOR[file.status.toUpperCase()] ?? 'b-m'}`}>{file.status}</span>
                  <span className="commit-file-path" title={file.path}>{file.path}</span>
                </div>
                {openFile === file.path && (
                  <div className="commit-file-diff">
                    {fileDiff.map((line, index) => (
                      <div key={index} className={`diff-line ${line.type}`}>
                        <span className="ln">{line.oldNo ?? ''}</span>
                        <span className="ln">{line.newNo ?? ''}</span>
                        <pre>{line.text}</pre>
                      </div>
                    ))}
                    {fileDiff.length === 0 && <div className="diff-empty">No textual diff available</div>}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}
