import { switchDialog } from './switch'

import type { LocalChangesMode } from '@shared/types'

/**
 * Returns the local-changes mode for checking out `branch`, or null if cancelled. A clean working tree switches without asking —
 * 'stash'/'discard' would be no-ops anyway.
 */
export async function resolveCheckoutMode(branch: string): Promise<LocalChangesMode | null> {
    const status = await window.api.status().catch(() => null)
    if (!status || status.files.length === 0) return 'keep'
    return switchDialog(branch)
}
