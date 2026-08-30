import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runCli } from '../src/cli.js'

// #430, from an adopter who DECLINED to use `missing-claim` because of this.
//
// Their answer-shape mapping (the consumer half of ADR 0110) turns a trigger
// into a one-click affordance and covered five conditions. `missing-claim`
// mapped to nothing, so a question using it rendered as prose, and their pack
// asserts no card degrades to prose across 42 questions. Rather than break
// that guarantee they left ownership unelicited.
//
// The shipped catalogue had the same gap from the other side: four of its
// questions use `missing-claim` and `design` printed no skeleton for any.

let workspace: string

const catalogueFor = (predicate: string) => `format: yarramate/question-catalogue/v1
id: probe
version: "1.0"
profile: yarramate/core@0.1
waves:
  - id: only
    name: Only
questions:
  - id: field-missing
    wave: only
    since: "1.0"
    scope: subject
    subjects:
      kinds: [yarramate/core@0.1#applicationComponent]
    trigger:
      - condition: missing-claim
        predicate: ${predicate}
    question: What is missing on {subject.name}?
    materiality: Probe.
    authority: human
    resolution: Fill it in.
`

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'yarramate-missing-claim-'))
  mkdirSync(join(workspace, 'architecture'))
  writeFileSync(
    join(workspace, 'architecture/main.yaml'),
    `format: yarramate/v1
id: main
profile: yarramate/core@0.1
concepts:
  - id: ordering
    kind: applicationComponent
    name: Ordering
relationships: []
`,
    'utf8',
  )
  writeFileSync(
    join(workspace, 'workspace.yaml'),
    `format: yarramate/workspace/v1
id: fixture
documents:
  - architecture/main.yaml
profiles: []
adapterMappings: []
projections: []
`,
    'utf8',
  )
})

afterEach(() => rmSync(workspace, { recursive: true, force: true }))

const designWith = (predicate: string) => {
  writeFileSync(
    join(workspace, 'cat.yaml'),
    catalogueFor(predicate),
    'utf8',
  )
  const result = runCli(
    ['design', 'workspace.yaml', '--catalogue', 'cat.yaml'],
    workspace,
  )
  expect(result.exitCode).toBe(0)
  return result.stdout
}

describe('a missing-claim question offers the field it is missing', () => {
  it('writes the owner through update-concept, naming the subject', () => {
    const out = designWith('yarramate/ownership/owner')
    expect(out).toContain('- op: update-concept')
    expect(out).toContain('id: ordering')
    expect(out).toContain('owner: <owning-subject-id>')
  })

  it('writes a description', () => {
    expect(designWith('yarramate/concept/description')).toContain(
      'description: <one line>',
    )
  })

  it('offers the status vocabulary rather than a bare placeholder', () => {
    // The three values are the whole answer, so printing `<one line>` here
    // would send the reader to the schema for something the skeleton knows.
    expect(designWith('yarramate/lifecycle/status')).toContain(
      'status: <planned|current|retired>',
    )
  })

  it('offers nothing for a predicate that is not a concept field', () => {
    // ADR 0110's rule, and the reason this mapping is a table rather than a
    // guess: an attestation predicate is written by adding an attestation,
    // not by setting a field, so a skeleton here would be wrong. Silence is
    // the correct output.
    const out = designWith('yarramate/attestation/adequacy')
    expect(out).not.toContain('Prefilled skeleton')
  })

  it('offers nothing for a predicate the engine has never heard of', () => {
    const out = designWith('acme/delivery/sprint')
    expect(out).not.toContain('Prefilled skeleton')
  })
})

describe('the mapping keeps up with the catalogue', () => {
  it('covers every missing-claim predicate the shipped catalogue uses', () => {
    // The catalogue is the thing that changes. A question arriving on a
    // predicate the mapping does not know should fail here, so the author
    // extends the mapping or accepts prose deliberately, rather than an
    // adopter discovering it from a shapeless card as in #430.
    const used = [
      ...readFileSync('catalogues/core-enrichment.yaml', 'utf8').matchAll(
        /condition: missing-claim\s*\n\s*predicate: (\S+)/g,
      ),
    ].map((match) => match[1]!)
    expect(used.length).toBeGreaterThan(0)
    for (const predicate of [...new Set(used)]) {
      expect(designWith(predicate), predicate).toContain('Prefilled skeleton')
    }
  })
})
