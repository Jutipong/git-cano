import { useCallback, useEffect, useRef, useState } from 'react'
import { GitCommitHorizontal, Minus, Plus, RotateCcw } from 'lucide-react'
import type { CommitNode, MenuItem } from '@shared/types'
import ContextMenu, { type MenuState } from './ContextMenu'

interface Props {
  commits: CommitNode[]
  query: string
  hasMore: boolean
  onLoadMore: () => void
  onSelectCommit: (commit: CommitNode) => void
  buildCommitMenu: (commit: CommitNode) => MenuItem[]
}

const BASE_LANE_W = 24
const BASE_ROW_H = 42
const COLORS = ['#35c6b0', '#5b9cf6', '#b78af7', '#f2a65a', '#ef6b73', '#4fc3d8', '#e3bd55', '#ef82b8']
const ZOOM_MIN = 0.65
const ZOOM_MAX = 1.6

export default function GraphView({ commits, query, hasMore, onLoadMore, onSelectCommit, buildCommitMenu }: Props) {
  const [selectedHash, setSelectedHash] = useState<string | null>(null)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [dropTargetHash, setDropTargetHash] = useState<string | null>(null)
  const [zoom, setZoom] = useState(() => Number(localStorage.getItem('gkx-graph-zoom')) || 1)
  const [visibleRange, setVisibleRange] = useState<[number, number]>([0, 60])
  const scrollRef = useRef<HTMLDivElement>(null)

  const laneW = Math.round(BASE_LANE_W * zoom)
  const rowH = Math.round(BASE_ROW_H * zoom)

  useEffect(() => {
    localStorage.setItem('gkx-graph-zoom', String(zoom))
  }, [zoom])

  const onScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const start = Math.max(0, Math.floor(el.scrollTop / rowH) - 15)
    const count = Math.ceil(el.clientHeight / rowH) + 30
    setVisibleRange([start, start + count])
    // infinite scroll trigger
    if (hasMore && el.scrollTop + el.clientHeight >= el.scrollHeight - rowH * 10) onLoadMore()
  }, [rowH, hasMore, onLoadMore])

  const onWheel = useCallback((event: React.WheelEvent) => {
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault()
      setZoom((current) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, current - event.deltaY * 0.002)))
    }
  }, [])

  const normalizedQuery = query.trim().toLowerCase()
  const visibleCommits = normalizedQuery
    ? commits.filter((commit) =>
        `${commit.subject} ${commit.author} ${commit.hash} ${commit.refs.join(' ')}`.toLowerCase().includes(normalizedQuery),
      )
    : commits
  const graphW = Math.max((visibleCommits.reduce((max, commit) => Math.max(max, commit.lane), 0) + 1) * laneW + 20, 64)
  const rowIndex = new Map(visibleCommits.map((commit, index) => [commit.hash, index]))
  const totalHeight = visibleCommits.length * rowH
  const [start, end] = visibleRange
  const renderedCommits = visibleCommits.slice(start, end)

  const select = (commit: CommitNode) => {
    setSelectedHash(commit.hash)
    onSelectCommit(commit)
  }

  return (
    <main className="graph-view">
      <div className="graph-toolbar">
        <div className="graph-title"><GitCommitHorizontal size={17} /><strong>Commit history</strong><span>{normalizedQuery ? `${visibleCommits.length} of ${commits.length}` : commits.length} commits</span></div>
        <div className="spacer" />
        <div className="zoom-controls">
          <button className="icon-btn" title="Zoom out" onClick={() => setZoom((value) => Math.max(ZOOM_MIN, value - 0.1))}><Minus size={14} /></button>
          <button className="icon-btn zoom-reset" title="Reset zoom" onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button>
          <button className="icon-btn" title="Zoom in" onClick={() => setZoom((value) => Math.min(ZOOM_MAX, value + 0.1))}><Plus size={14} /></button>
        </div>
        <div className="graph-toolbar-actions"><span className="graph-filter active">All branches</span><span className="graph-filter">Recent</span></div>
      </div>
      <div className="graph-header">
        <span style={{ width: graphW }}>GRAPH</span>
        <span className="graph-message-header">COMMIT MESSAGE</span>
        <span className="graph-author-header">AUTHOR</span>
        <span className="graph-date-header">DATE</span>
      </div>
      <div className="graph-scroll" ref={scrollRef} onScroll={onScroll} onWheel={onWheel}>
        {totalHeight > 0 && (
          <>
            <svg className="graph-canvas" width={graphW} height={totalHeight} aria-hidden="true">
              {visibleCommits.map((commit, index) => {
                if (index > end + 5) return null
                const x = commit.lane * laneW + laneW / 2
                const y = index * rowH + rowH / 2
                return commit.parents.map((parentHash) => {
                  const parentIndex = rowIndex.get(parentHash)
                  if (parentIndex === undefined || parentIndex <= index || parentIndex > end + 5) return null
                  const parent = visibleCommits[parentIndex]
                  const parentX = parent.lane * laneW + laneW / 2
                  const parentY = parentIndex * rowH + rowH / 2
                  const bend = y + rowH * 0.55
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
                if (index < start - 5 || index > end + 5) return null
                const x = commit.lane * laneW + laneW / 2
                const y = index * rowH + rowH / 2
                const selected = selectedHash === commit.hash
                return (
                  <g key={commit.hash}>
                    {(selected || dropTargetHash === commit.hash) && <circle cx={x} cy={y} r="10" fill="none" stroke={dropTargetHash === commit.hash ? 'var(--teal)' : 'var(--text)'} strokeWidth="1.5" opacity="0.9" />}
                    <circle cx={x} cy={y} r={selected ? Math.round(5.5 * zoom) : Math.round(4.5 * zoom)} fill={COLORS[commit.lane % COLORS.length]} stroke="var(--canvas)" strokeWidth="2" />
                  </g>
                )
              })}
            </svg>
            <div style={{ height: start * rowH }} aria-hidden="true" />
            {renderedCommits.map((commit) => (
              <div
                key={commit.hash}
                data-hash={commit.hash}
                className={`graph-row${selectedHash === commit.hash ? ' selected' : ''}${dropTargetHash === commit.hash ? ' drop-target' : ''}`}
                style={{ height: rowH }}
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
                <span className="commit-subject" style={{ fontSize: `${Math.round(13 * zoom)}px` }}>
                  <span className="subject-text">{commit.subject}</span>
                  {commit.refs.map((ref) => <span key={ref} className={`ref-chip${ref.startsWith('HEAD') ? ' head' : ref.startsWith('tag:') ? ' tag' : ''}`}>{ref.replace('HEAD -> ', '')}</span>)}
                </span>
                <span className="commit-author">{commit.author}</span>
                <span className="commit-date">{formatDate(commit.date)}</span>
              </div>
            ))}
            <div style={{ height: Math.max(0, (visibleCommits.length - end) * rowH) }} aria-hidden="true" />
          </>
        )}
        {visibleCommits.length === 0 && <div className="graph-empty">{normalizedQuery ? 'No matching commits' : 'No commits found in this repository'}</div>}
        {hasMore && !normalizedQuery && (
          <div className="graph-load-more">
            <button className="btn small" onClick={onLoadMore}>Load more commits</button>
          </div>
        )}
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
