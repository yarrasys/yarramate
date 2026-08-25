import { describe, expect, it } from 'vitest'
import { scanSubjectReferences } from '../src/subject-references.js'
import {
  compileWorkspace,
  compileWorkspaceWithProfileContext,
  evaluateCatalogue,
  loadQuestionCatalogue,
} from '../src/index.js'

// A succession that replaced its predecessor outright says so by the
// predecessor being gone. One where both are still current is usually partial,
// and the respect is the part a reader needs: a model claimed Zoekt superseded
// the Elasticsearch indexer while the source it was built from says Zoekt
// "does not replace" it for any scope but code search (ADR 0109).

const model = (supersedes: string, predecessorStatus: string) =>
  [
    'format: yarramate/v1',
    'id: main',
    'profile: yarramate/core@0.1',
    'concepts:',
    '  - id: zoekt',
    '    kind: applicationComponent',
    '    name: Zoekt',
    '    status: current',
    supersedes,
    '  - id: es-indexer',
    '    kind: applicationComponent',
    '    name: Elasticsearch indexer',
    `    status: ${predecessorStatus}`,
    'relationships: []',
    '',
  ].join('\n')

const bare = ['    supersedes:', '      - es-indexer'].join('\n')
const scoped = [
  '    supersedes:',
  '      - subject: es-indexer',
  '        inRespectOf: code search',
].join('\n')

const compile = (source: string) =>
  compileWorkspace([{ path: 'architecture/main.yaml', source }])

const diagnosticsOf = (result: ReturnType<typeof compile>) =>
  JSON.stringify('diagnostics' in result ? result.diagnostics : [])

describe('a succession can say in what respect it supersedes', () => {
  it('accepts the bare form, which is unchanged', () => {
    const result = compile(model(bare, 'retired'))
    expect(result.ok, diagnosticsOf(result)).toBe(true)
  })

  it('accepts the scoped form', () => {
    const result = compile(model(scoped, 'current'))
    expect(result.ok, diagnosticsOf(result)).toBe(true)
  })

  it('records the respect as its own claim, correlated by id', () => {
    const result = compile(model(scoped, 'current'))
    if (!result.ok) throw new Error('expected the fixture to compile')
    const succession = result.graph.claims.find(
      ({ predicate }) => predicate === 'yarramate/lineage/supersedes',
    )
    const respect = result.graph.claims.find(
      ({ predicate }) => predicate === 'yarramate/lineage/supersedes-respect',
    )
    expect(succession).toBeDefined()
    expect(respect?.id).toBe(`${succession?.id}~respect`)
    expect(respect?.object).toEqual({ value: 'code search' })
  })

  it('still resolves the predecessor reference through the scoped form', () => {
    const dangling = [
      '    supersedes:',
      '      - subject: no-such-subject',
      '        inRespectOf: code search',
    ].join('\n')
    const result = compile(model(dangling, 'current'))
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.diagnostics.some(({ code }) => code === 'YM312')).toBe(true)
    expect(
      result.diagnostics.some(({ message }) =>
        message.includes('no-such-subject'),
      ),
    ).toBe(true)
  })
})

describe('the interview asks for a respect the model did not record', () => {
  const catalogue = [
    'format: yarramate/question-catalogue/v1',
    'id: probe',
    'version: "1.0"',
    'profile: yarramate/core@0.1',
    'waves:',
    '  - id: hygiene',
    '    name: Hygiene',
    'questions:',
    '  - id: succession-unscoped',
    '    wave: hygiene',
    '    scope: subject',
    '    subjects: {}',
    '    trigger:',
    '      - condition: unscoped-succession',
    '    question: In what respect does {subject.name} supersede it?',
    '    materiality: A partial succession reads as a total one.',
    '    authority: either',
    '    resolution: Record inRespectOf, or retire the predecessor.',
    '',
  ].join('\n')

  const askedOf = (source: string) => {
    const compilation = compileWorkspaceWithProfileContext([
      { path: 'architecture/main.yaml', source },
    ])
    if (!compilation.ok) throw new Error('fixture did not compile')
    const loaded = loadQuestionCatalogue({ path: 'c.yaml', source: catalogue })
    if (!loaded.ok) throw new Error('fixture catalogue did not load')
    const question = evaluateCatalogue(
      loaded.catalogue,
      compilation.graph,
      compilation.profileContext,
    ).waves
      .flatMap(({ questions }) => questions)
      .find(({ id }) => id === 'succession-unscoped')
    return {
      open: question?.open ?? false,
      subjects: (question?.subjects ?? []).map(({ id }) => id),
    }
  }

  it('opens when the predecessor is still current and no respect is given', () => {
    const asked = askedOf(model(bare, 'current'))
    expect(asked.open).toBe(true)
    expect(asked.subjects).toEqual(['zoekt'])
  })

  it('closes once the respect is recorded', () => {
    expect(askedOf(model(scoped, 'current')).open).toBe(false)
  })

  it('stays closed for a completed succession, where the predecessor is retired', () => {
    // A total replacement says so by the predecessor being gone. Asking for a
    // qualifier there would be a hum, which is the failure ADR 0083 warned of.
    expect(askedOf(model(bare, 'retired')).open).toBe(false)
  })
})

describe('a rename can find a scoped succession', () => {
  it('scans the subject inside the object form as an address', () => {
    // Registering the position is what makes a rename move it. Without this,
    // a scoped succession would keep pointing at the old address while the
    // bare form beside it moved, which is the worst kind of half-rename.
    const hits = scanSubjectReferences(model(scoped, 'current'), 'document')
    const found = hits.hits.filter(({ pointer }) =>
      pointer.includes('supersedes'),
    )
    expect(found.map(({ address }) => address)).toContain('es-indexer')
    expect(found.map(({ pointer }) => pointer)).toContain(
      '/concepts/0/supersedes/0/subject',
    )
  })

  it('scans the bare form too, so both spellings move together', () => {
    const hits = scanSubjectReferences(model(bare, 'current'), 'document')
    const bareHits = hits.hits.filter(({ pointer }) =>
      pointer.includes('supersedes'),
    )
    expect(bareHits.map(({ address }) => address)).toContain('es-indexer')
    expect(bareHits.map(({ pointer }) => pointer)).toContain(
      '/concepts/0/supersedes/0',
    )
  })
})
