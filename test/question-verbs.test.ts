import { describe, expect, it } from 'vitest'
import { assistantBrief, verbFor } from '../src/visual-app/question-verbs.js'
import type { VisualQuestionEntry } from '../src/adapters/visual/wire.js'
import type { CatalogueCondition } from '../src/interrogate-command.js'

/**
 * One verb per question, from the trigger and never from the phrasing
 * (#515, ADR 0150). The triggers here are the shipped catalogue's own, one
 * per condition, copied from `catalogues/` so the table is exercised on the
 * shapes it will actually meet.
 */

const row = (
  trigger: readonly CatalogueCondition[] | undefined,
  scope: 'workspace' | 'subject' = 'subject',
): VisualQuestionEntry => ({
  questionId: 'fixture#q',
  question: 'A question',
  authority: 'human',
  scope,
  ...(trigger === undefined ? {} : { trigger }),
})

describe('verbFor', () => {
  it('arms the connection tool the way round the question meant, with its kinds', () => {
    // goal-unrealized: what realizes this goal? The edge ends at the goal.
    expect(
      verbFor(
        row([
          {
            condition: 'missing-relationship',
            kinds: ['yarramate/core@0.1#realization'],
            direction: 'incoming',
          },
        ]),
      ),
    ).toEqual({
      kind: 'connect',
      label: 'Connect what realizes it…',
      kinds: ['yarramate/core@0.1#realization'],
      direction: 'incoming',
    })
    // stakeholder-unconcerned: what does the stakeholder care about? Drawn
    // from the stakeholder, either kind.
    expect(
      verbFor(
        row([
          {
            condition: 'missing-relationship',
            kinds: [
              'yarramate/core@0.1#influence',
              'yarramate/core@0.1#association',
            ],
            direction: 'any',
          },
        ]),
      ),
    ).toMatchObject({
      kind: 'connect',
      label: 'Connect what it influences or is associated with…',
      direction: 'outgoing',
    })
  })

  it('treats a missing linkage like a missing relationship', () => {
    // goal-no-driver carries counterpart kinds too; the verb keeps the
    // relationship kinds and the direction, and lets the table do the rest.
    expect(
      verbFor(
        row([
          {
            condition: 'missing-linkage',
            kinds: ['yarramate/core@0.1#influence'],
            direction: 'incoming',
            counterpartKinds: ['yarramate/core@0.1#driver'],
          } as CatalogueCondition,
        ]),
      ),
    ).toMatchObject({ kind: 'connect', direction: 'incoming', label: 'Connect what influences it…' })
  })

  it('names a profile kind as it is when the core has no reading for it', () => {
    expect(
      verbFor(
        row([
          {
            condition: 'missing-relationship',
            kinds: ['yarramate/policy@0.1#binds'],
            direction: 'outgoing',
          },
        ]),
      ),
    ).toMatchObject({ label: 'Connect what it binds…' })
  })

  it('connects an isolated subject to anything the table permits', () => {
    expect(verbFor(row([{ condition: 'isolated' }]))).toEqual({
      kind: 'connect',
      label: 'Connect it to something…',
      kinds: [],
      direction: 'outgoing',
    })
  })

  it('adds a subject of the first kind the question names, article and all', () => {
    // outcome-missing names goal then outcome.
    expect(
      verbFor(
        row(
          [
            {
              condition: 'no-subject-of-kind',
              kinds: ['yarramate/core@0.1#goal', 'yarramate/core@0.1#outcome'],
            },
          ],
          'workspace',
        ),
      ),
    ).toEqual({ kind: 'add', label: 'Add a goal…', subjectKind: 'goal' })
    expect(
      verbFor(
        row([{ condition: 'no-subject-of-kind', kinds: ['yarramate/core@0.1#outcome'] }], 'workspace'),
      ),
    ).toMatchObject({ label: 'Add an outcome…' })
  })

  it('opens the properties for a field-shaped question on a subject, and nothing for one on the workspace', () => {
    const owner: CatalogueCondition = {
      condition: 'missing-claim',
      predicate: 'yarramate/ownership/owner',
    }
    expect(verbFor(row([owner]))).toEqual({
      kind: 'describe',
      label: 'Fill it in under properties…',
    })
    expect(verbFor(row([owner], 'workspace'))).toBeNull()
    for (const condition of [
      { condition: 'missing-reference', predicate: 'yarramate/reference/refers-to', direction: 'outgoing' },
      { condition: 'missing-constraint', kinds: ['yarramate/policy@0.1#mechanism-constraint'] },
      { condition: 'missing-attestation', topic: 'adequacy' },
      { condition: 'missing-part' },
    ] as readonly CatalogueCondition[]) {
      expect(verbFor(row([condition])), condition.condition).toMatchObject({ kind: 'describe' })
    }
  })

  it('offers nothing for a question no gesture answers', () => {
    for (const condition of [
      { condition: 'near-duplicate' },
      { condition: 'no-state-defined' },
      { condition: 'unconstrained-kind' },
      { condition: 'unscoped-succession' },
      { condition: 'unchallenged-evidence' },
      { condition: 'missing-flow-content' },
      { condition: 'has-subject-of-kind', kinds: ['yarramate/core@0.1#goal'] },
    ] as readonly CatalogueCondition[]) {
      expect(verbFor(row([condition])), condition.condition).toBeNull()
    }
    expect(verbFor(row(undefined))).toBeNull()
    expect(verbFor(row([]))).toBeNull()
  })

  it('takes the first condition a gesture answers, not the first condition', () => {
    expect(
      verbFor(
        row([
          { condition: 'near-duplicate' },
          { condition: 'isolated' },
        ]),
      ),
    ).toMatchObject({ kind: 'connect' })
  })

  // #515, ADR 0151: what leaves the pane for an assistant that is elsewhere.
  describe('assistantBrief', () => {
    it('carries the question, why it matters, what closes it, and a skeleton with the subject on the right end for an incoming question', () => {
      const brief = assistantBrief(
        {
          ...row([
            {
              condition: 'missing-relationship',
              kinds: ['yarramate/core@0.1#realization'],
              direction: 'incoming',
            },
          ]),
          question: 'What realizes Bill from actual reads?',
          materiality: 'A goal nothing realizes is a wish.',
          resolution: 'Relate a requirement or a capability to it.',
        },
        { id: 'bill-from-actual-reads', name: 'Bill from actual reads' },
      )
      expect(brief).toContain('Question: What realizes Bill from actual reads?')
      expect(brief).toContain('About: Bill from actual reads (bill-from-actual-reads)')
      expect(brief).toContain('Why it matters: A goal nothing realizes is a wish.')
      expect(brief).toContain('What closes it: Relate a requirement or a capability to it.')
      expect(brief).toContain('format: yarramate/operations/v1')
      expect(brief).toContain('op: add-relationship')
      expect(brief).toContain('kind: realization')
      expect(brief).toContain('to: bill-from-actual-reads')
      expect(brief).toContain('from: <the other subject>')
    })

    it('asks for a concept of the named kind on a workspace question, and for nothing it cannot shape', () => {
      const add = assistantBrief(
        row([{ condition: 'no-subject-of-kind', kinds: ['yarramate/core@0.1#outcome'] }], 'workspace'),
        null,
      )
      expect(add).toContain('op: add-concept')
      expect(add).toContain('kind: outcome')
      expect(add).not.toContain('About:')
      const plain = assistantBrief(row([{ condition: 'near-duplicate' }]), null)
      expect(plain).toContain('Question: A question')
      expect(plain).not.toContain('operations/v1')
      expect(plain).toContain('does not apply')
    })
  })
})
