import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  EXCLUDED_REFERENCE_POSITIONS,
  SUBJECT_REFERENCE_POSITIONS,
  declaredStateIds,
  rewriteSubjectReferences,
  scanSubjectReferences,
} from '../src/subject-references.js'

const repositoryRoot = resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '..',
)

// The enumeration is what makes a rename total: a reference position it omits is
// a reference the rewrite silently leaves pointing at an id that stopped
// existing. So the completeness test derives the positions from the schemas
// rather than restating them - a new reference field fails here until it is
// either enumerated or argued into the exclusion list.

const SCHEMA_OF = {
  document: 'schema/yarramate-document.schema.json',
  projection: 'schema/yarramate-projection.schema.json',
  evidence: 'schema/yarramate-evidence.schema.json',
  'adapter-mapping': 'schema/yarramate-adapter-mapping.schema.json',
} as const

/**
 * `$defs` whose values are subject addresses. `observationKey` carries the same
 * dotted syntax without being an address, so it is derived and then excluded by
 * name rather than skipped here - the exclusion is the argument.
 */
const ADDRESS_DEFS = new Set([
  'reference',
  'subjectIdentity',
  'qualifiedIdentity',
  'qualifiedSubject',
  'observationKey',
])

interface JsonSchemaNode {
  readonly $ref?: string
  readonly properties?: Readonly<Record<string, JsonSchemaNode>>
  readonly items?: JsonSchemaNode
  readonly additionalProperties?: JsonSchemaNode | boolean
  readonly allOf?: readonly JsonSchemaNode[]
  readonly oneOf?: readonly JsonSchemaNode[]
  readonly anyOf?: readonly JsonSchemaNode[]
  readonly $defs?: Readonly<Record<string, JsonSchemaNode>>
}

/** Every path in one schema that lands on an address-typed `$defs` entry. */
const addressPositions = (schema: JsonSchemaNode): string[] => {
  const defs = schema.$defs ?? {}
  const found: string[] = []
  const walk = (
    node: JsonSchemaNode | boolean | undefined,
    path: readonly string[],
    seen: ReadonlySet<string>,
  ): void => {
    if (node === undefined || typeof node === 'boolean') return
    if (node.$ref !== undefined) {
      const name = node.$ref.replace('#/$defs/', '')
      if (ADDRESS_DEFS.has(name)) {
        found.push(path.join('/'))
        return
      }
      // A cycle would spin here; a def visited on this path adds no new
      // position, so stopping loses nothing.
      if (seen.has(name)) return
      walk(defs[name], path, new Set([...seen, name]))
      return
    }
    for (const branch of [
      ...(node.allOf ?? []),
      ...(node.oneOf ?? []),
      ...(node.anyOf ?? []),
    ]) {
      walk(branch, path, seen)
    }
    for (const [key, child] of Object.entries(node.properties ?? {})) {
      walk(child, [...path, key], seen)
    }
    walk(node.items, [...path, '*'], seen)
    if (typeof node.additionalProperties === 'object') {
      walk(node.additionalProperties, [...path, '*'], seen)
    }
  }
  walk(schema, [], new Set())
  return found
}

describe('SUBJECT_REFERENCE_POSITIONS', () => {
  it('accounts for every address-typed position in all four schemas', () => {
    const derived = Object.entries(SCHEMA_OF)
      .flatMap(([group, path]) =>
        addressPositions(
          JSON.parse(
            readFileSync(join(repositoryRoot, path), 'utf8'),
          ) as JsonSchemaNode,
        ).map((position) => `${group} ${position}`),
      )
      .sort()
    const accounted = [
      ...SUBJECT_REFERENCE_POSITIONS.filter(
        (position) => position.form !== 'declaration',
      ),
      ...EXCLUDED_REFERENCE_POSITIONS,
    ]
      .map((position) => `${position.group} ${position.path.join('/')}`)
      .sort()
    expect(derived).toEqual(accounted)
  })

  it('names exactly the two declarations a rename can move', () => {
    expect(
      SUBJECT_REFERENCE_POSITIONS.filter(
        (position) => position.form === 'declaration',
      ),
    ).toEqual([
      { group: 'document', path: ['concepts', '*', 'id'], form: 'declaration' },
      {
        group: 'document',
        path: ['relationships', '*', 'id'],
        form: 'declaration',
      },
    ])
  })

  it('gives every exclusion a reason', () => {
    for (const excluded of EXCLUDED_REFERENCE_POSITIONS) {
      expect(excluded.reason).not.toBe('')
    }
  })
})

const document = `format: yarramate/v1
id: main
profile: yarramate/core@0.1
concepts:
  - id: platform
    kind: businessActor
    name: Platform
  - id: checkout
    kind: applicationService
    name: Checkout
    owner: platform
    references:
      - id: r1
        ref: "platform"
relationships:
  - id: platform-serves-checkout
    kind: serving
    from: platform
    to: checkout
states:
  - id: current
    kind: baseline
    name: Current
`

describe('scanSubjectReferences', () => {
  it('qualifies bare references against the document that holds them', () => {
    const scan = scanSubjectReferences(document, 'document')
    expect(scan.documentId).toBe('main')
    expect(
      scan.hits
        .filter((hit) => hit.address === 'platform')
        .map((hit) => hit.pointer)
        .sort(),
    ).toEqual([
      '/concepts/0/id',
      '/concepts/1/owner',
      '/concepts/1/references/0/ref',
      '/relationships/0/from',
    ])
  })

  it('strips an aspect suffix from the address but keeps the raw bytes', () => {
    const evidence = `format: yarramate/evidence/v1
id: checked
provider: ci
observations:
  - subject: "checkout~name"
    key: build.status
    value: green
`
    const [hit] = scanSubjectReferences(evidence, 'evidence').hits
    expect(hit?.address).toBe('checkout')
    expect(hit?.raw).toBe('"checkout~name"')
  })

  it('reports an alias at a reference position rather than walking it', () => {
    const aliased = `format: yarramate/v1
id: main
profile: yarramate/core@0.1
concepts:
  - id: &owner platform
    kind: businessActor
    name: Platform
  - id: checkout
    kind: applicationService
    name: Checkout
    owner: *owner
relationships: []
`
    expect(scanSubjectReferences(aliased, 'document').aliases).toEqual([
      '/concepts/1/owner',
    ])
  })
})

describe('rewriteSubjectReferences', () => {
  const rename = { from: 'platform', to: 'platform-team' }

  it('moves the declaration and every reference, leaving all other bytes', () => {
    const result = rewriteSubjectReferences(document, 'document', rename)
    if (!result.ok) throw new Error(result.aliases.join(', '))
    expect(result.moved).toEqual([
      '/concepts/0/id',
      '/concepts/1/owner',
      '/concepts/1/references/0/ref',
      '/relationships/0/from',
    ])
    expect(result.source).toBe(
      document
        .replace('  - id: platform\n', '  - id: platform-team\n')
        .replace('owner: platform', 'owner: platform-team')
        .replace('ref: "platform"', 'ref: "platform-team"')
        .replace('from: platform', 'from: platform-team'),
    )
  })

  it('keeps a bare reference bare, a qualified one qualified, and the quoting', () => {
    const result = rewriteSubjectReferences(document, 'document', rename)
    if (!result.ok) throw new Error(result.aliases.join(', '))
    expect(result.source).toContain('owner: platform-team')
    expect(result.source).toContain('ref: "platform-team"')
  })

  it('carries an aspect suffix through the move', () => {
    const evidence = `format: yarramate/evidence/v1
id: checked
provider: ci
observations:
  - subject: 'platform~name'
    key: build.status
    value: green
`
    const result = rewriteSubjectReferences(evidence, 'evidence', rename)
    if (!result.ok) throw new Error(result.aliases.join(', '))
    expect(result.source).toContain("subject: 'platform-team~name'")
  })

  // Under flattened identity there is no such thing as "the same local id in
  // another document": one id names one subject anywhere in the workspace, so
  // a rename has to reach it wherever it was declared. The inverse of what
  // this test asserted before 1.0, and the reason the workspace-wide
  // uniqueness check has to exist.
  it('renames the subject in whichever document declares it', () => {
    const other = `format: yarramate/v1
id: other
profile: yarramate/core@0.1
concepts:
  - id: platform
    kind: businessActor
    name: Platform
relationships: []
`
    const result = rewriteSubjectReferences(other, 'document', rename)
    if (!result.ok) throw new Error(result.aliases.join(', '))
    expect(result.moved).toEqual(['/concepts/0/id'])
    expect(result.source).toContain('- id: platform-team')
  })

  it('refuses a file that holds an alias at a reference position', () => {
    const aliased = document.replace('owner: platform', 'owner: *anchor')
    const result = rewriteSubjectReferences(
      `${aliased.replace('  - id: platform\n', '  - id: &anchor platform\n')}`,
      'document',
      rename,
    )
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected refusal')
    expect(result.aliases).toEqual(['/concepts/1/owner'])
  })
})

describe('declaredStateIds', () => {
  it('lists the architecture states a document declares', () => {
    expect(declaredStateIds(document)).toEqual(['current'])
  })

  it('returns nothing when the document declares no states', () => {
    expect(declaredStateIds(document.replace(/states:[\s\S]*$/, ''))).toEqual([])
  })
})
