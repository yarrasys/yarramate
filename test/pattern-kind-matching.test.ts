import { describe, expect, it } from 'vitest'
import {
  compileWorkspaceWithProfileContext,
  type WorkspaceSource,
} from '../src/index.js'

// #449: a pattern slot matched its bound subject's kind EXACTLY, so a slot
// could not admit a family of variant subkinds. The motivating shape is a
// decisional dependency: a `secrets` slot admitting `bundled` or `vault`, each
// variant carrying its own pattern, so choosing the variant is what opens the
// next set of questions.
//
// `kindMatching: descendants` on a part, default `exact`. The word already
// means this on catalogue selectors and on `missing-relationship`, so this is
// one vocabulary rather than two.

const profile = `format: yarramate/profile/v1
id: acme/platform
version: "1.0"
extends: yarramate/core@0.1
conceptKinds:
  - id: platform-app
    name: Platform app
    parent: yarramate/core@0.1#grouping
  - id: secret-store
    name: Secret store
    parent: yarramate/core@0.1#applicationComponent
  - id: bundled-secrets
    name: Bundled secrets
    parent: acme/platform@1.0#secret-store
  - id: vault-secrets
    name: Vault secrets
    parent: acme/platform@1.0#secret-store
  - id: unrelated-component
    name: Unrelated component
    parent: yarramate/core@0.1#applicationComponent
relationshipKinds: []
`

const pattern = (kindMatching: string) => `format: yarramate/pattern/v1
id: platform
version: "1.0"
patterns:
  - kind: acme/platform@1.0#platform-app
    parts:
      secrets:
        kind: "acme/platform@1.0#secret-store"${kindMatching}
    wiring:
      - from: self
        kind: yarramate/core@0.1#aggregation
        to: secrets
`

const document = (secretsKind: string) => `format: yarramate/v1
id: main
profile: acme/platform@1.0
concepts:
  - id: app
    kind: platform-app
    name: App
    parts:
      secrets: the-store
  - id: the-store
    kind: ${secretsKind}
    name: The store
relationships: []
`

const compile = (kindMatching: string, secretsKind: string) => {
  const sources: readonly WorkspaceSource[] = [
    { path: 'profiles/platform.yaml', source: profile },
    { path: 'patterns/platform.yaml', source: pattern(kindMatching) },
    { path: 'architecture/main.yaml', source: document(secretsKind) },
  ]
  return compileWorkspaceWithProfileContext(sources)
}

const DESCENDANTS = '\n        kindMatching: descendants'

describe('#449: a slot can admit a family of variant subkinds', () => {
  it('refuses a subkind under the default, which stays exact', () => {
    // The behaviour that must not change. `exact` is the default, so no
    // shipped pattern means anything different after this.
    const result = compile('', 'bundled-secrets')
    expect(result.ok).toBe(false)
    if (result.ok) return
    const ym417 = result.diagnostics.filter(({ code }) => code === 'YM417')
    expect(ym417).toHaveLength(1)
    expect(ym417[0]!.message).toContain('acme/platform@1.0#bundled-secrets')
    // The bare message, with no mention of descendants: the slot did not ask
    // for them, so the diagnostic must not suggest they were considered.
    expect(ym417[0]!.message).not.toContain('descending')
  })

  it('admits a subkind under descendants', () => {
    const result = compile(DESCENDANTS, 'bundled-secrets')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(
      result.patternMemberships?.map(({ member, slot }) => [member, slot]),
    ).toEqual([['the-store', 'secrets']])
  })

  it('admits either variant, which is the point of the facet', () => {
    // A decisional dependency: the slot admits the family, and choosing which
    // member fills it is the decision the interview is there to elicit.
    for (const variant of ['bundled-secrets', 'vault-secrets']) {
      const result = compile(DESCENDANTS, variant)
      expect(result.ok).toBe(true)
    }
  })

  it('still admits the declared kind itself under descendants', () => {
    // `descendants` widens, never narrows: the slot kind is in its own
    // lineage and an exact bind keeps working.
    const result = compile(DESCENDANTS, 'secret-store')
    expect(result.ok).toBe(true)
  })

  it('still refuses a kind outside the family under descendants', () => {
    // `unrelated-component` shares an ANCESTOR with the slot kind
    // (applicationComponent) but does not descend from it. Sharing a parent is
    // not descent, and this is the assertion that separates the two.
    const result = compile(DESCENDANTS, 'unrelated-component')
    expect(result.ok).toBe(false)
    if (result.ok) return
    const ym417 = result.diagnostics.filter(({ code }) => code === 'YM417')
    expect(ym417).toHaveLength(1)
    // The message now says what the slot actually accepts, since a reader who
    // sees only the declared kind would think an exact bind was required.
    expect(ym417[0]!.message).toContain('or a kind descending from it')
  })

  it('refuses a subject that is not a concept at all', () => {
    const result = compileWorkspaceWithProfileContext([
      { path: 'profiles/platform.yaml', source: profile },
      { path: 'patterns/platform.yaml', source: pattern(DESCENDANTS) },
      {
        path: 'architecture/main.yaml',
        source: `format: yarramate/v1
id: main
profile: acme/platform@1.0
concepts:
  - id: app
    kind: platform-app
    name: App
    parts:
      secrets: app-serves-store
  - id: the-store
    kind: secret-store
    name: The store
relationships:
  - id: app-serves-store
    kind: serving
    from: the-store
    to: the-store
`,
      },
    ])
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.diagnostics.some(({ code }) => code === 'YM417')).toBe(true)
  })

  it('resolves a descendant to the same core kind as the slot kind', () => {
    // The issue argued this facet "fails safe" because minted wiring is
    // checked against the relationship table using the ACTUAL bound subjects'
    // kinds rather than the slot kinds. True, and worth stating precisely
    // rather than testing: `permittedBetween` resolves each kind to
    // `lineage[0]`, its core ancestor, and a descendant shares its ancestor's
    // core kind by construction. So the table returns the SAME verdict for the
    // slot kind and for any descendant of it, and no fixture can be built
    // where a slot admits a descendant the table then refuses.
    //
    // A test asserting otherwise would be a check that cannot fail. What is
    // checkable is the premise: a descendant is admitted and its wiring is
    // minted, exactly as the slot kind's would be.
    const result = compile(DESCENDANTS, 'vault-secrets')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(
      result.graph.claims
        .filter(
          (claim) => claim.predicate === 'yarramate/core@0.1#aggregation',
        )
        .map((claim) => claim.id),
    ).toEqual(['app-aggregation-secrets'])
  })
})
