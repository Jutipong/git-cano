import { describe, expect, it } from 'vitest'

import { formatDatePattern, formatDateTime, formatShortDate } from '../../src/renderer/src/utils/format'

describe('formatShortDate', () => {
    it('formats valid ISO dates as dd/mm/yyyy', () => {
        expect(formatShortDate('2026-01-15T12:30:00')).toBe('15/01/2026')
    })

    it('returns the raw value for invalid input', () => {
        expect(formatShortDate('not-a-date')).toBe('not-a-date')
    })
})

describe('formatDateTime', () => {
    it('formats date and time', () => {
        expect(formatDateTime('2026-01-15T09:05:00')).toBe('15/01/2026 09:05')
    })
})

describe('formatDatePattern', () => {
    it('replaces every supported token', () => {
        expect(formatDatePattern('2026-01-15T15:05:07', 'yyyy-MM-dd HH:mm:ss')).toBe('2026-01-15 15:05:07')
        expect(formatDatePattern('2026-01-15T15:05:07', 'yy/MM/dd hh:mm a')).toBe('26/01/15 03:05 PM')
        expect(formatDatePattern('2026-01-15T09:05:07', 'hh:mm a')).toBe('09:05 AM')
    })

    it('returns the raw value for invalid input', () => {
        expect(formatDatePattern('nope', 'yyyy')).toBe('nope')
    })
})
