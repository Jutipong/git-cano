import { createFixtures, saveFixtures } from './fixtures'

export default function globalSetup(): void {
    const fixtures = createFixtures()
    saveFixtures(fixtures)
}
