import { describe, expect, it } from 'vitest'

import { errorMessage } from '../../src/shared/errors'

describe('errorMessage', () => {
    it('drops the leading "Error: " prefix of an Error', () => {
        expect(errorMessage(new Error('Cherry-pick failed'))).toBe('Cherry-pick failed')
    })

    it('drops the prefix from a string', () => {
        expect(errorMessage('Error: boom')).toBe('boom')
    })

    it('keeps other error names as they are', () => {
        expect(errorMessage(new TypeError('bad input'))).toBe('TypeError: bad input')
    })

    it('stringifies values that are not errors', () => {
        expect(errorMessage(undefined)).toBe('undefined')
        expect(errorMessage({ message: 'x' })).toBe('[object Object]')
    })
})
