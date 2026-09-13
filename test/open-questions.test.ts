import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { OpenQuestions } from '../src/visual-app/open-questions.js'
import type { VisualInterrogationOverlay } from '../src/adapters/visual/wire.js'

/**
 * The question panel's two scopes (#292): a selected element shows the
 * questions that name it; no selection shows the workspace-scoped ones,
 * which name no subject and would otherwise render nowhere.
 */

const overlay: VisualInterrogationOverlay = {
  catalogue: 'fixture@1.0',
  semantics: '1',
  workspace: [
    {
      questionId: 'goal-missing',
      question: 'What outcome justifies this system?',
      authority: 'human',
    },
  ],
  subjects: {
    teller: [
      {
        questionId: 'actor-owner-missing',
        question: 'Who is accountable for Teller?',
        authority: 'human',
        since: '0.7',
        scope: 'subject',
        materiality: 'An unowned actor has nobody to answer for it.',
        trigger: [
          { condition: 'missing-claim', predicate: 'yarramate/ownership/owner' },
        ],
      },
      {
        questionId: 'actor-unassigned',
        question: 'What behavior is Teller assigned to?',
        authority: 'either',
      },
    ],
  },
}

const render = (
  selectedId: string | null,
  extra: { readonly readOnly?: boolean; readonly onVerb?: () => void } = {},
): string =>
  renderToStaticMarkup(
    createElement(OpenQuestions, { overlay, selectedId, ...extra }),
  )

describe('OpenQuestions', () => {
  it('shows the workspace-scoped questions when nothing is selected', () => {
    const html = render(null)
    expect(html).toContain('What outcome justifies this system?')
    expect(html).not.toContain('Who is accountable for Teller?')
    expect(html).toContain('Select a subject')
  })

  it('scopes to the selected subject, with authority and since', () => {
    const html = render('teller')
    expect(html).toContain('Who is accountable for Teller?')
    expect(html).toContain('What behavior is Teller assigned to?')
    expect(html).not.toContain('What outcome justifies this system?')
    expect(html).toContain('question-authority-human')
    expect(html).toContain('since 0.7')
  })

  it('says plainly when a selected subject has nothing open', () => {
    const html = render('checkout')
    expect(html).toContain('No open questions name this subject.')
  })

  it('names the catalogue and keeps the answer path out of the panel', () => {
    const html = render(null)
    expect(html).toContain('Catalogue fixture@1.0')
    // Read-only by design: answers land through the changeset, so the panel
    // renders no input of its own.
    expect(html).not.toContain('<input')
    expect(html).not.toContain('<textarea')
  })

  // #515, ADR 0150: a row with a trigger offers the verb that would answer
  // it, and the materiality rides as the question's title.
  it('offers a verb from the trigger, with the materiality as the title', () => {
    const html = render('teller', { onVerb: () => undefined })
    expect(html).toContain('Fill it in under properties…')
    expect(html).toContain('question-verb-describe')
    expect(html).toContain('title="An unowned actor has nobody to answer for it."')
    // The row without a trigger keeps reading as a question and nothing more.
    expect(html.match(/question-verb-/g)?.length).toBe(1)
  })

  it('offers no verb to a viewer, or to a host that passed no way to run one', () => {
    expect(render('teller', { readOnly: true, onVerb: () => undefined })).not.toContain('question-verb')
    expect(render('teller')).not.toContain('question-verb')
  })
})
