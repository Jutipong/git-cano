import { describe, expect, it } from 'vitest'

import { isOpenableTerminalLink, shouldActivateTerminalLink } from '../../src/renderer/src/utils/terminalLinks'

describe('isOpenableTerminalLink', () => {
    it('accepts http and https in any case', () => {
        expect(isOpenableTerminalLink('http://localhost:3000')).toBe(true)
        expect(isOpenableTerminalLink('https://example.com/a?b=1#c')).toBe(true)
        expect(isOpenableTerminalLink('HTTPS://EXAMPLE.COM')).toBe(true)
    })

    it('rejects everything that is not http(s)', () => {
        expect(isOpenableTerminalLink('javascript:alert(1)')).toBe(false)
        expect(isOpenableTerminalLink('file:///C:/secret.txt')).toBe(false)
        expect(isOpenableTerminalLink('ftp://example.com')).toBe(false)
        expect(isOpenableTerminalLink('localhost:3000')).toBe(false)
        expect(isOpenableTerminalLink('   ')).toBe(false)
    })
})

describe('shouldActivateTerminalLink', () => {
    const ctrl = { ctrlKey: true, metaKey: false }
    const meta = { ctrlKey: false, metaKey: true }
    const plain = { ctrlKey: false, metaKey: false }

    it('needs Ctrl/Cmd so a plain click stays a selection', () => {
        expect(shouldActivateTerminalLink(ctrl, 'https://example.com')).toBe(true)
        expect(shouldActivateTerminalLink(meta, 'https://example.com')).toBe(true)
        expect(shouldActivateTerminalLink(plain, 'https://example.com')).toBe(false)
    })

    it('still gates on the protocol', () => {
        expect(shouldActivateTerminalLink(ctrl, 'file:///C:/secret.txt')).toBe(false)
        expect(shouldActivateTerminalLink(ctrl, 'javascript:alert(1)')).toBe(false)
    })
})
