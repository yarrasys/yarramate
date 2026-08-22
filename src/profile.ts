export const layers = [
  'motivation',
  'strategy',
  'business',
  'application',
  'technology',
  'physical',
  'implementation',
  'composite',
] as const

export const aspects = [
  'motivation',
  'active-structure',
  'behavior',
  'passive-structure',
  'composite',
] as const

export type Layer = (typeof layers)[number]
export type Aspect = (typeof aspects)[number]

/**
 * OntoClean rigidity, the one meta-property with a mechanical consequence.
 * A kind is `rigid` when being of that kind is essential to every instance
 * (a thing IS an application component); `anti-rigid` when it is essential
 * to none (a role is played contingently and can be given up). Identity and
 * unity are deliberately out of scope: neither yields a check (ADR 0078).
 */
export const rigidities = ['rigid', 'anti-rigid'] as const

export type Rigidity = (typeof rigidities)[number]

export interface ConceptKind {
  readonly id: string
  readonly name: string
  readonly layer: Layer
  readonly aspect: Aspect
  /**
   * Optional and opt-in. An unannotated kind constrains nothing, in either
   * direction. Annotated, it feeds one rule: a rigid kind may not specialize
   * an anti-rigid one, anywhere in its lineage (YM413).
   */
  readonly rigidity?: Rigidity
  /**
   * The ArchiMate 3.2 element this kind implements, kept as data so a
   * profile author can read the mapping off the kind itself.
   */
  readonly inspiredBy: string
}

const kind = (
  layer: Layer,
  aspect: Aspect,
  entries: ReadonlyArray<
    readonly [id: string, name: string, rigidity?: Rigidity]
  >,
): ConceptKind[] =>
  entries.map(([id, name, rigidity]) => ({
    id,
    name,
    layer,
    aspect,
    ...(rigidity === undefined ? {} : { rigidity }),
    inspiredBy: `archimate:${name}`,
  }))

export const conceptKinds: readonly ConceptKind[] = [
  ...kind('motivation', 'motivation', [
    // "Represents the role of an individual, team, or organization": a
    // stakeholder is a stance held towards one architecture, not a kind of
    // thing anything essentially is.
    ['stakeholder', 'Stakeholder', 'anti-rigid'],
    ['driver', 'Driver'],
    ['assessment', 'Assessment'],
    ['goal', 'Goal'],
    ['outcome', 'Outcome'],
    ['principle', 'Principle'],
    ['requirement', 'Requirement'],
    ['constraint', 'Constraint'],
    ['meaning', 'Meaning'],
    ['value', 'Value'],
  ]),
  ...kind('strategy', 'active-structure', [['resource', 'Resource']]),
  ...kind('strategy', 'behavior', [
    ['capability', 'Capability'],
    ['valueStream', 'Value stream'],
    ['courseOfAction', 'Course of action'],
  ]),
  ...kind('business', 'active-structure', [
    ['businessActor', 'Business actor'],
    // A role is a responsibility an actor is assigned and can be released
    // from. Nothing is essentially a role, which is the whole point of
    // separating it from the actor that plays it.
    ['businessRole', 'Business role', 'anti-rigid'],
    // A collaboration is an aggregate of active structure elements formed to
    // perform collective behavior, and it dissolves when they stop.
    ['businessCollaboration', 'Business collaboration', 'anti-rigid'],
    ['businessInterface', 'Business interface'],
  ]),
  ...kind('business', 'behavior', [
    ['businessProcess', 'Business process'],
    ['businessFunction', 'Business function'],
    ['businessInteraction', 'Business interaction'],
    ['businessEvent', 'Business event'],
    ['businessService', 'Business service'],
  ]),
  ...kind('business', 'passive-structure', [
    ['businessObject', 'Business object'],
    ['contract', 'Contract'],
    ['representation', 'Representation'],
  ]),
  // A product aggregates services, objects, and a contract: ArchiMate
  // classes it as a composite element, not as passive structure.
  ...kind('business', 'composite', [['product', 'Product']]),
  ...kind('application', 'active-structure', [
    ['applicationComponent', 'Application component'],
    ['applicationCollaboration', 'Application collaboration', 'anti-rigid'],
    ['applicationInterface', 'Application interface'],
  ]),
  ...kind('application', 'behavior', [
    ['applicationFunction', 'Application function'],
    ['applicationInteraction', 'Application interaction'],
    ['applicationProcess', 'Application process'],
    ['applicationEvent', 'Application event'],
    ['applicationService', 'Application service'],
  ]),
  ...kind('application', 'passive-structure', [['dataObject', 'Data object']]),
  ...kind('technology', 'active-structure', [
    ['node', 'Node'],
    ['device', 'Device'],
    ['systemSoftware', 'System software'],
    ['technologyCollaboration', 'Technology collaboration', 'anti-rigid'],
    ['technologyInterface', 'Technology interface'],
    ['path', 'Path'],
    ['communicationNetwork', 'Communication network'],
  ]),
  ...kind('technology', 'behavior', [
    ['technologyFunction', 'Technology function'],
    ['technologyProcess', 'Technology process'],
    ['technologyInteraction', 'Technology interaction'],
    ['technologyEvent', 'Technology event'],
    ['technologyService', 'Technology service'],
  ]),
  ...kind('technology', 'passive-structure', [['artifact', 'Artifact']]),
  ...kind('physical', 'active-structure', [
    ['equipment', 'Equipment'],
    ['facility', 'Facility'],
    ['distributionNetwork', 'Distribution network'],
  ]),
  ...kind('physical', 'passive-structure', [['material', 'Material']]),
  ...kind('implementation', 'behavior', [
    ['workPackage', 'Work package'],
    ['implementationEvent', 'Implementation event'],
  ]),
  ...kind('implementation', 'passive-structure', [
    ['deliverable', 'Deliverable'],
  ]),
  // A plateau aggregates any core element and a gap is associated with the
  // plateaus it separates: neither is passive structure in ArchiMate.
  ...kind('implementation', 'composite', [
    ['plateau', 'Plateau'],
    ['gap', 'Gap'],
  ]),
  ...kind('composite', 'composite', [
    ['grouping', 'Grouping'],
    ['location', 'Location'],
    ['andJunction', 'AND junction'],
    ['orJunction', 'OR junction'],
  ]),
]

export const relationshipKinds = [
  'composition',
  'aggregation',
  'assignment',
  'realization',
  'serving',
  'access',
  'influence',
  'association',
  'triggering',
  'flow',
  'specialization',
] as const

export type RelationshipKind = (typeof relationshipKinds)[number]

export interface RelationshipPolicy {
  readonly id: RelationshipKind
  /** Documentary. Which endpoint pairs a kind may join is decided by the relationship table, not by prose. */
  readonly intent: string
}

/**
 * The eleven core relationship kinds. Which (source kind, target kind) pairs
 * each may join is the ArchiMate 3.2 relationship table, vendored under
 * `vendor/archi` and decoded by `relationship-matrix.ts` (ADR 0097). An
 * extension profile may narrow its own relationship kind further with
 * `sourceAspects`/`targetAspects`; the core kinds carry no narrowing of
 * their own because the table already says everything there is to say.
 */
export const relationshipPolicies: readonly RelationshipPolicy[] = [
  { id: 'composition', intent: 'Strong whole-part structure' },
  { id: 'aggregation', intent: 'Weak whole-part structure' },
  {
    id: 'assignment',
    intent: 'Allocate an active structure to behavior or responsibility',
  },
  { id: 'realization', intent: 'Fulfil a more abstract concept' },
  { id: 'serving', intent: 'Make behavior or an interface available' },
  { id: 'access', intent: 'Read, write, create, or use passive structure' },
  { id: 'influence', intent: 'Affect a motivation concept' },
  { id: 'association', intent: 'Relevant connection with no stronger meaning' },
  { id: 'triggering', intent: 'Express temporal or causal precedence' },
  { id: 'flow', intent: 'Transfer information, value, goods, or material' },
  { id: 'specialization', intent: 'Express a more specific form' },
]
