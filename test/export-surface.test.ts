import { describe, expect, it } from 'vitest'

// The barrel is a contract: what it names, consumers may hold. Porcelain that
// takes a cwd or returns an exit code is not part of that contract, and the
// way it leaks is a re-export added for one convenient call site. This pins
// both directions, so widening the surface has to be deliberate.
describe('package entry surface', () => {
  it('exports the interrogation engine', async () => {
    const barrel = await import('../src/index.js')
    for (const name of [
      'evaluateCatalogue',
      'loadQuestionCatalogue',
      'renderQuestion',
      'renderInterrogationReport',
    ]) {
      expect(typeof (barrel as Record<string, unknown>)[name]).toBe('function')
    }
  })

  it('does not export CLI porcelain', async () => {
    const barrel = await import('../src/index.js')
    const names = Object.keys(barrel)
    for (const forbidden of [
      'runAskCommand',
      'runInterrogateCommand',
      'runCli',
      'runDesignCommand',
      'runCheckCommand',
      'runApplyCommand',
      'runExportCommand',
      'versionResult',
    ]) {
      expect(names).not.toContain(forbidden)
    }
    // Nothing shaped like a command runner, so a newly added one is caught
    // even though this list cannot know its name.
    expect(names.filter((name) => /^run[A-Z]/.test(name))).toEqual([])
  })
})

describe('interrogation subpath entry', () => {
  it('re-exports the engine on its own entry point', async () => {
    // Dynamic import intentionally exercises the module-loading boundary for
    // the published subpath, as the visual-graph entry does.
    const entry = await import('../src/interrogation-entry.js')
    expect(typeof entry.evaluateCatalogue).toBe('function')
    expect(typeof entry.loadQuestionCatalogue).toBe('function')
    expect(typeof entry.renderQuestion).toBe('function')
    expect(typeof entry.renderInterrogationReport).toBe('function')
  })
})
