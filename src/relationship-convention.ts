import {
  conceptKinds,
  type Aspect,
  type Layer,
  type RelationshipKind,
} from './profile.js'
import {
  isCoreConceptKindId,
  permittedRelationshipKinds,
  type CoreConceptKindId,
} from './relationship-matrix.js'

/**
 * The relationship kind ArchiMate practice expects for a pair of core kinds,
 * where practice has an expectation at all (#571).
 *
 * The relationship table is a PERMISSION table. It answers "may I draw this",
 * and for an application component pointing at an application function it
 * answers yes six times. Practice is much narrower: across this repository's
 * own model and the ApertureX reference, 970 relationships over 72 core-kind
 * pairs, the author used exactly one kind for 34 of the pairs the table lets
 * them choose among, and used `assignment` for that particular pair 87 times
 * out of 88. The engine knew the permission and never said the convention, so
 * every palette offered six, every agent guessed, and a reviewer could never
 * be told "this pair is usually X and yours is Y".
 *
 * ## Where these answers come from
 *
 * They are read off ArchiMate's own definitions of the relationships, NOT
 * fitted to the two records. That direction matters. Both records agree, for
 * instance, that a business actor points at a constraint with `association`,
 * 87 times out of 87 - but that is one adopter's house convention for
 * recording sign-off, not a rule of the language, and blessing it here would
 * have told every other adopter their own style was wrong. The records are
 * used as a CHECK: `test/relationship-convention.test.ts` asserts that every
 * convention declared here matches real practice on a record that has enough
 * of that pair to have a habit, and prints the disagreements when it does not.
 *
 * ## Silence is an answer
 *
 * `conventionalRelationshipKind` returns `null` far more often than not, and
 * that is the point. A pair with no entry here is a pair where the language
 * genuinely permits several readings and the author must choose: an artifact
 * pointing at an application function is `realization` 41 times and
 * `association` 16, a capability pointing at a goal splits evenly, and two
 * application functions relate by composition, triggering, flow or serving
 * depending on what the author means. Declaring a convention there would
 * manufacture confidence the language does not have.
 *
 * Nothing here is a rule the compiler enforces. A permitted kind stays
 * permitted; `check` never reads this file. It is guidance, offered to a
 * palette, an agent, or a reviewer, and it says nothing when it has nothing
 * to say.
 */

const KIND_META = new Map<string, { readonly layer: Layer; readonly aspect: Aspect }>(
  conceptKinds.map((kind) => [kind.id, { layer: kind.layer, aspect: kind.aspect }]),
)

/** The three service elements: external behaviour a layer offers outward. */
const SERVICES: ReadonlySet<string> = new Set([
  'businessService',
  'applicationService',
  'technologyService',
])

/** The three interface elements: the point at which a service is offered. */
const INTERFACES: ReadonlySet<string> = new Set([
  'businessInterface',
  'applicationInterface',
  'technologyInterface',
])

const isService = (kind: string): boolean => SERVICES.has(kind)
const isInterface = (kind: string): boolean => INTERFACES.has(kind)
const isInternalBehaviour = (kind: string): boolean =>
  KIND_META.get(kind)?.aspect === 'behavior' && !isService(kind)

/**
 * One convention, as a named rule. The name is carried into the answer so a
 * caller can say WHY, which is the difference between guidance a reviewer can
 * argue with and a number they have to take on faith.
 */
export interface RelationshipConvention {
  readonly kind: RelationshipKind
  readonly rule: string
  readonly because: string
}

type Rule = {
  readonly name: string
  readonly because: string
  readonly kind: RelationshipKind
  readonly when: (
    from: CoreConceptKindId,
    to: CoreConceptKindId,
    fromMeta: { layer: Layer; aspect: Aspect },
    toMeta: { layer: Layer; aspect: Aspect },
  ) => boolean
}

/**
 * Ordered; the first rule that matches answers, and order is load-bearing
 * twice. A service touching passive structure is `access` before it is
 * anything else, because a service is behaviour first and an offering second.
 * And an interface pointing at a service of its own layer is `assignment`,
 * the interface exposing that service, while an interface pointing at
 * anything else is `serving`. Both times the specific rule comes first.
 */
const RULES: readonly Rule[] = [
  {
    name: 'behaviour-uses-data',
    because: 'behaviour reads, writes or creates the passive structure it touches',
    kind: 'access',
    when: (from, to, f, t) =>
      t.aspect === 'passive-structure' &&
      (isInternalBehaviour(from) || isService(from)) &&
      // An artifact is passive structure in the technology layer, and
      // behaviour pointing at one is not "reading a file": both records write
      // `association` there far more often than `access`. Left to the author.
      to !== 'artifact',
  },
  {
    name: 'interface-exposes-service',
    because:
      'an interface is assigned to the service it exposes, not to the behaviour that uses it',
    kind: 'assignment',
    when: (from, to, f, t) =>
      isInterface(from) && isService(to) && f.layer === t.layer,
  },
  {
    name: 'service-is-offered-outward',
    because: 'a service is made available to whoever uses it',
    kind: 'serving',
    when: (from, _to, _f, t) =>
      (isService(from) || isInterface(from)) &&
      (t.aspect === 'active-structure' || t.aspect === 'behavior'),
  },
  {
    name: 'grouping-collects-members',
    because: 'a grouping aggregates what it collects; the members exist without it',
    kind: 'aggregation',
    when: (from) => from === 'grouping',
  },
  {
    name: 'artifact-realizes-what-it-implements',
    because:
      'an artifact is the concrete file or deployable that fulfils the thing it stands for',
    kind: 'realization',
    when: (from, to, _f, t) =>
      from === 'artifact' &&
      (t.aspect === 'active-structure' || t.aspect === 'passive-structure') &&
      to !== 'artifact',
  },
  {
    name: 'active-structure-performs-behaviour',
    because:
      'an active structure element is assigned to the internal behaviour it performs',
    kind: 'assignment',
    when: (from, to, f, t) =>
      f.aspect === 'active-structure' &&
      isInternalBehaviour(to) &&
      f.layer === t.layer,
  },
  {
    name: 'internal-realizes-service',
    because:
      'the internal element is the concrete thing that fulfils the service its layer offers',
    kind: 'realization',
    when: (from, to, f, t) =>
      isService(to) &&
      f.layer === t.layer &&
      (f.aspect === 'active-structure' || isInternalBehaviour(from)) &&
      !isInterface(from),
  },
  {
    name: 'technology-serves-application',
    // The least certain rule here. The authoring reference lists this pair as
    // "realizes or serves", two readings: realization when the node IS the
    // implementation, serving when it hosts one. Both records are unanimous
    // for `serving`, ten times in ten, so that is what is offered - and the
    // other reading stays one click away, as every non-conventional kind does.
    because:
      'a technology element is not part of the application it runs; it serves it',
    kind: 'serving',
    when: (_from, _to, f, t) =>
      f.layer === 'technology' &&
      t.layer === 'application' &&
      (t.aspect === 'active-structure' || t.aspect === 'behavior'),
  },
]

const cache = new Map<string, RelationshipConvention | null>()

/**
 * The kind practice expects from `from` to `to`, or `null` where practice has
 * no expectation.
 *
 * Never contradicts the table: an answer is returned only when the table also
 * permits it, so guidance can never point at an edge `check` would refuse.
 */
export const conventionalRelationshipKind = (
  from: string,
  to: string,
): RelationshipConvention | null => {
  const key = `${from}>${to}`
  const cached = cache.get(key)
  if (cached !== undefined) return cached
  const answer = compute(from, to)
  cache.set(key, answer)
  return answer
}

const compute = (from: string, to: string): RelationshipConvention | null => {
  if (!isCoreConceptKindId(from) || !isCoreConceptKindId(to)) return null
  const fromMeta = KIND_META.get(from)
  const toMeta = KIND_META.get(to)
  if (fromMeta === undefined || toMeta === undefined) return null
  for (const rule of RULES) {
    if (!rule.when(from, to, fromMeta, toMeta)) continue
    // Guidance that the table forbids would be worse than none: it would send
    // an author at an edge `check` refuses. A rule that lands outside the
    // permission is treated as having no answer for this pair.
    if (!permittedRelationshipKinds(from, to).has(rule.kind)) return null
    return { kind: rule.kind, rule: rule.name, because: rule.because }
  }
  return null
}

/** Every rule's name and sentence, for documentation and for the test that checks them. */
export const CONVENTION_RULES: readonly { readonly name: string; readonly kind: RelationshipKind; readonly because: string }[] =
  RULES.map(({ name, kind, because }) => ({ name, kind, because }))
