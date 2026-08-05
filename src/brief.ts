import type {
  GraphClaim,
  ResolvedProfileContext,
} from './compiler.js'
import { conceptKinds } from './profile.js'
import type { ProjectionResult } from './projection.js'

const coreKindNames = new Map(
  conceptKinds.map(({ id, name }) => [id, name]),
)
const motivationKindIds = new Set(
  conceptKinds
    .filter(({ layer }) => layer === 'motivation')
    .map(({ id }) => id),
)

const claimValue = (
  claims: readonly GraphClaim[],
  subject: string,
  predicate: string,
): string | undefined => {
  const object = claims.find(
    (claim) => claim.subject === subject && claim.predicate === predicate,
  )?.object
  return object !== undefined && 'value' in object ? object.value : undefined
}

const claimReferences = (
  claims: readonly GraphClaim[],
  subject: string,
  predicate: string,
): readonly string[] =>
  claims.flatMap((claim) =>
    claim.subject === subject &&
    claim.predicate === predicate &&
    'ref' in claim.object
      ? [claim.object.ref]
      : [],
  )

// Resolve a qualified kind to its nearest core-profile local id through
// declared lineage, mirroring how `next` orients relationships (ADR 0048).
// Exported so ask's neighbour cap ranks neighbours by the same reading
// the brief ranks paragraphs with (ADR 0070).
export const coreLocalKind = (
  kind: string,
  lineages: ReadonlyMap<string, readonly string[]> | undefined,
): string | undefined => {
  for (const candidate of [kind, ...(lineages?.get(kind) ?? [])]) {
    const separator = candidate.indexOf('#')
    if (separator !== -1 && candidate.startsWith('yarramate/core@')) {
      return candidate.slice(separator + 1)
    }
  }
  return undefined
}

// First-class non-goals (ADR 0073): the convention is a goal, outcome,
// or requirement carrying `status: retired` with its rationale in the
// description. That record is the declared non-goal; no dedicated status
// value exists. Principles and constraints are deliberately outside the
// set: retiring one lifts a rule rather than declining scope. Both
// stakeholder renderers (projection markdown and the brief) share this
// predicate. Projection membership is not consulted here: a projection
// whose excludeStatuses drops retired subjects has already kept them out
// of the result, so nothing reaches the renderers to present.
const nonGoalKindIds = new Set(['goal', 'outcome', 'requirement'])

export const isDeclaredNonGoal = (
  kind: string | undefined,
  status: string | undefined,
  lineages: ReadonlyMap<string, readonly string[]> | undefined,
): boolean => {
  if (status !== 'retired' || kind === undefined) return false
  const core = coreLocalKind(kind, lineages)
  return core !== undefined && nonGoalKindIds.has(core)
}

const humanizeKind = (kind: string): string => {
  const local = kind.slice(kind.indexOf('#') + 1)
  return local
    .replaceAll(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replaceAll('-', ' ')
    .toLowerCase()
}

const article = (reading: string): string =>
  /^[aeiou]/.test(reading) ? 'an' : 'a'

const sentenceEnd = (text: string): string =>
  /[.!?]["')\]]*$/.test(text.trimEnd()) ? text.trimEnd() : `${text.trimEnd()}.`

const listPhrase = (items: readonly string[]): string =>
  items.length <= 1
    ? (items[0] ?? '')
    : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`

// Phrase forms are the prose readings of each core relationship kind's
// declared intent — the same table `next` reads for ordering, spoken
// from the source's perspective.
const relationshipPhrase = (
  coreKind: string | undefined,
  fallbackKind: string,
  mode: string | undefined,
  content: string | undefined,
): string => {
  switch (coreKind) {
    case 'serving':
      return 'serves'
    case 'access':
      return mode === 'read'
        ? 'reads'
        : mode === 'write'
          ? 'writes'
          : mode === 'read-write'
            ? 'reads and writes'
            : 'accesses'
    case 'realization':
      return 'realizes'
    case 'composition':
      return 'comprises'
    case 'aggregation':
      return 'aggregates'
    case 'assignment':
      return 'is assigned to'
    case 'triggering':
      return 'triggers'
    case 'flow':
      return content === undefined ? 'flows to' : `sends ${content} to`
    case 'specialization':
      return 'specializes'
    case 'influence':
      return 'influences'
    case 'association':
      return 'is associated with'
    default:
      return humanizeKind(fallbackKind)
  }
}

interface BriefRelationship {
  readonly phrase: string
  readonly target: string
  readonly description?: string
}

interface BriefParagraph {
  readonly text: string
  readonly rank: number
}

const estimateTokens = (text: string): number => Math.ceil(text.length / 4)

export function renderBrief(
  result: ProjectionResult,
  profileContext?: ResolvedProfileContext,
  budgetTokens?: number,
  // A succession claim belongs to the successor (ADR 0080), so the claim
  // that answers "where did this go?" about a slice's subject usually sits
  // on a subject the slice does not contain. Passing the workspace's claims
  // lets the brief name that successor by id without pulling it into the
  // slice, which would spend the neighbourhood cap of ADR 0070 on history.
  workspaceClaims?: readonly GraphClaim[],
): string {
  const stateIds = new Set(
    result.claims
      .filter(({ predicate }) => predicate === 'yarramate/state/type')
      .map(({ subject }) => subject),
  )
  const concepts = result.subjects.filter(
    ({ id, type }) => type === 'concept' && !stateIds.has(id),
  )
  const nameOf = (id: string): string =>
    claimValue(result.claims, id, 'yarramate/concept/name') ?? id
  const kindOf = (id: string): string | undefined =>
    claimValue(result.claims, id, 'yarramate/concept/kind')
  const statusOf = (id: string): string | undefined =>
    claimValue(result.claims, id, 'yarramate/lifecycle/status')
  const descriptionOf = (id: string): string | undefined =>
    claimValue(result.claims, id, 'yarramate/concept/description')
  const kindReading = (kind: string): string => {
    const core = coreLocalKind(kind, profileContext?.conceptKindLineages)
    const coreName = core === undefined ? undefined : coreKindNames.get(core)
    return kind.startsWith('yarramate/core@') && coreName !== undefined
      ? coreName.toLowerCase()
      : humanizeKind(kind)
  }
  const isMotivation = (id: string): boolean => {
    const kind = kindOf(id)
    if (kind === undefined) return false
    const core = coreLocalKind(kind, profileContext?.conceptKindLineages)
    return core !== undefined && motivationKindIds.has(core)
  }

  const outgoing = new Map<string, BriefRelationship[]>()
  for (const subject of result.subjects) {
    if (subject.type !== 'relationship') continue
    const claim = result.claims.find(
      ({ id, object }) => id === subject.id && 'ref' in object,
    )
    if (claim === undefined || !('ref' in claim.object)) continue
    const description = claimValue(
      result.claims,
      subject.id,
      'yarramate/relationship/description',
    )
    const entry: BriefRelationship = {
      phrase: relationshipPhrase(
        coreLocalKind(
          claim.predicate,
          profileContext?.relationshipKindLineages,
        ),
        claim.predicate,
        claimValue(result.claims, subject.id, 'yarramate/access/mode'),
        claimValue(result.claims, subject.id, 'yarramate/flow/content'),
      ),
      target: claim.object.ref,
      ...(description === undefined ? {} : { description }),
    }
    outgoing.set(claim.subject, [
      ...(outgoing.get(claim.subject) ?? []),
      entry,
    ])
  }

  const relationshipSentences = (id: string): readonly string[] => {
    const entries = outgoing.get(id) ?? []
    const grouped = new Map<string, string[]>()
    const sentences: string[] = []
    for (const entry of entries) {
      const target = `"${nameOf(entry.target)}"`
      if (entry.description !== undefined) {
        sentences.push(
          `It ${entry.phrase} ${target} (${entry.description}).`,
        )
        continue
      }
      grouped.set(entry.phrase, [...(grouped.get(entry.phrase) ?? []), target])
    }
    return [
      ...[...grouped].map(
        ([phrase, targets]) => `It ${phrase} ${listPhrase(targets)}.`,
      ),
      ...sentences,
    ]
  }

  const supportSentences = (id: string): readonly string[] => {
    const sentences: string[] = []
    const constraints = claimReferences(
      result.claims,
      id,
      'yarramate/constraint/requires',
    )
    if (constraints.length > 0) {
      sentences.push(
        `Constrained by ${listPhrase(
          constraints.map((constraint) => `"${nameOf(constraint)}"`),
        )}.`,
      )
    }
    const owner = claimReferences(
      result.claims,
      id,
      'yarramate/ownership/owner',
    )[0]
    if (owner !== undefined) {
      sentences.push(`Owned by "${nameOf(owner)}".`)
    }
    // A succession claim is authored on the successor and points back
    // (ADR 0080), but "where did this go?" is asked of the predecessor, so
    // the brief reads the same claims in both directions. This is the
    // surface that answers the question the mechanism exists for.
    const predecessors = claimReferences(
      result.claims,
      id,
      'yarramate/lineage/supersedes',
    )
    if (predecessors.length > 0) {
      sentences.push(
        `Succeeds ${listPhrase(
          predecessors.map((predecessor) => `"${nameOf(predecessor)}"`),
        )}.`,
      )
    }
    const successors = (workspaceClaims ?? result.claims).flatMap((claim) =>
      claim.predicate === 'yarramate/lineage/supersedes' &&
      'ref' in claim.object &&
      claim.object.ref === id
        ? [claim.subject]
        : [],
    )
    if (successors.length > 0) {
      sentences.push(
        `Superseded by ${listPhrase(
          successors.map((successor) => `"${nameOf(successor)}"`),
        )}.`,
      )
    }
    return sentences
  }

  const motivationParagraph = (id: string): string => {
    const kind = kindOf(id) ?? ''
    const reading = kindReading(kind)
    const label =
      reading.charAt(0).toUpperCase() + reading.slice(1)
    const description = descriptionOf(id)
    const opening =
      description === undefined
        ? `${label} "${nameOf(id)}".`
        : `${label} "${nameOf(id)}": "${description}"`
    return [sentenceEnd(opening), ...relationshipSentences(id), ...supportSentences(id)].join(
      ' ',
    )
  }

  const nonGoalParagraph = (id: string): string => {
    const kind = kindOf(id) ?? ''
    const reading = kindReading(kind)
    const label = reading.charAt(0).toUpperCase() + reading.slice(1)
    const description = descriptionOf(id)
    const opening =
      description === undefined
        ? `${label} "${nameOf(id)}" is declined.`
        : `${label} "${nameOf(id)}" is declined: "${description}"`
    return [
      sentenceEnd(opening),
      ...relationshipSentences(id),
      ...supportSentences(id),
    ].join(' ')
  }

  const workParagraph = (id: string): string => {
    const kind = kindOf(id) ?? ''
    const reading = kindReading(kind)
    const status = statusOf(id)
    const name = `"${nameOf(id)}"`
    const opening =
      status === 'planned'
        ? `You are building ${name}, ${article(reading)} ${reading}.`
        : status === 'current'
          ? `${name}, ${article(reading)} ${reading}, already exists.`
          : status === 'retired'
            ? `${name}, ${article(reading)} ${reading}, is retired.`
            : `${name} is ${article(reading)} ${reading}.`
    const description = descriptionOf(id)
    return [
      opening,
      ...(description === undefined ? [] : [sentenceEnd(description)]),
      ...relationshipSentences(id),
      ...supportSentences(id),
    ].join(' ')
  }

  // Motivation opens the brief (the interview's waves lead with why), the
  // planned work follows (it is what the reader came to do), and existing
  // context comes after; the same order ranks paragraphs under a budget.
  // Declared non-goals close the brief (ADR 0073): they tell the reader
  // what not to build, they are not the work itself, so under a budget
  // their paragraphs are the first to be omitted.
  const statusRank = (id: string): number => {
    const status = statusOf(id)
    return status === 'planned' ? 1 : status === 'retired' ? 3 : 2
  }
  const isNonGoal = (id: string): boolean =>
    isDeclaredNonGoal(
      kindOf(id),
      statusOf(id),
      profileContext?.conceptKindLineages,
    )
  const motivation = concepts.filter(
    ({ id }) => isMotivation(id) && !isNonGoal(id),
  )
  const nonGoals = concepts.filter(({ id }) => isNonGoal(id))
  const work = concepts.filter(({ id }) => !isMotivation(id))
  const paragraphs: {
    readonly heading: string
    readonly entries: readonly BriefParagraph[]
  }[] = [
    {
      heading: '## Why this exists',
      entries: motivation.map(({ id }) => ({
        text: motivationParagraph(id),
        rank: 0,
      })),
    },
    {
      heading: '## The pieces',
      entries: work
        .map(({ id }) => ({ text: workParagraph(id), rank: statusRank(id) }))
        .sort((a, b) => a.rank - b.rank),
    },
    {
      heading: '## Non-goals',
      entries: nonGoals.map(({ id }) => ({
        text: nonGoalParagraph(id),
        rank: 0,
      })),
    },
  ]

  const title = result.presentation?.title ?? result.projection
  const header: string[] = [`# ${title}`]
  if (result.presentation?.description !== undefined) {
    header.push('', result.presentation.description)
  }

  const budget = budgetTokens ?? Number.POSITIVE_INFINITY
  let spent = estimateTokens(header.join('\n'))
  let omitted = 0
  let total = 0
  const sections: string[] = []
  for (const section of paragraphs) {
    total += section.entries.length
    if (section.entries.length === 0) continue
    const kept: string[] = []
    let sectionSpent = estimateTokens(section.heading)
    for (const entry of section.entries) {
      const cost = estimateTokens(entry.text)
      if (spent + sectionSpent + cost > budget) {
        omitted += 1
        continue
      }
      kept.push(entry.text)
      sectionSpent += cost
    }
    if (kept.length > 0) {
      sections.push('', section.heading, '', kept.join('\n\n'))
      spent += sectionSpent
    }
  }
  const lines = [...header, ...sections]
  if (omitted > 0) {
    lines.push(
      '',
      `[budget ${budgetTokens}: ${omitted} of ${total} paragraphs omitted — raise --budget or use --json for the complete slice]`,
    )
  }
  return `${lines.join('\n')}\n`
}
