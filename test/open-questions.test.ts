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
  extra: {
    readonly readOnly?: boolean
    readonly onVerb?: () => void
    readonly onDelegate?: () => void
    readonly delegateLabel?: string
  } = {},
): string =>
  renderToStaticMarkup(
    createElement(OpenQuestions, { overlay, selectedId, ...extra }),
  )

describe('OpenQuestions', () => {
  /**
   * The row the interview would serve first wears a tag (#534): the overlay
   * names it, the list only marks it, in the scope it is open for.
   */
  it('tags the next question in the scope it is open for', () => {
    const workspaceNext: VisualInterrogationOverlay = {
      ...overlay,
      next: { ...overlay.workspace[0]!, wave: 'motivation' },
    }
    const whole = renderToStaticMarkup(
      createElement(OpenQuestions, { overlay: workspaceNext, selectedId: null }),
    )
    expect(whole).toContain('question-row-next')
    expect(whole).toContain('>next<')
    const teller = renderToStaticMarkup(
      createElement(OpenQuestions, { overlay: workspaceNext, selectedId: 'teller' }),
    )
    expect(teller).not.toContain('question-row-next')

    const subjectNext: VisualInterrogationOverlay = {
      ...overlay,
      next: { ...overlay.subjects['teller']![0]!, wave: 'motivation', subjectId: 'teller', subjectName: 'Teller' },
    }
    const tagged = renderToStaticMarkup(
      createElement(OpenQuestions, { overlay: subjectNext, selectedId: 'teller' }),
    )
    expect(tagged.split('question-row-next').length - 1).toBe(1)
    expect(tagged.indexOf('question-row-next')).toBeLessThan(tagged.indexOf('Who is accountable for Teller?'))
    expect(render(null)).not.toContain('question-row-next')
  })

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

  // #515, ADR 0151: the second door on every row, labelled by the host.
  it('offers the delegate door with the label the host gave it', () => {
    expect(render('teller', { onDelegate: () => undefined })).toContain('Answer via agent')
    expect(render('teller', { onDelegate: () => undefined, delegateLabel: 'Copy for my assistant' })).toContain(
      'Copy for my assistant',
    )
    // Every row gets it, trigger or not: delegating needs no answer shape.
    expect(render('teller', { onDelegate: () => undefined }).match(/question-verb-delegate/g)?.length).toBe(2)
    expect(render('teller', { readOnly: true, onDelegate: () => undefined })).not.toContain('question-verb-delegate')
    expect(render('teller')).not.toContain('question-verb-delegate')
  })
})
