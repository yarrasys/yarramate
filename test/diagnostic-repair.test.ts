import { describe, expect, it } from 'vitest'
import { compileWorkspace } from '../src/compiler.js'

const document = (body: string) => ({
  path: 'architecture/example.yaml',
  source: body,
})

const messagesOf = (sources: readonly { path: string; source: string }[]) => {
  const result = compileWorkspace(sources)
  expect(result.ok).toBe(false)
  return result.ok ? [] : result.diagnostics.map(({ message }) => message)
}

describe('repair-oriented diagnostics', () => {
  it('suggests the closest concept kind for a near miss', () => {
    const messages = messagesOf([
      document(
        'format: yarramate/v1\nid: example\nprofile: yarramate/core@0.1\nconcepts:\n  - id: a\n    kind: applicationServic\n    name: A\nrelationships: []\n',
      ),
    ])
    expect(messages).toContain(
      'Unknown concept kind "applicationServic" in profile "yarramate/core@0.1"; did you mean "applicationService"?',
    )
  })

  it('suggests the closest relationship kind for a near miss', () => {
    const messages = messagesOf([
      document(
        'format: yarramate/v1\nid: example\nprofile: yarramate/core@0.1\nconcepts:\n  - id: a\n    kind: applicationService\n    name: A\nrelationships:\n  - id: r\n    kind: servin\n    from: a\n    to: a\n',
      ),
    ])
    expect(
      messages.some((message) =>
        message.includes('did you mean "serving"?'),
      ),
    ).toBe(true)
  })

  it('offers no suggestion when nothing is close', () => {
    const messages = messagesOf([
      document(
        'format: yarramate/v1\nid: example\nprofile: yarramate/core@0.1\nconcepts:\n  - id: a\n    kind: zzzzzzzzzz\n    name: A\nrelationships: []\n',
      ),
    ])
    const unknown = messages.find((message) =>
      message.startsWith('Unknown concept kind "zzzzzzzzzz"'),
    )
    expect(unknown).toBeDefined()
    expect(unknown).not.toContain('did you mean')
  })

  it('names the expected constant on format violations', () => {
    const messages = messagesOf([
      document(
        'format: yarramate/document/v9\nid: example\nprofile: yarramate/core@0.1\nconcepts:\n  - id: a\n    kind: applicationService\n    name: A\n',
      ),
    ])
    expect(messages).toContain(
      'Document schema violation: must be equal to constant: expected "yarramate/v1"',
    )
  })

  it('lists the allowed values on enum violations', () => {
    const messages = messagesOf([
      document(
        'format: yarramate/v1\nid: example\nprofile: yarramate/core@0.1\nconcepts:\n  - id: a\n    kind: applicationService\n    name: A\n    status: activ\n',
      ),
    ])
    expect(messages).toContain(
      'Document schema violation: must be equal to one of the allowed values: "planned", "current", "retired"',
    )
  })

  it('carries the invocation-chain remedy on triggering aspect violations', () => {
    const messages = messagesOf([
      document(
        'format: yarramate/v1\nid: example\nprofile: yarramate/core@0.1\nconcepts:\n  - id: cli\n    kind: applicationComponent\n    name: CLI\n  - id: engine\n    kind: applicationComponent\n    name: Engine\nrelationships:\n  - id: cli-invokes-engine\n    kind: triggering\n    from: cli\n    to: engine\n',
      ),
    ])
    expect(messages).toContain(
      'Relationship "triggering" requires a source with aspect "behavior"; "cli" has aspect "active-structure"; use "flow" between active-structure elements, or introduce a behavior concept and "assignment"; both endpoints are active structure; valid candidates: composition, aggregation, assignment, realization, serving, association, flow, specialization',
    )
    expect(messages).toContain(
      'Relationship "triggering" requires a target with aspect "behavior"; "engine" has aspect "active-structure"; use "flow" between active-structure elements, or introduce a behavior concept and "assignment"; both endpoints are active structure; valid candidates: composition, aggregation, assignment, realization, serving, association, flow, specialization',
    )
  })

  it('carries the motivation-target remedy on influence aspect violations', () => {
    const messages = messagesOf([
      document(
        'format: yarramate/v1\nid: example\nprofile: yarramate/core@0.1\nconcepts:\n  - id: cli\n    kind: applicationComponent\n    name: CLI\n  - id: engine\n    kind: applicationComponent\n    name: Engine\nrelationships:\n  - id: cli-influences-engine\n    kind: influence\n    from: cli\n    to: engine\n',
      ),
    ])
    expect(messages).toContain(
      'Relationship "influence" requires a target with aspect "motivation"; "engine" has aspect "active-structure"; point "influence" at a motivation concept (a goal, requirement, or principle), or use "association"; both endpoints are active structure; valid candidates: composition, aggregation, assignment, realization, serving, association, flow, specialization',
    )
  })

  it('enumerates valid candidates for the observed aspect pair', () => {
    const messages = messagesOf([
      document(
        'format: yarramate/v1\nid: example\nprofile: yarramate/core@0.1\nconcepts:\n  - id: cli\n    kind: applicationComponent\n    name: CLI\n  - id: engine\n    kind: applicationComponent\n    name: Engine\nrelationships:\n  - id: cli-accesses-engine\n    kind: access\n    from: cli\n    to: engine\n',
      ),
    ])
    expect(messages).toContain(
      'Relationship "access" requires a target with aspect "passive-structure"; "engine" has aspect "active-structure"; point "access" at passive structure (a business object, data object, or artifact), or use "association"; both endpoints are active structure; valid candidates: composition, aggregation, assignment, realization, serving, association, flow, specialization',
    )
  })

  it('derives candidates deterministically and never lists the rejected kind', () => {
    const source = document(
      'format: yarramate/v1\nid: example\nprofile: yarramate/core@0.1\nconcepts:\n  - id: cli\n    kind: applicationComponent\n    name: CLI\n  - id: engine\n    kind: applicationComponent\n    name: Engine\nrelationships:\n  - id: cli-accesses-engine\n    kind: access\n    from: cli\n    to: engine\n',
    )
    const first = messagesOf([source])
    const second = messagesOf([source])
    expect(second).toEqual(first)
    const rejection = first.find((message) =>
      message.includes('valid candidates: '),
    )
    expect(rejection).toBeDefined()
    const candidates = (rejection ?? '')
      .slice((rejection ?? '').indexOf('valid candidates: ') + 'valid candidates: '.length)
      .split(', ')
    expect(candidates).not.toContain('access')
  })

  it('derives candidates for extension kinds without curated remedies', () => {
    const profile = {
      path: 'profiles/platform.yaml',
      source:
        'format: yarramate/profile/v1\nid: example/platform\nversion: "1.0"\nextends: yarramate/core@0.1\nconceptKinds: []\nrelationshipKinds:\n  - id: owns\n    name: Owns\n    parent: yarramate/core@0.1#assignment\n    targetAspects: [behavior]\n',
    }
    const messages = messagesOf([
      profile,
      document(
        'format: yarramate/v1\nid: example\nprofile: example/platform@1.0\nconcepts:\n  - id: team\n    kind: businessActor\n    name: Team\n  - id: north-star\n    kind: goal\n    name: North star\nrelationships:\n  - id: team-owns-north-star\n    kind: owns\n    from: team\n    to: north-star\n',
      ),
    ])
    expect(messages).toContain(
      'Relationship "owns" requires a target with aspect "behavior"; "north-star" has aspect "motivation"; source is active structure and target is motivation; valid candidates: composition, aggregation, assignment, realization, serving, influence, association, flow, specialization',
    )
  })

  it('lists matching extension kinds after the core policy matrix', () => {
    const profile = {
      path: 'profiles/platform.yaml',
      source:
        'format: yarramate/profile/v1\nid: example/platform\nversion: "1.0"\nextends: yarramate/core@0.1\nconceptKinds: []\nrelationshipKinds:\n  - id: owns\n    name: Owns\n    parent: yarramate/core@0.1#assignment\n    targetAspects: [behavior]\n',
    }
    const messages = messagesOf([
      profile,
      document(
        'format: yarramate/v1\nid: example\nprofile: example/platform@1.0\nconcepts:\n  - id: team\n    kind: businessActor\n    name: Team\n  - id: delivery\n    kind: businessProcess\n    name: Delivery\nrelationships:\n  - id: team-accesses-delivery\n    kind: access\n    from: team\n    to: delivery\n',
      ),
    ])
    expect(messages).toContain(
      'Relationship "access" requires a target with aspect "passive-structure"; "delivery" has aspect "behavior"; point "access" at passive structure (a business object, data object, or artifact), or use "association"; source is active structure and target is behavior; valid candidates: composition, aggregation, assignment, realization, serving, association, flow, specialization, owns',
    )
  })
})
