import { AlertTriangle, ArrowLeftRight, Check, X } from 'lucide-react'
import type { RepoState } from '@shared/types'

interface Props {
  conflicts: string[]
  state: RepoState
  refresh: () => Promise<unknown>
  notify: (m: string) => void
}

export default function ConflictBanner({ conflicts, state, refresh, notify }: Props) {
  if (!state.merging && !state.rebasing && conflicts.length === 0) return null

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn()
      await refresh()
      notify(ok)
    } catch (err) {
      notify(String(err).replace(/^Error:\s*/, ''))
    }
  }

  return (
    <div className="conflict-banner">
      <div className="conflict-banner-header">
        <AlertTriangle size={15} />
        {state.rebasing ? (
          <strong>Rebase in progress — resolve conflicts to continue</strong>
        ) : state.merging ? (
          <strong>Merge conflict — resolve all files then continue</strong>
        ) : null}
        <span className="spacer" />
        {state.merging && !state.rebasing && (
          <>
            <button className="btn small" onClick={() => void run(() => window.api.abortMerge(), 'Merge aborted')}>
              <X size={13} /> Abort merge
            </button>
            {conflicts.length === 0 && (
              <button className="btn primary small" onClick={() => void run(() => window.api.continueMerge(), 'Merge completed')}>
                <Check size={13} /> Continue merge
              </button>
            )}
          </>
        )}
        {state.rebasing && (
          <>
            <button className="btn small" onClick={() => void run(() => window.api.rebaseAbort(), 'Rebase aborted')}>
              <X size={13} /> Abort rebase
            </button>
            {conflicts.length === 0 && (
              <button className="btn primary small" onClick={() => void run(() => window.api.rebaseContinue(), 'Rebase continued')}>
                <Check size={13} /> Continue rebase
              </button>
            )}
          </>
        )}
      </div>

      {conflicts.map((file) => (
        <div className="conflict-row" key={file}>
          <span className="conflict-path" title={file}>{file}</span>
          <div className="conflict-actions">
            <button className="detail-action" title="Keep our version" onClick={() => void run(() => window.api.conflictTakeSide(file, 'ours'), `${file}: kept ours`)}>
              Ours
            </button>
            <button className="detail-action" title="Keep their version" onClick={() => void run(() => window.api.conflictTakeSide(file, 'theirs'), `${file}: kept theirs`)}>
              Theirs
            </button>
            <button className="detail-action accent" title="I edited the file manually — mark as resolved" onClick={() => void run(() => window.api.markResolved([file]), `${file}: resolved`)}>
              <ArrowLeftRight size={12} /> Mark resolved
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
