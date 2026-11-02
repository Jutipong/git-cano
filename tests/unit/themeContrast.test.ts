import { describe, expect, it } from 'vitest'
import { contrast, mix, oklch, themeTokens } from './helpers/color'

const dark = themeTokens(":root[data-theme='dark']")
const AA = 4.5

describe('dark theme palette', () => {
    it('climbs surface-0 → 3 in even lightness steps', () => {
        const steps = ['--surface-0', '--surface-1', '--surface-2', '--surface-3']
            .map(name => oklch(dark[name])[0])
            .map((lightness, i, all) => (i ? lightness - all[i - 1] : 0))
            .slice(1)
        for (const step of steps) expect(step).toBeGreaterThan(0)
        expect(Math.max(...steps) - Math.min(...steps)).toBeLessThanOrEqual(0.01)
    })

    it('keeps hover and selected above surface-3', () => {
        const surface3 = oklch(dark['--surface-3'])[0]
        expect(oklch(dark['--surface-hover'])[0]).toBeGreaterThan(surface3)
        expect(oklch(dark['--surface-selected'])[0]).toBeGreaterThan(oklch(dark['--surface-hover'])[0])
    })

    it.each(['--text', '--text-secondary'])('%s stays AA on every surface', text => {
        for (const surface of ['--surface-0', '--surface-1', '--surface-2', '--surface-3', '--surface-hover', '--surface-selected'])
            expect(contrast(dark[text], dark[surface]), `${text} on ${surface}`).toBeGreaterThanOrEqual(AA)
    })

    it('--text-muted stays AA on the panel surfaces', () => {
        for (const surface of ['--surface-0', '--surface-1', '--surface-2'])
            expect(contrast(dark['--text-muted'], dark[surface]), `on ${surface}`).toBeGreaterThanOrEqual(AA)
    })

    it.each(['--teal', '--blue', '--green', '--orange', '--red', '--purple', '--yellow', '--pink'])('%s stays AA on surface-1', accent => {
        expect(contrast(dark[accent], dark['--surface-1'])).toBeGreaterThanOrEqual(AA)
    })

    it('white primary-button text stays AA on --teal-dark', () => {
        expect(contrast('#ffffff', dark['--teal-dark'])).toBeGreaterThanOrEqual(AA)
    })

    it('commit-mode green title stays AA on its 26% green header tint', () => {
        const header = mix(dark['--green'], dark['--surface-0'], 0.26)
        expect(contrast(dark['--green'], header)).toBeGreaterThanOrEqual(AA)
    })
})
