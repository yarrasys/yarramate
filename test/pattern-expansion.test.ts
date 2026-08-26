import { describe, expect, it } from 'vitest'
import {
  compileWorkspaceWithProfileContext,
  type WorkspaceSource,
} from '../src/index.js'

// Structural patterns (#268, ADR 0123). An architect authors "System API"
// once; canonical ArchiMate spells the cluster out. The pattern declares the
// shape, the instance BINDS the subjects that fill it, and the compiler mints
// the wiring between them - downward expansion, which is a compiler rather
// than the upward derivation every earlier attempt tried and lost to.

const profile: WorkspaceSource = {
  path: 'profiles/api-led.yaml',
  source: `format: yarramate/profile/v1
id: yarrasys/api-led
version: "1.0"
extends: yarramate/core@0.1
conceptKinds:
  - id: api
    name: API
    parent: yarramate/core@0.1#grouping
relationshipKinds: []
`,
}

const pattern = (wiring?: string, ports?: string): WorkspaceSource => ({
  path: 'patterns/api-led.yaml',
  source: `format: yarramate/pattern/v1
id: api-led
version: "1.0"
patterns:
  - kind: yarrasys/api-led@1.0#api
    parts:
      component:
        kind: yarramate/core@0.1#applicationComponent
        required: true
      interface:
        kind: yarramate/core@0.1#applicationInterface
        required: true
      service:
        kind: yarramate/core@0.1#applicationService
${ports ?? ''}    wiring:
${
  wiring ??
  `      - from: self
        kind: yarramate/core@0.1#aggregation
        to: component
      - from: self
        kind: yarramate/core@0.1#aggregation
        to: interface
      - from: component
        kind: yarramate/core@0.1#composition
        to: interface
      - from: interface
        kind: yarramate/core@0.1#assignment
        to: service`
}
`,
})

const document = (body: string): WorkspaceSource => ({
  path: 'architecture/main.yaml',
  source: `format: yarramate/v1
id: main
profile: yarrasys/api-led@1.0
${body}`,
})

const cluster = (parts: string, relationships = '[]') =>
  document(`concepts:
  - id: sys-api
    kind: api
    name: System API
${parts}
  - id: sys-component
    kind: applicationComponent
    name: System component
  - id: sys-interface
    kind: applicationInterface
    name: System interface
  - id: sys-service
    kind: applicationService
    name: System service
relationships: ${relationships}
`)

const boundParts = `    parts:
      component: sys-component
      interface: sys-interface
      service: sys-service`

const compile = (sources: readonly WorkspaceSource[]) =>
  compileWorkspaceWithProfileContext([...sources])

const codes = (sources: readonly WorkspaceSource[]): readonly string[] => {
  const result = compile(sources)
  return result.ok ? [] : result.diagnostics.map(({ code }) => code)
}

const wiringOf = (sources: readonly WorkspaceSource[]) => {
  const result = compile(sources)
  if (!result.ok) {
    throw new Error(
      `expected a compile: ${result.diagnostics
        .map(({ code, message }) => `${code} ${message}`)
        .join('; ')}`,
    )
  }
  const relationships = new Set(
    result.graph.subjects
      .filter(({ type }) => type === 'relationship')
      .map(({ id }) => id),
  )
  return result.graph.claims
    .filter((claim) => relationships.has(claim.id) && 'ref' in claim.object)
    .map((claim) => ({
      id: claim.id,
      from: claim.subject,
      to: 'ref' in claim.object ? claim.object.ref : '',
      kind: claim.predicate,
      source: `${claim.source.path}${claim.source.pointer}`,
    }))
}

describe('a pattern mints the wiring between the parts an instance binds', () => {
  it('expands every wire, with ids derived from the instance and its slots', () => {
    expect(wiringOf([profile, pattern(), cluster(boundParts)])).toEqual([
      {
        id: 'sys-api-aggregation-component',
        from: 'sys-api',
        to: 'sys-component',
        kind: 'yarramate/core@0.1#aggregation',
        source: 'architecture/main.yaml/concepts/0/parts/component',
      },
      {
        id: 'sys-api-aggregation-interface',
        from: 'sys-api',
        to: 'sys-interface',
        kind: 'yarramate/core@0.1#aggregation',
        source: 'architecture/main.yaml/concepts/0/parts/interface',
      },
      {
        id: 'sys-api-component-composition-interface',
        from: 'sys-component',
        to: 'sys-interface',
        kind: 'yarramate/core@0.1#composition',
        source: 'architecture/main.yaml/concepts/0/parts/interface',
      },
      {
        id: 'sys-api-interface-assignment-service',
        from: 'sys-interface',
        to: 'sys-service',
        kind: 'yarramate/core@0.1#assignment',
        source: 'architecture/main.yaml/concepts/0/parts/service',
      },
    ])
  })

  // The claim is `declared` and points at the binding line, because that is
  // where the author said it: the pattern only says which KIND of edge a bound
  // pair gets. `yarramate/graph/v2` does not move for this.
  it('sources a minted claim to the binding that produced it', () => {
    const result = compile([profile, pattern(), cluster(boundParts)])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const minted = result.graph.claims.find(
      ({ id }) => id === 'sys-api-aggregation-component',
    )
    expect(minted?.origin).toBe('declared')
    expect(minted?.source.document).toBe('main')
    expect(minted?.source.line).toBeGreaterThan(0)
  })

  // Adoption must cost no edit. A model that already wrote the wiring by hand
  // keeps exactly one edge, not two: without this, taking up a pattern would
  // double every wire on the first compile.
  it('mints nothing where an authored relationship already says it', () => {
    const authored = cluster(
      boundParts,
      `
  - id: hand-written
    kind: aggregation
    from: sys-api
    to: sys-component
`,
    )
    const wiring = wiringOf([profile, pattern(), authored])
    expect(wiring.filter(({ to }) => to === 'sys-component')).toEqual([
      {
        id: 'hand-written',
        from: 'sys-api',
        to: 'sys-component',
        kind: 'yarramate/core@0.1#aggregation',
        source: 'architecture/main.yaml/relationships/0',
      },
    ])
    // The other three are still minted.
    expect(wiring).toHaveLength(4)
  })

  it('leaves an unbound optional part unwired, and says nothing about it', () => {
    const wiring = wiringOf([
      profile,
      pattern(),
      cluster(`    parts:
      component: sys-component
      interface: sys-interface`),
    ])
    expect(wiring.map(({ id }) => id)).toEqual([
      'sys-api-aggregation-component',
      'sys-api-aggregation-interface',
      'sys-api-component-composition-interface',
    ])
  })
})

describe('the pattern owns the pairs it wires', () => {
  it('refuses an authored relationship that reverses a wire (YM418)', () => {
    const reversed = cluster(
      boundParts,
      `
  - id: backwards
    kind: composition
    from: sys-interface
    to: sys-component
`,
    )
    expect(codes([profile, pattern(), reversed])).toContain('YM418')
  })

  it('refuses a different kind between a pair the pattern speaks for (YM418)', () => {
    const disagreeing = cluster(
      boundParts,
      `
  - id: second-opinion
    kind: serving
    from: sys-component
    to: sys-interface
`,
    )
    expect(codes([profile, pattern(), disagreeing])).toContain('YM418')
  })

  // Outside edges are free: only the pairs the wiring names are reserved.
  it('leaves an edge from a part to anything else alone', () => {
    const outside = document(`concepts:
  - id: sys-api
    kind: api
    name: System API
${boundParts}
  - id: sys-component
    kind: applicationComponent
    name: System component
  - id: sys-interface
    kind: applicationInterface
    name: System interface
  - id: sys-service
    kind: applicationService
    name: System service
  - id: consumer
    kind: applicationComponent
    name: Consumer
relationships:
  - id: consumer-calls-interface
    kind: serving
    from: sys-interface
    to: consumer
`)
    expect(codes([profile, pattern(), outside])).toEqual([])
  })
})

describe('an instance that does not keep the shape', () => {
  it('refuses an unbound required part (YM416)', () => {
    expect(
      codes([
        profile,
        pattern(),
        cluster(`    parts:
      component: sys-component`),
      ]),
    ).toContain('YM416')
  })

  it('refuses a part bound to the wrong kind (YM417)', () => {
    expect(
      codes([
        profile,
        pattern(),
        cluster(`    parts:
      component: sys-service
      interface: sys-interface`),
      ]),
    ).toContain('YM417')
  })

  it('refuses a part that names nothing (YM315)', () => {
    expect(
      codes([
        profile,
        pattern(),
        cluster(`    parts:
      component: nowhere
      interface: sys-interface`),
      ]),
    ).toContain('YM315')
  })

  it('refuses one subject filling two slots (YM315)', () => {
    expect(
      codes([
        profile,
        pattern(),
        cluster(`    parts:
      component: sys-component
      interface: sys-component`),
      ]),
    ).toContain('YM315')
  })

  it('refuses a slot the pattern does not declare (YM419)', () => {
    expect(
      codes([
        profile,
        pattern(),
        cluster(`    parts:
      component: sys-component
      interface: sys-interface
      gateway: sys-service`),
      ]),
    ).toContain('YM419')
  })

  it('refuses parts on a kind with no pattern (YM419)', () => {
    const noPattern = document(`concepts:
  - id: plain
    kind: applicationComponent
    name: Plain
    parts:
      component: other
  - id: other
    kind: applicationComponent
    name: Other
relationships: []
`)
    expect(codes([profile, pattern(), noPattern])).toContain('YM419')
  })

  it('refuses a derived wiring id that is already a subject (YM420)', () => {
    const collision = document(`concepts:
  - id: sys-api
    kind: api
    name: System API
${boundParts}
  - id: sys-component
    kind: applicationComponent
    name: System component
  - id: sys-interface
    kind: applicationInterface
    name: System interface
  - id: sys-service
    kind: applicationService
    name: System service
  - id: sys-api-aggregation-component
    kind: applicationComponent
    name: An unfortunate name
relationships: []
`)
    expect(codes([profile, pattern(), collision])).toContain('YM420')
  })
})

describe('a pattern that cannot expand legally fails once, at the pattern', () => {
  // The slot kinds fix both endpoint kinds, so whether the relationship table
  // permits a wire is knowable without any instance. Saying it once here beats
  // saying it against every instance that was authored correctly.
  it('refuses wiring the relationship table forbids (YM404)', () => {
    // The table permits flow, assignment, association, realization, triggering
    // and serving from an application component to an application service, and
    // no whole-part kind: a component does not compose a service.
    const illegal = pattern(`      - from: component
        kind: yarramate/core@0.1#composition
        to: service`)
    const diagnostics = codes([profile, illegal, cluster(boundParts)])
    expect(diagnostics).toEqual(['YM404'])
  })

  it('refuses wiring that names a part it does not declare (YM302)', () => {
    const stray = pattern(`      - from: self
        kind: yarramate/core@0.1#aggregation
        to: gateway`)
    expect(codes([profile, stray, cluster(boundParts)])).toContain('YM302')
  })

  it('refuses a second pattern for one kind (YM411)', () => {
    const second: WorkspaceSource = {
      path: 'patterns/api-led-again.yaml',
      source: pattern().source.replace('id: api-led', 'id: api-led-again'),
    }
    expect(codes([profile, pattern(), second, cluster(boundParts)])).toContain(
      'YM411',
    )
  })
})

// ---- phase 2: macro edges through ports (#268, ADR 0124) --------------------
//
// "System API serves Process API" is one authored fact at the grain an
// architect thinks in. The port says where it lands canonically, and the macro
// edge SURVIVES the expansion, which is what gives a collapsed view edges to
// draw - the property every upward-derivation attempt lost.

const SERVING_PORT = `    ports:
      - kind: yarramate/core@0.1#serving
        out: service
        in: component
`

const twoApis = (relationships: string, secondParts = `    parts:
      component: prc-component
      interface: prc-interface
      service: prc-service`) =>
  document(`concepts:
  - id: sys-api
    kind: api
    name: System API
${boundParts}
  - id: sys-component
    kind: applicationComponent
    name: System component
  - id: sys-interface
    kind: applicationInterface
    name: System interface
  - id: sys-service
    kind: applicationService
    name: System service
  - id: prc-api
    kind: api
    name: Process API
${secondParts}
  - id: prc-component
    kind: applicationComponent
    name: Process component
  - id: prc-interface
    kind: applicationInterface
    name: Process interface
  - id: prc-service
    kind: applicationService
    name: Process service
relationships: ${relationships}
`)

const MACRO_SERVING = `
  - id: sys-serves-prc
    kind: serving
    from: sys-api
    to: prc-api
`

describe('a port says where a macro edge lands', () => {
  it('expands the macro edge to the canonical pair, and keeps the macro edge', () => {
    const wiring = wiringOf([
      profile,
      pattern(undefined, SERVING_PORT),
      twoApis(MACRO_SERVING),
    ])
    const serving = wiring.filter(({ kind }) =>
      kind.endsWith('#serving'),
    )
    expect(serving).toEqual([
      {
        id: 'sys-serves-prc',
        from: 'sys-api',
        to: 'prc-api',
        kind: 'yarramate/core@0.1#serving',
        source: 'architecture/main.yaml/relationships/0',
      },
      {
        // Out of the provider's service, into the consumer's component.
        id: 'sys-serves-prc-expansion',
        from: 'sys-service',
        to: 'prc-component',
        kind: 'yarramate/core@0.1#serving',
        source: 'architecture/main.yaml/relationships/0',
      },
    ])
  })

  // The correspondence a description used to assert. Where the member-grain
  // edge is already authored, the macro edge and it agree and nothing is
  // minted - which is what makes the agreement VERIFIED rather than trusted.
  it('mints nothing where the canonical pair is already authored', () => {
    const both = twoApis(`${MACRO_SERVING}  - id: service-serves-component
    kind: serving
    from: sys-service
    to: prc-component
`)
    const wiring = wiringOf([profile, pattern(undefined, SERVING_PORT), both])
    expect(
      wiring
        .filter(({ kind }) => kind.endsWith('#serving'))
        .map(({ id }) => id)
        .sort(),
    ).toEqual(['service-serves-component', 'sys-serves-prc'])
  })

  // A pattern that says nothing about a kind has not claimed it: groupings may
  // legally relate, and an unported kind between two instances is an ordinary
  // relationship.
  it('leaves an unported kind between two instances alone', () => {
    const association = twoApis(`
  - id: sys-associates-prc
    kind: association
    from: sys-api
    to: prc-api
`)
    const wiring = wiringOf([
      profile,
      pattern(undefined, SERVING_PORT),
      association,
    ])
    expect(wiring.filter(({ id }) => id.endsWith('-expansion'))).toEqual([])
  })

  it('refuses a macro edge whose landing slot is unbound (YM421)', () => {
    const unbound = twoApis(
      MACRO_SERVING,
      `    parts:
      component: prc-component
      interface: prc-interface`,
    )
    // The target binds no service, but `in` is component, so this one lands.
    expect(codes([profile, pattern(undefined, SERVING_PORT), unbound])).toEqual(
      [],
    )

    const noService = twoApis(
      MACRO_SERVING,
      `    parts:
      component: prc-component
      interface: prc-interface
      service: prc-service`,
    ).source.replace(
      `    parts:
      component: sys-component
      interface: sys-interface
      service: sys-service`,
      `    parts:
      component: sys-component
      interface: sys-interface`,
    )
    expect(
      codes([
        profile,
        pattern(undefined, SERVING_PORT),
        { path: 'architecture/main.yaml', source: noService },
      ]),
    ).toContain('YM421')
  })

  // The one legality question ports CANNOT settle when the pattern resolves:
  // the two ends belong to different patterns, and neither knows the other's
  // slot kinds. So the pair the ports actually name is judged at expansion,
  // against the macro edge that asked for it. Without it the compiler emits a
  // relationship the table forbids, which is the one thing check exists to
  // make impossible.
  it('refuses an expansion the relationship table forbids (YM404)', () => {
    // composition is not permitted from an application service to an
    // application component, though it IS permitted between the two groupings
    // the macro edge joins - so nothing before this point can catch it.
    const forbidden = pattern(
      undefined,
      `    ports:
      - kind: yarramate/core@0.1#composition
        out: service
        in: component
`,
    )
    const macroComposition = twoApis(`
  - id: sys-composes-prc
    kind: composition
    from: sys-api
    to: prc-api
`)
    expect(codes([profile, forbidden, macroComposition])).toContain('YM404')
  })

  it('refuses a port naming a part the pattern does not declare (YM302)', () => {
    const stray = pattern(
      undefined,
      `    ports:
      - kind: yarramate/core@0.1#serving
        out: gateway
        in: component
`,
    )
    expect(codes([profile, stray, twoApis(MACRO_SERVING)])).toContain('YM302')
  })

  it('refuses two ports for one kind (YM201)', () => {
    const twice = pattern(
      undefined,
      `    ports:
      - kind: yarramate/core@0.1#serving
        out: service
        in: component
      - kind: yarramate/core@0.1#serving
        out: interface
        in: component
`,
    )
    expect(codes([profile, twice, twoApis(MACRO_SERVING)])).toContain('YM201')
  })
})
