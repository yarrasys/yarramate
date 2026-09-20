import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { compileWorkspaceWithProfileContext } from '../src/compiler.js'
import { projectGraphForCanvas } from '../src/graph-projection.js'
import { resolveWorkspaceFrom } from '../src/tools-entry.js'
import {
  CONVENTION_RULES,
  conventionalRelationshipKind,
} from '../src/relationship-convention.js'
import {
  permittedRelationshipKinds,
  isCoreConceptKindId,
} from '../src/relationship-matrix.js'
import { conceptKinds } from '../src/profile.js'

const here = dirname(fileURLToPath(import.meta.url))

describe('the conventional relationship kind (#571, ADR 0162)', () => {
  it('answers the pairs ArchiMate is unambiguous about', () => {
    const cases: readonly [string, string, string, string][] = [
      // An active structure element is assigned to the internal behaviour it
      // performs. This is the pair that started the issue: the table permits
      // six kinds here and the two records write `assignment` 87 times in 88.
      ['applicationComponent', 'applicationFunction', 'assignment', 'active-structure-performs-behaviour'],
      ['businessActor', 'businessFunction', 'assignment', 'active-structure-performs-behaviour'],
      ['systemSoftware', 'technologyFunction', 'assignment', 'active-structure-performs-behaviour'],
      // An interface is assigned to the service it exposes, and serves whatever
      // uses it. Both are the same source kind, so the order of the rules is
      // what separates them.
      ['applicationInterface', 'applicationService', 'assignment', 'interface-exposes-service'],
      ['applicationInterface', 'applicationFunction', 'serving', 'service-is-offered-outward'],
      // The internal element realizes the service its layer offers.
      ['applicationComponent', 'applicationService', 'realization', 'internal-realizes-service'],
      ['applicationFunction', 'applicationService', 'realization', 'internal-realizes-service'],
      // Behaviour touching passive structure is access.
      ['applicationFunction', 'dataObject', 'access', 'behaviour-uses-data'],
      ['applicationService', 'dataObject', 'access', 'behaviour-uses-data'],
      // A service is offered outward.
      ['applicationService', 'businessActor', 'serving', 'service-is-offered-outward'],
      // Technology is not part of the application it runs.
      ['node', 'applicationComponent', 'serving', 'technology-serves-application'],
      ['systemSoftware', 'applicationComponent', 'serving', 'technology-serves-application'],
      // A grouping aggregates what it collects.
      ['grouping', 'dataObject', 'aggregation', 'grouping-collects-members'],
      // An artifact is the concrete thing that fulfils what it stands for.
      ['artifact', 'applicationComponent', 'realization', 'artifact-realizes-what-it-implements'],
      ['artifact', 'dataObject', 'realization', 'artifact-realizes-what-it-implements'],
    ]
    for (const [from, to, kind, rule] of cases) {
      const answer = conventionalRelationshipKind(from, to)
      expect(answer, `${from} > ${to}`).not.toBeNull()
      expect(answer?.kind, `${from} > ${to}`).toBe(kind)
      expect(answer?.rule, `${from} > ${to}`).toBe(rule)
    }
  })

  it('says nothing where the language genuinely permits several readings', () => {
    // Each of these is split in the records the check below reads: an artifact
    // pointing at a function is realization 41 times and association 16; two
    // application functions relate by composition, triggering, flow or serving
    // depending on what the author means; a capability pointing at a goal
    // splits evenly. Manufacturing a convention here would be manufacturing
    // confidence the language does not have.
    const contested: readonly (readonly [string, string])[] = [
      ['artifact', 'applicationFunction'],
      ['artifact', 'artifact'],
      ['applicationFunction', 'applicationFunction'],
      ['capability', 'goal'],
      ['dataObject', 'dataObject'],
      ['applicationFunction', 'artifact'],
    ]
    for (const [from, to] of contested) {
      expect(conventionalRelationshipKind(from, to), `${from} > ${to}`).toBeNull()
    }
  })

  it('never blesses one adopter’s house convention', () => {
    // Across both records a business actor points at a constraint with
    // `association` 87 times out of 87 - and that is ApertureX recording
    // sign-off their way, not a rule of the language. A convention derived
    // from usage would have shipped it and told every other adopter their own
    // style was wrong. These answers are read off ArchiMate, so it is silent.
    expect(conventionalRelationshipKind('businessActor', 'constraint')).toBeNull()
    expect(conventionalRelationshipKind('businessRole', 'constraint')).toBeNull()
  })

  it('never contradicts the table it sits beside', () => {
    const kinds = conceptKinds.map(({ id }) => id).filter(isCoreConceptKindId)
    let answered = 0
    for (const from of kinds) {
      for (const to of kinds) {
        const answer = conventionalRelationshipKind(from, to)
        if (answer === null) continue
        answered += 1
        expect(
          permittedRelationshipKinds(from, to).has(answer.kind),
          `${from} > ${to} said ${answer.kind}, which the table forbids`,
        ).toBe(true)
      }
    }
    // Guidance that covered everything would not be guidance. The point of the
    // module is that it is quiet: a couple of hundred pairs out of 62 x 62.
    expect(answered).toBeGreaterThan(50)
    expect(answered).toBeLessThan(kinds.length * kinds.length * 0.2)
  })

  it('keeps the one ordering that is load-bearing', () => {
    // An interface is the only source kind two rules both claim: it exposes
    // the service of its own layer (assignment) and serves everything else
    // (serving). If the general rule ran first, both would read `serving`.
    // Every other rule is disjoint by construction, so this is the whole of
    // the order's weight and it is asserted rather than assumed.
    expect(conventionalRelationshipKind('applicationInterface', 'applicationService')?.kind).toBe(
      'assignment',
    )
    expect(conventionalRelationshipKind('applicationInterface', 'applicationFunction')?.kind).toBe(
      'serving',
    )
    expect(conventionalRelationshipKind('businessInterface', 'businessService')?.kind).toBe(
      'assignment',
    )
  })

  it('refuses kinds the table has never heard of', () => {
    expect(conventionalRelationshipKind('inventedKind', 'dataObject')).toBeNull()
    expect(conventionalRelationshipKind('applicationFunction', 'inventedKind')).toBeNull()
  })

  it('gives every rule a name and a sentence a reviewer can argue with', () => {
    expect(CONVENTION_RULES.length).toBeGreaterThan(4)
    for (const rule of CONVENTION_RULES) {
      expect(rule.name).toMatch(/^[a-z][a-z-]+$/)
      expect(rule.because.length).toBeGreaterThan(30)
    }
  })

  // The conventions are read off ArchiMate, not fitted to these records. This
  // is the check that they describe real practice anyway: where a record has
  // enough of a pair to have a habit, the habit and the convention should
  // agree. A failure here is a conversation, not necessarily a bug - it may be
  // the record that is unusual - so the message prints what it saw.
  it('matches what authors actually write, on every pair with a habit', () => {
    const root = join(here, '..', '.yarramate')
    const canvas = compile(root)
    const kindOf = new Map(canvas.nodes.map((node) => [node.id, node.coreKindLabel]))
    const used = new Map<string, Record<string, number>>()
    for (const edge of canvas.edges) {
      const key = `${kindOf.get(edge.from)}>${kindOf.get(edge.to)}`
      const counts = used.get(key) ?? {}
      counts[edge.coreKindLabel] = (counts[edge.coreKindLabel] ?? 0) + 1
      used.set(key, counts)
    }
    const disagreements: string[] = []
    let checked = 0
    let edgesChecked = 0
    for (const [pair, counts] of used) {
      const total = Object.values(counts).reduce((a, b) => a + b, 0)
      // Fewer than five edges is not a habit, it is a handful of choices.
      if (total < 5) continue
      const [from = '', to = ''] = pair.split('>')
      const answer = conventionalRelationshipKind(from, to)
      if (answer === null) continue
      checked += 1
      edgesChecked += total
      const share = (counts[answer.kind] ?? 0) / total
      if (share < 0.9) {
        disagreements.push(
          `${pair}: convention says ${answer.kind} (${answer.rule}), the record writes ${Object.entries(counts)
            .map(([k, n]) => `${k}:${n}`)
            .join(' ')}`,
        )
      }
    }
    // The floors say the check did real work rather than passing vacuously:
    // on this record it reads 9 pairs carrying over 400 relationships. They
    // are deliberately below what it reads today, so adding a subject cannot
    // fail the build for arithmetic reasons.
    expect(checked).toBeGreaterThanOrEqual(8)
    expect(edgesChecked).toBeGreaterThanOrEqual(300)
    expect(disagreements, disagreements.join('\n')).toEqual([])
  })
})

const compile = (root: string) => {
  const list = (prefix = ''): string[] =>
    readdirSync(join(root, prefix)).flatMap((entry) => {
      const rel = prefix === '' ? entry : `${prefix}/${entry}`
      return statSync(join(root, rel)).isDirectory() ? list(rel) : [rel]
    })
  const manifest = join(root, 'workspace.yaml')
  if (!existsSync(manifest)) throw new Error(`no workspace at ${root}`)
  const resolved = resolveWorkspaceFrom(
    { path: 'workspace.yaml', source: readFileSync(manifest, 'utf8') },
    list(),
  )
  if (!resolved.ok) throw new Error(JSON.stringify(resolved.diagnostics))
  const workspace = resolved.workspace
  const compiled = compileWorkspaceWithProfileContext(
    [...workspace.profiles, ...workspace.documents, ...(workspace.patterns ?? [])].map(
      (path) => ({ path, source: readFileSync(join(root, path), 'utf8') }),
    ),
  )
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics.slice(0, 2)))
  return projectGraphForCanvas(compiled.graph, compiled.profileContext)
}
