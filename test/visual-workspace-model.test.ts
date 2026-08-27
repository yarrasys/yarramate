import { describe, expect, it } from 'vitest'
import { compileWorkspaceWithProfileContext } from '../src/compiler.js'
import {
  interrogationOverlayOf,
  renderedWorkspaceOf,
} from '../src/adapters/visual/workspace-model.js'

/**
 * The interrogation overlay (#292): the report folded for drawing.
 *
 * A hand-authored catalogue rather than the shipped one, so these pin the
 * FOLD - scope split, interpolation, absence - without pinning question
 * counts that legitimately move with every catalogue version.
 */

const document = `format: yarramate/v1
id: main
profile: yarramate/core@0.1
concepts:
  - id: teller
    kind: businessActor
    name: Teller
  - id: checkout
    kind: applicationComponent
    name: Checkout
relationships: []
`

const catalogue = {
  path: 'fixture-catalogue.yaml',
  source: `format: yarramate/question-catalogue/v1
id: fixture
version: "1.0"
profile: yarramate/core@0.1
waves:
  - id: motivation
    name: Motivation
questions:
  - id: goal-missing
    wave: motivation
    scope: workspace
    trigger:
      - condition: no-subject-of-kind
        kinds: ["yarramate/core@0.1#goal"]
    question: What outcome justifies this system?
    materiality: Without a goal every trade-off becomes taste.
    authority: human
    resolution: Add a goal concept.
  - id: actor-owner-missing
    wave: motivation
    since: "0.7"
    scope: subject
    subjects:
      kinds: ["yarramate/core@0.1#businessActor"]
    trigger:
      - condition: missing-claim
        predicate: yarramate/ownership/owner
    question: Who is accountable for {subject.name}?
    materiality: Unowned work is re-litigated in every review.
    authority: human
    resolution: Add an ownership claim.
`,
}

const compiled = () => {
  const result = compileWorkspaceWithProfileContext([
    { path: 'architecture/main.yaml', source: document },
  ])
  if (!result.ok) {
    throw new Error(
      `fixture must compile: ${result.diagnostics[0]?.message ?? 'unknown'}`,
    )
  }
  return { graph: result.graph, profileContext: result.profileContext }
}

const metadata = {
  authority: 'canonical',
  initialView: '',
  documents: ['architecture/main.yaml'],
  layouts: {},
  sourceDigests: {},
  projectionDigests: {},
} as const

/**
 * Dismissal ids are QUALIFIED now (#345, ADR 0129). A host matching a stored
 * dismissal against a report question matches on `catalogue#question`, which
 * is the migration every adopter makes once: two key fields collapse into one.
 * Accepting a bare id as well would put the two identifiers back that
 * qualification exists to remove.
 */
describe('interrogationOverlayOf', () => {
  it('splits workspace-scoped questions from per-subject ones', () => {
    const overlay = interrogationOverlayOf(compiled(), catalogue)
    expect(overlay).toBeDefined()
    expect(overlay!.workspace.map(({ questionId }) => questionId)).toEqual([
      'fixture#goal-missing',
    ])
    expect(Object.keys(overlay!.subjects)).toEqual(['teller'])
    // The per-subject phrasing arrives already interpolated - the browser
    // never sees a {subject.name} placeholder.
    expect(overlay!.subjects['teller']![0]!.question).toBe(
      'Who is accountable for Teller?',
    )
    expect(overlay!.subjects['teller']![0]!.since).toBe('0.7')
    expect(overlay!.subjects['teller']![0]!.authority).toBe('human')
  })

  it('names the catalogue and the engine semantics that answered', () => {
    const overlay = interrogationOverlayOf(compiled(), catalogue)!
    expect(overlay.catalogue).toBe('fixture@1.0')
    // ADR 0106: a consumer holding the overlay can tell "the model moved"
    // from "the engine moved".
    expect(overlay.semantics.length).toBeGreaterThan(0)
  })

  it('is deterministic for one compile', () => {
    const once = interrogationOverlayOf(compiled(), catalogue)
    const twice = interrogationOverlayOf(compiled(), catalogue)
    expect(twice).toEqual(once)
  })

  // A host with its own interrogation supplies its own questions AND what it
  // has already dealt with (#328). The engine is yarramate's and so is the UI;
  // the questions belong to whoever adopted it, and a question a reviewer set
  // aside in the host's own product must not be asked again by a pane embedded
  // in it.
  describe('a host that has already dealt with a question', () => {
    it('drops it from every subject when no subject is named', () => {
      const overlay = interrogationOverlayOf(compiled(), catalogue, [
        { questionId: 'fixture#actor-owner-missing' },
      ])!
      expect(Object.keys(overlay.subjects)).toEqual([])
      // The workspace-scoped question is untouched: dismissing one says
      // nothing about the others.
      expect(overlay.workspace.map(({ questionId }) => questionId)).toEqual([
        'fixture#goal-missing',
      ])
    })

    it('drops a workspace-scoped question by id alone', () => {
      const overlay = interrogationOverlayOf(compiled(), catalogue, [
        { questionId: 'fixture#goal-missing' },
      ])!
      expect(overlay.workspace).toEqual([])
    })

    it('drops it for the named subject only', () => {
      const kept = interrogationOverlayOf(compiled(), catalogue, [
        { questionId: 'fixture#actor-owner-missing', subject: 'somebody-else' },
      ])!
      expect(Object.keys(kept.subjects)).toEqual(['teller'])

      const dropped = interrogationOverlayOf(compiled(), catalogue, [
        { questionId: 'fixture#actor-owner-missing', subject: 'teller' },
      ])!
      expect(Object.keys(dropped.subjects)).toEqual([])
    })

    // Dismissal decides what the PANE draws and nothing else: the model is
    // untouched and `ask --open` still reports the question, because the
    // interview is not the editor's to settle.
    it('changes nothing about the catalogue the overlay names', () => {
      const overlay = interrogationOverlayOf(compiled(), catalogue, [
        { questionId: 'fixture#goal-missing' },
        { questionId: 'fixture#actor-owner-missing' },
      ])!
      expect(overlay.catalogue).toBe('fixture@1.0')
      expect(overlay.semantics.length).toBeGreaterThan(0)
    })

    it('is a no-op when the host has dismissed nothing', () => {
      expect(interrogationOverlayOf(compiled(), catalogue, [])).toEqual(
        interrogationOverlayOf(compiled(), catalogue),
      )
    })
  })

  it('returns undefined for a catalogue that does not load, never a throw', () => {
    expect(
      interrogationOverlayOf(compiled(), {
        path: 'broken.yaml',
        source: 'format: something/else\n',
      }),
    ).toBeUndefined()
  })
})

describe('renderedWorkspaceOf interrogation', () => {
  it('ships the overlay beside the graph when a catalogue is supplied', () => {
    const { model } = renderedWorkspaceOf(compiled(), [], metadata, catalogue)
    expect(model.interrogation).toBeDefined()
    expect(model.interrogation!.workspace).toHaveLength(1)
  })

  it('ships no overlay - not an empty one - when no catalogue is supplied', () => {
    const { model } = renderedWorkspaceOf(compiled(), [], metadata)
    expect(model.interrogation).toBeUndefined()
    expect('interrogation' in model).toBe(false)
  })
})
