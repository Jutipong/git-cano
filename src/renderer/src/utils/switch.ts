import { useSwitchStore } from '../stores/switch'

import type { LocalChangesMode } from '@shared/types'

export function switchDialog(branch: string): Promise<LocalChangesMode | null> {
    return useSwitchStore().request(branch)
}
