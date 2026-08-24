import { useEffect, useMemo, useState } from 'react'
import { Columns2, Rows3 } from 'lucide-react'
import type { DiffLine } from '@shared/types'
import { intraLineRange, renderDiffContent } from '../lib/highlight'

interface Props {
  file: { path: string; staged: boolean } | null
  refresh?: () => Promise<unknown>
  notify?: (message: string) => void
}

type SideBySideRow = { left?: DiffLine; right?: DiffLine }

function buildSideBySide(lines: DiffLine[]): SideBySideRow[] {
  const rows: SideBySideRow[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line.type !== 'del') {
      rows.push(line.type === 'add' ? { right: line } : { left: line.type === 'ctx' ? line : undefined, right: line.type === 'ctx' ? line : undefined })
      i++
      continue
    }
    // collect del run
    const dels: DiffLine[] = []
    while (i < lines.length && lines[i].type === 'del') dels.push(lines[i++])
    const adds: DiffLine[] = []
    while (i < lines.length && lines[i].type === 'add') adds.push(lines[i++])
    const pairs = Math.max(dels.length, adds.length)
    for (let p = 0; p < pairs; p++) rows.push({ left: dels[p], right: adds[p] })
  }
  return rows
}

export default function DiffView({ file, refresh, notify }: Props) {
  const [lines, setLines] = useState<DiffLine[]>([])
  const [loading, setLoading] = useState(false)
  const [splitMode, setSplitMode] = useState(() => localStorage.getItem('ogit-diff-mode') === 'split')
  const [meta, setMeta] = useState<{ binary: boolean; image: boolean } | null>(null)
  const [images, setImages] = useState<{ oldUrl: string | null; newUrl: string | null } | null>(null)
  const [rawPatch, setRawPatch] = useState('')

  useEffect(() => {
    localStorage.setItem('ogit-diff-mode', splitMode ? 'split' : 'unified')
  }, [splitMode])

  useEffect(() => {
    if (!file) {
      setLines([])
      setMeta(null)
      setImages(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setRawPatch('')
    Promise.all([
      window.api.diff(file.path, file.staged),
      window.api.diffMeta(file.path, file.staged),
      window.api.rawPatch(file.path, file.staged),
    ])
      .then(([diff, diffMeta, patch]) => {
        if (cancelled) return
        setLines(diff)
        setMeta(diffMeta)
        setRawPatch(patch)
        if (diffMeta.image) {
          void Promise.all([
            window.api.imageVersion(file.path, 'head'),
            file.staged ? window.api.imageVersion(file.path, 'index') : window.api.imageVersion(file.path, 'workdir'),
          ]).then(([oldUrl, newUrl]) => {
            if (!cancelled) setImages({ oldUrl, newUrl })
          })
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLines([])
          setMeta(null)
        }
      })
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [file])

  const sideBySide = useMemo(() => (splitMode ? buildSideBySide(lines) : []), [splitMode, lines])

  /** hunk header line indexes within `lines`, for per-hunk actions */
  const hunkHeaderIndexes = useMemo(
    () => lines.map((line, index) => (line.type === 'hunk' ? index : -1)).filter((index) => index >= 0),
    [lines],
  )

  const actOnHunk = async (hunkOrdinal: number) => {
    if (!file || !refresh || !notify || rawPatch.trim() === '') return
    try {
      // viewing unstaged diff -> stage the hunk (forward); viewing staged diff -> unstage it (reverse)
      await window.api.stageHunks(file.path, file.staged, [hunkOrdinal], file.staged)
      await refresh()
      notify(file.staged ? 'Hunk unstaged' : 'Hunk staged')
    } catch (error) {
      notify(String(error).replace(/^Error:\s*/, ''))
    }
  }

  /** word-level mark ranges for a paired del/add couple */
  const marks = useMemo(() => {
    const map = new Map<number, [number, number] | null>()
    for (let i = 0; i < lines.length - 1; i++) {
      if (lines[i].type === 'del' && lines[i + 1].type === 'add') {
        const range = intraLineRange(lines[i].text.slice(1), lines[i + 1].text.slice(1))
        if (range) {
          map.set(i, range.old)
          map.set(i + 1, range.new)
        }
        i++
      }
    }
    return map
  }, [lines])

  if (!file)
    return (
      <div className="diff-view empty">
        <p>Select a file to view its diff</p>
      </div>
    )

  const renderLineHtml = (line: DiffLine, index?: number): string => {
    if (line.type === 'add' || line.type === 'del') {
      const mark = index !== undefined ? marks.get(index) ?? null : null
      return renderDiffContent(line.text, file.path, mark)
    }
    return line.text.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  }

  return (
    <div className="diff-view">
      <div className="diff-header">
        <strong>{file.path}</strong>
        <span className="chip">{file.staged ? 'staged' : 'working directory'}</span>
        {loading && <span className="muted">loading…</span>}
        <span className="spacer" />
        <button className="icon-btn" title={splitMode ? 'Unified view' : 'Side-by-side view'} onClick={() => setSplitMode((value) => !value)}>
          {splitMode ? <Rows3 size={15} /> : <Columns2 size={15} />}
        </button>
      </div>

      <div className={`diff-body${splitMode ? ' split' : ''}`}>
        {meta?.image ? (
          <div className="image-diff">
            <figure>
              <figcaption>Previous</figcaption>
              {images?.oldUrl ? <img src={images.oldUrl} alt="previous version" /> : <div className="image-empty">No image</div>}
            </figure>
            <figure>
              <figcaption>Current</figcaption>
              {images?.newUrl ? <img src={images.newUrl} alt="current version" /> : <div className="image-empty">No image</div>}
            </figure>
          </div>
        ) : meta?.binary ? (
          <div className="diff-empty">Binary file differs — content not shown</div>
        ) : splitMode ? (
          sideBySide.map((row, index) => (
            <div key={index} className="split-row">
              <div className={`diff-line half ${row.left?.type ?? 'blank'}`}>
                <span className="ln">{row.left?.oldNo ?? ''}</span>
                {row.left ? <pre dangerouslySetInnerHTML={{ __html: renderLineHtml(row.left) }} /> : <pre> </pre>}
              </div>
              <div className={`diff-line half ${row.right?.type ?? 'blank'}`}>
                <span className="ln">{row.right?.newNo ?? ''}</span>
                {row.right ? <pre dangerouslySetInnerHTML={{ __html: renderLineHtml(row.right) }} /> : <pre> </pre>}
              </div>
            </div>
          ))
        ) : (
          lines.map((line, index) => {
            const hunkOrdinal = hunkHeaderIndexes.indexOf(index)
            return (
              <div key={index} className={`diff-line ${line.type}`}>
                <span className="ln">{line.oldNo ?? ''}</span>
                <span className="ln">{line.newNo ?? ''}</span>
                <pre dangerouslySetInnerHTML={{ __html: renderLineHtml(line, index) }} />
                {hunkOrdinal >= 0 && refresh && notify && !meta?.binary && (
                  <button
                    className="detail-action hunk-action"
                    title={file.staged ? 'Unstage this hunk' : 'Stage just this hunk'}
                    onClick={() => void actOnHunk(hunkOrdinal)}
                  >
                    {file.staged ? '− Unstage hunk' : '+ Stage hunk'}
                  </button>
                )}
              </div>
            )
          })
        )}
        {!loading && !meta?.binary && !meta?.image && lines.length === 0 && (
          <div className="diff-empty">No textual changes</div>
        )}
      </div>
    </div>
  )
}
