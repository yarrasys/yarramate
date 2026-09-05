import { describe, expect, it } from 'vitest'
import {
  compileWorkspaceWithProfileContext,
  type WorkspaceSource,
} from '../src/index.js'

// #473 phase 4 item 4.2 (ADR 0146): the pattern document has had a JSON schema
// since ADR 0123 and never a public TypeScript type, so a host that wanted to
// offer patterns on a palette had to re-read the YAML or guess at the shape.
// `ResolvedProfileContext.patterns` is that shape, resolved.

const profile = `format: yarramate/profile/v1
id: acme/api
version: "1.0"
extends: yarramate/core@0.1
conceptKinds:
  - id: api
    name: API
    parent: yarramate/core@0.1#grouping
  - id: special-service
    name: Special service
    parent: yarramate/core@0.1#applicationService
relationshipKinds: []
`

const pattern = `format: yarramate/pattern/v1
id: acme-api
version: "1.0"
patterns:
  - kind: acme/api@1.0#api
    parts:
      interface:
        kind: yarramate/core@0.1#applicationInterface
        required: true
      service:
        kind: yarramate/core@0.1#applicationService
        kindMatching: descendants
      backend:
        kind: yarramate/core@0.1#applicationComponent
    wiring:
      - from: self
        kind: yarramate/core@0.1#aggregation
        to: interface
      - from: backend
        kind: yarramate/core@0.1#serving
        to: self
    ports:
      - kind: yarramate/core@0.1#serving
        out: interface
        in: backend
`

const document = `format: yarramate/v1
id: main
profile: acme/api@1.0
concepts:
  - id: only-thing
    kind: applicationComponent
    name: Only thing
relationships: []
`

const sources: readonly WorkspaceSource[] = [
  { path: 'profiles/api.yaml', source: profile },
  { path: 'patterns/api.yaml', source: pattern },
  { path: 'architecture/main.yaml', source: document },
]

const resolved = () => {
  const compiled = compileWorkspaceWithProfileContext(sources)
  if (!compiled.ok) {
    throw new Error(
      compiled.diagnostics.map(({ code, message }) => `${code} ${message}`).join('; '),
    )
  }
  return compiled.profileContext.patterns ?? []
}

describe('a pattern is readable without re-reading its document', () => {
  it('reports the pattern, its kind and the document that declared it', () => {
    const patterns = resolved()
    expect(patterns.map(({ kindIdentity }) => kindIdentity)).toEqual([
      'acme/api@1.0#api',
    ])
    // The PATH, not the document's id: it is what a diagnostic names and what
    // a reader can open.
    expect(patterns[0]?.declaredBy).toBe('patterns/api.yaml')
  })

  it('keeps the slots in the order the document declared them', () => {
    // Not alphabetical, and not a map's iteration order: the order a pattern
    // declares its slots is the order a form should ask for them, and a
    // consumer must not have to trust an implementation detail for that.
    expect(resolved()[0]?.slots.map(({ name }) => name)).toEqual([
      'interface',
      'service',
      'backend',
    ])
  })

  it('carries each slot resolved, not as authored', () => {
    const slots = resolved()[0]?.slots ?? []
    expect(slots[0]).toEqual({
      name: 'interface',
      kindIdentity: 'yarramate/core@0.1#applicationInterface',
      required: true,
      kindMatching: 'exact',
    })
    // `required` defaults false and `kindMatching` defaults exact, both stated
    // rather than left for the caller to know.
    expect(slots[1]).toEqual({
      name: 'service',
      kindIdentity: 'yarramate/core@0.1#applicationService',
      required: false,
      kindMatching: 'descendants',
    })
  })

  it('carries the wiring, with self naming the instance', () => {
    expect(resolved()[0]?.wiring).toEqual([
      {
        from: 'self',
        to: 'interface',
        kindIdentity: 'yarramate/core@0.1#aggregation',
      },
      {
        from: 'backend',
        to: 'self',
        kindIdentity: 'yarramate/core@0.1#serving',
      },
    ])
  })

  it('carries the ports, keyed by the relationship kind', () => {
    expect(resolved()[0]?.ports).toEqual([
      {
        kindIdentity: 'yarramate/core@0.1#serving',
        out: 'interface',
        in: 'backend',
      },
    ])
  })

  it('is absent rather than empty for a workspace with no patterns', () => {
    // An empty list would say "this workspace has no patterns"; absence says
    // "nobody looked". A host reads it as `?? []` and offers none either way,
    // but the two are different claims (rule 2).
    const compiled = compileWorkspaceWithProfileContext(sources.slice(0, 1).concat(
      { path: 'architecture/main.yaml', source: document },
    ))
    if (!compiled.ok) throw new Error('fixture does not compile')
    expect(compiled.profileContext.patterns).toEqual([])
  })
})
