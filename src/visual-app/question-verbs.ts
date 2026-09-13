import type { CatalogueCondition } from '../interrogate-command.js'
import type { VisualQuestionEntry } from '../adapters/visual/wire.js'
import { kindLabelOf } from '../kind-label.js'

/**
 * What one gesture would answer an open question (#515).
 *
 * The catalogue declares why a question is open as typed conditions, and
 * ADR 0110 put them on the design step so a host could build the answering
 * affordance instead of re-deriving it. This is the editor's own use of that
 * shape: a question row, a menu entry and a count chip all offer the same
 * verb, and the verb is a lookup over the trigger, never a guess from the
 * phrasing. A trigger this table does not know yields no verb, and the row
 * stays what it was: a question a person reads.
 *
 * Every verb runs a gesture the surface already has - the connection tool,
 * the Add-subject form, the properties panel - so what a verb can reach is
 * exactly what a reviewer can reach by hand, and anything it stages still
 * lands through the changeset.
 */
export type QuestionVerb =
  | {
      /** Arm the connection tool from the subject, kinds narrowed to these. */
      readonly kind: 'connect'
      readonly label: string
      /** Qualified relationship kind ids the trigger names; empty = any. */
      readonly kinds: readonly string[]
      /** Which end the subject is: `outgoing` draws from it, `incoming` to it. */
      readonly direction: 'outgoing' | 'incoming'
    }
  | {
      /** Open the Add-subject form with this kind preselected. */
      readonly kind: 'add'
      readonly label: string
      /** The palette label of the first kind the trigger names. */
      readonly subjectKind: string
    }
  | {
      /** Select the subject and put the properties panel in front. */
      readonly kind: 'describe'
      readonly label: string
    }

/**
 * A relationship kind as a verb, read from the subject's side. The core
 * kinds have a reading each (ADR 0048 gave the briefs the same phrase
 * table); a profile's own kind is named as it is, which is still a sentence.
 */
const READINGS: Readonly<Record<string, { readonly out: string; readonly in: string }>> = {
  realization: { out: 'realizes', in: 'realizes it' },
  influence: { out: 'influences', in: 'influences it' },
  serving: { out: 'serves', in: 'serves it' },
  assignment: { out: 'is assigned to', in: 'is assigned to it' },
  composition: { out: 'composes', in: 'it is part of' },
  aggregation: { out: 'aggregates', in: 'it belongs to' },
  access: { out: 'accesses', in: 'accesses it' },
  flow: { out: 'flows to', in: 'flows to it' },
  triggering: { out: 'triggers', in: 'triggers it' },
  association: { out: 'is associated with', in: 'is associated with it' },
  specialization: { out: 'specializes', in: 'specializes it' },
}

const readingOf = (kind: string, direction: 'outgoing' | 'incoming'): string => {
  const label = kindLabelOf(kind)
  const reading = READINGS[label]
  if (reading === undefined) return direction === 'incoming' ? `${label} to it` : `${label}`
  return direction === 'incoming' ? reading.in : reading.out
}

const humanKinds = (
  kinds: readonly string[],
  direction: 'outgoing' | 'incoming',
): string => kinds.map((kind) => readingOf(kind, direction)).join(' or ')

/**
 * The first actionable condition decides. `opensWhen` requires every
 * condition to hold, so closing any one of them closes the question, and the
 * first the table knows is as good a door as any.
 */
export const verbFor = (entry: VisualQuestionEntry): QuestionVerb | null => {
  for (const condition of entry.trigger ?? []) {
    const verb = verbForCondition(condition, entry)
    if (verb !== null) return verb
  }
  return null
}

const verbForCondition = (
  condition: CatalogueCondition,
  entry: VisualQuestionEntry,
): QuestionVerb | null => {
  switch (condition.condition) {
    case 'missing-relationship':
    case 'missing-linkage': {
      const incoming = condition.direction === 'incoming'
      const kinds = condition.kinds
      const direction = incoming ? 'incoming' : 'outgoing'
      return {
        kind: 'connect',
        label: incoming
          ? `Connect what ${humanKinds(kinds, direction)}…`
          : `Connect what it ${humanKinds(kinds, direction)}…`,
        kinds,
        direction,
      }
    }
    case 'isolated':
      return {
        kind: 'connect',
        label: 'Connect it to something…',
        kinds: [],
        direction: 'outgoing',
      }
    case 'no-subject-of-kind': {
      const first = condition.kinds[0]
      if (first === undefined) return null
      const subjectKind = kindLabelOf(first)
      return {
        kind: 'add',
        label: `Add ${articleFor(subjectKind)} ${subjectKind}…`,
        subjectKind,
      }
    }
    case 'missing-claim':
    case 'missing-reference':
    case 'missing-constraint':
    case 'missing-attestation':
    case 'missing-part':
      // A property of the subject itself: the panel has the field, and the
      // question already says which one in its own words. Workspace-scoped
      // questions name no subject and have no panel to open.
      return entry.scope === 'workspace'
        ? null
        : { kind: 'describe', label: 'Fill it in under properties…' }
    default:
      return null
  }
}

const articleFor = (word: string): string =>
  /^[aeiou]/i.test(word) ? 'an' : 'a'

/**
 * The question, ready to paste into an assistant that is not on the socket
 * (#515, ADR 0151): claude.ai in a tab, a desktop app with no session, any
 * chat. It carries what the design step would have given an agent - the
 * phrasing, why it matters, what closes it - and the operations skeleton the
 * trigger implies, so the answer comes back as a document `apply` accepts
 * rather than as prose someone has to translate.
 */
export const assistantBrief = (
  entry: VisualQuestionEntry,
  subject: { readonly id: string; readonly name: string } | null,
): string => {
  const lines: string[] = [
    'A question from the architecture record, asked by yarramate.',
    '',
    `Question: ${entry.question}`,
  ]
  if (subject !== null) lines.push(`About: ${subject.name} (${subject.id})`)
  if (entry.materiality !== undefined) lines.push(`Why it matters: ${entry.materiality}`)
  if (entry.resolution !== undefined) lines.push(`What closes it: ${entry.resolution}`)
  const skeleton = skeletonFor(entry, subject)
  if (skeleton !== null) {
    lines.push(
      '',
      'Answer as a yarramate/operations/v1 document I can apply. The shape the question implies:',
      '',
      skeleton,
    )
  }
  lines.push(
    '',
    'If the question does not apply here, say so in one sentence instead.',
  )
  return lines.join('\n')
}

const skeletonFor = (
  entry: VisualQuestionEntry,
  subject: { readonly id: string; readonly name: string } | null,
): string | null => {
  const first = entry.trigger?.[0]
  if (first === undefined) return null
  const doc = '.yarramate/architecture/<document>.yaml'
  switch (first.condition) {
    case 'no-subject-of-kind': {
      const kind = first.kinds[0]
      if (kind === undefined) return null
      return [
        'format: yarramate/operations/v1',
        'operations:',
        '  - op: add-concept',
        `    document: ${doc}`,
        '    concept:',
        '      id: <local-id>',
        `      kind: ${kindLabelOf(kind)}`,
        '      name: <name>',
        '      description: <one sentence>',
      ].join('\n')
    }
    case 'missing-relationship':
    case 'missing-linkage': {
      if (subject === null) return null
      const kind = first.kinds[0]
      const incoming = first.direction === 'incoming'
      return [
        'format: yarramate/operations/v1',
        'operations:',
        '  - op: add-relationship',
        `    document: ${doc}`,
        '    relationship:',
        '      id: <local-id>',
        `      kind: ${kind === undefined ? '<kind>' : kindLabelOf(kind)}`,
        `      from: ${incoming ? '<the other subject>' : subject.id}`,
        `      to: ${incoming ? subject.id : '<the other subject>'}`,
      ].join('\n')
    }
    case 'missing-claim':
    case 'missing-reference':
    case 'missing-constraint':
    case 'missing-attestation':
    case 'missing-part': {
      if (subject === null) return null
      return [
        'format: yarramate/operations/v1',
        'operations:',
        '  - op: update-concept',
        `    document: ${doc}`,
        '    concept:',
        `      id: ${subject.id}`,
        '      <the field the question names>: <value>',
      ].join('\n')
    }
    default:
      return null
  }
}
