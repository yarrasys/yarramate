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

  it('accepts triggering between active-structure elements, as ArchiMate does', () => {
    // The aspect rule this replaced pinned triggering to behavior at both
    // ends and sent authors to `flow` as a workaround. Appendix B derives
    // active-to-active triggering, so the workaround is retired.
    const result = compileWorkspace([
      document(
        'format: yarramate/v1\nid: example\nprofile: yarramate/core@0.1\nconcepts:\n  - id: cli\n    kind: applicationComponent\n    name: CLI\n  - id: engine\n    kind: applicationComponent\n    name: Engine\nrelationships:\n  - id: cli-invokes-engine\n    kind: triggering\n    from: cli\n    to: engine\n',
      ),
    ])
    expect(result.ok).toBe(true)
  })

  it('names the kinds the table permits when it rejects a pair', () => {
    const messages = messagesOf([
      document(
        'format: yarramate/v1\nid: example\nprofile: yarramate/core@0.1\nconcepts:\n  - id: cli\n    kind: applicationComponent\n    name: CLI\n  - id: data\n    kind: dataObject\n    name: Data\nrelationships:\n  - id: cli-triggers-data\n    kind: triggering\n    from: cli\n    to: data\n',
      ),
    ])
    expect(messages).toContain(
      'Relationship "triggering" is not permitted from "cli" (applicationComponent) to "data" (dataObject); ArchiMate 3.2 permits: access, association',
    )
  })

  it('rejects influence toward anything but motivation', () => {
    const messages = messagesOf([
      document(
        'format: yarramate/v1\nid: example\nprofile: yarramate/core@0.1\nconcepts:\n  - id: cli\n    kind: applicationComponent\n    name: CLI\n  - id: engine\n    kind: applicationComponent\n    name: Engine\nrelationships:\n  - id: cli-influences-engine\n    kind: influence\n    from: cli\n    to: engine\n',
      ),
    ])
    expect(messages).toContain(
      'Relationship "influence" is not permitted from "cli" (applicationComponent) to "engine" (applicationComponent); ArchiMate 3.2 permits: composition, aggregation, realization, serving, association, triggering, flow, specialization',
    )
  })

  it('enumerates the permitted kinds for the observed pair', () => {
    const messages = messagesOf([
      document(
        'format: yarramate/v1\nid: example\nprofile: yarramate/core@0.1\nconcepts:\n  - id: cli\n    kind: applicationComponent\n    name: CLI\n  - id: engine\n    kind: applicationComponent\n    name: Engine\nrelationships:\n  - id: cli-accesses-engine\n    kind: access\n    from: cli\n    to: engine\n',
      ),
    ])
    expect(messages).toContain(
      'Relationship "access" is not permitted from "cli" (applicationComponent) to "engine" (applicationComponent); ArchiMate 3.2 permits: composition, aggregation, realization, serving, association, triggering, flow, specialization',
    )
  })

  it('derives candidates deterministically and never lists the rejected kind', () => {
    const source = document(
      'format: yarramate/v1\nid: example\nprofile: yarramate/core@0.1\nconcepts:\n  - id: cli\n    kind: applicationComponent\n    name: CLI\n  - id: engine\n    kind: applicationComponent\n    name: Engine\nrelationships:\n  - id: cli-accesses-engine\n    kind: access\n    from: cli\n    to: engine\n',
    )
    const first = messagesOf([source])
    const second = messagesOf([source])
    expect(second).toEqual(first)
    const marker = 'ArchiMate 3.2 permits: '
    const rejection = first.find((message) => message.includes(marker))
    expect(rejection).toBeDefined()
    const candidates = (rejection ?? '')
      .slice((rejection ?? '').indexOf(marker) + marker.length)
      .split(', ')
    expect(candidates).not.toContain('access')
  })

  it('names an extension kind by its core ancestor when the table rejects it', () => {
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
      'Relationship "owns" (assignment) is not permitted from "team" (businessActor) to "north-star" (goal); ArchiMate 3.2 permits: realization, influence, association',
    )
  })

  it('lists matching extension kinds after the core kinds', () => {
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
      'Relationship "access" is not permitted from "team" (businessActor) to "delivery" (businessProcess); ArchiMate 3.2 permits: assignment, serving, association, triggering, flow, owns',
    )
  })

  it('reports an extension kind narrowing a pair the table permits, per endpoint', () => {
    // An actor may be assigned to a role in ArchiMate, so the table passes;
    // the profile narrowed `owns` to behavior targets, and that is what the
    // diagnostic has to say. The permitted list still excludes the rejected
    // kind and anything the candidates' own narrowing would refuse.
    const profile = {
      path: 'profiles/platform.yaml',
      source:
        'format: yarramate/profile/v1\nid: example/platform\nversion: "1.0"\nextends: yarramate/core@0.1\nconceptKinds: []\nrelationshipKinds:\n  - id: owns\n    name: Owns\n    parent: yarramate/core@0.1#assignment\n    targetAspects: [behavior]\n',
    }
    const messages = messagesOf([
      profile,
      document(
        'format: yarramate/v1\nid: example\nprofile: example/platform@1.0\nconcepts:\n  - id: team\n    kind: businessActor\n    name: Team\n  - id: lead\n    kind: businessRole\n    name: Lead\nrelationships:\n  - id: team-owns-lead\n    kind: owns\n    from: team\n    to: lead\n',
      ),
    ])
    expect(messages).toContain(
      'Relationship "owns" requires a target with aspect "behavior"; "lead" has aspect "active-structure"; ArchiMate 3.2 permits: assignment, serving, association, triggering, flow',
    )
  })
})
