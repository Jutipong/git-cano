export interface PaletteFilterItem {
    label: string
    search?: string
}

/** Case-insensitive substring match on the label plus any extra `search` text. */
export function matchesPaletteQuery(item: PaletteFilterItem, query: string): boolean {
    const q = query.trim().toLowerCase()
    if (!q) return true
    return item.label.toLowerCase().includes(q) || (item.search ?? '').toLowerCase().includes(q)
}

/** Filters palette items by query, preserving order. Empty query returns every item. */
export function filterPaletteItems<T extends PaletteFilterItem>(items: T[], query: string): T[] {
    const q = query.trim().toLowerCase()
    if (!q) return items
    return items.filter(item => matchesPaletteQuery(item, q))
}

export interface PaletteSectionInput<T> {
    title?: string
    items: T[]
}

export interface PaletteSection<T> extends PaletteSectionInput<T> {
    /** Flat-list offset of this section's first row (for keyboard/mouse active tracking). */
    offset: number
}

/** Assigns flat-list offsets to sections in order, so a sectioned view maps back onto one list. */
export function withOffsets<T>(groups: PaletteSectionInput<T>[]): PaletteSection<T>[] {
    let offset = 0
    return groups.map(group => {
        const section = { ...group, offset }
        offset += group.items.length
        return section
    })
}
