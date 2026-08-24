import { useState } from 'react'
import { GitCommitHorizontal } from 'lucide-react'
import type { CommitNode, MenuItem } from '@shared/types'
import ContextMenu, { type MenuState } from './ContextMenu'

interface Props {
  commits: CommitNode[]
  query: string
  onSelectCommit: (commit: CommitNode) => void
  buildCommitMenu: (commit: CommitNode) => MenuItem[]
}

const LANE_W = 24
const ROW_H = 42
const COLORS = ['#35c6b0', '#5b9cf6', '#b78af7', '#f2a65a', '#ef6b73', '#4fc3d8', '#e3bd55', '#ef82b8']

export default function GraphView({ commits, query, onSelectCommit, buildCommitMenu }: Props) {
  const [selectedHash, setSelectedHash] = useState<string | null>(null)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [dropTargetHash, setDropTargetHash] = useState<string | null>(null)

  const normalizedQuery = query.trim().toLowerCase()
  const visibleCommits = normalizedQuery
    ? commits.filter((commit) =>
        `${commit.subject} ${commit.author} ${commit.hash} ${commit.refs.join(' ')}`.toLowerCase().includes(normalizedQuery),
      )
    : commits
  const graphW = Math.max((visibleCommits.reduce((max, commit) => Math.max(max, commit.lane), 0) + 1) * LANE_W + 20, 64)
  const rowIndex = new Map(visibleCommits.map((commit, index) => [commit.hash, index]))
  const totalHeight = visibleCommits.length * ROW_H

  const select = (commit: CommitNode) => {
    setSelectedHash(commit.hash)
    onSelectCommit(commit)
  }

  return (
    <main className="graph-view">
      <div className="graph-toolbar">
        <div className="graph-title"><GitCommitHorizontal size={17} /><strong>Commit history</strong><span>{normalizedQuery ? `${visibleCommits.length} of ${commits.length}` : commits.length} commits</span></div>
        <div className="graph-toolbar-actions"><span className="graph-filter active">All branches</span><span className="graph-filter">Recent</span></div>
      </div>
      <div className="graph-header">
        <span style={{ width: graphW }}>GRAPH</span>
        <span className="graph-message-header">COMMIT MESSAGE</span>
        <span className="graph-author-header">AUTHOR</span>
        <span className="graph-date-header">DATE</span>
      </div>
      <div className="graph-scroll">
        {visibleCommits.length > 0 && (
          <svg className="graph-canvas" width={graphW} height={totalHeight} aria-hidden="true">
            {visibleCommits.map((commit, index) => {
              const x = commit.lane * LANE_W + LANE_W / 2
              const y = index * ROW_H + ROW_H / 2
              return commit.parents.map((parentHash) => {
                const parentIndex = rowIndex.get(parentHash)
                if (parentIndex === undefined || parentIndex <= index) return null
                const parent = visibleCommits[parentIndex]
                const parentX = parent.lane * LANE_W + LANE_W / 2
                const parentY = parentIndex * ROW_H + ROW_H / 2
                const bend = y + ROW_H * 0.55
                return (
                  <path
                    key={`${commit.hash}:${parentHash}`}
                    d={`M ${x} ${y} C ${x} ${bend}, ${parentX} ${bend}, ${parentX} ${parentY}`}
                    stroke={COLORS[commit.lane % COLORS.length]}
                    strokeWidth="2"
                    fill="none"
                  />
                )
              })
            })}
            {visibleCommits.map((commit, index) => {
              const x = commit.lane * LANE_W + LANE_W / 2
              const y = index * ROW_H + ROW_H / 2
              const selected = selectedHash === commit.hash
              return (
                <g key={commit.hash}>
                  {(selected || dropTargetHash === commit.hash) && <circle cx={x} cy={y} r="10" fill="none" stroke={dropTargetHash === commit.hash ? 'var(--teal)' : '#f4f7fb'} strokeWidth="1.5" opacity="0.9" />}
                  <circle cx={x} cy={y} r={selected ? 5.5 : 4.5} fill={COLORS[commit.lane % COLORS.length]} stroke="#20242d" strokeWidth="2" />
                </g>
              )
            })}
          </svg>
        )}
        {visibleCommits.map((commit) => (
          <div
            key={commit.hash}
            className={`graph-row${selectedHash === commit.hash ? ' selected' : ''}${dropTargetHash === commit.hash ? ' drop-target' : ''}`}
            onClick={() => select(commit)}
            onContextMenu={(event) => {
              event.preventDefault()
              select(commit)
              setMenu({ x: event.clientX, y: event.clientY, items: buildCommitMenu(commit) })
            }}
            draggable
            onDragStart={(event) => event.dataTransfer.setData('text/plain', `commit:${commit.hash}`)}
            onDragOver={(event) => {
              if (event.dataTransfer.types.includes('text/plain')) {
                event.preventDefault()
                setDropTargetHash(commit.hash)
              }
            }}
            onDragLeave={() => setDropTargetHash(null)}
            title={`${commit.shortHash} — ${commit.subject}`}
          >
            <div className="graph-cell" style={{ width: graphW }} />
            <span className="commit-subject">
              <span className="subject-text">{commit.subject}</span>
              {commit.refs.map((ref) => <span key={ref} className={`ref-chip${ref.startsWith('HEAD') ? ' head' : ref.startsWith('tag:') ? ' tag' : ''}`}>{ref.replace('HEAD -> ', '')}</span>)}
            </span>
            <span className="commit-author">{commit.author}</span>
            <span className="commit-date">{formatDate(commit.date)}</span>
          </div>
        ))}
        {visibleCommits.length === 0 && <div className="graph-empty">{normalizedQuery ? 'No matching commits' : 'No commits found in this repository'}</div>}
      </div>
      <ContextMenu menu={menu} onClose={() => setMenu(null)} />
    </main>
  )
}

function formatDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
