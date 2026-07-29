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

export interface ConceptKind {
  readonly id: string
  readonly name: string
  readonly layer: Layer
  readonly aspect: Aspect
  /**
   * A compatibility pointer, not a claim of standards conformance.
   * Exact external identifiers can be added after licensing review.
   */
  readonly inspiredBy: string
}

const kind = (
  layer: Layer,
  aspect: Aspect,
  entries: ReadonlyArray<readonly [id: string, name: string]>,
): ConceptKind[] =>
  entries.map(([id, name]) => ({
    id,
    name,
    layer,
    aspect,
    inspiredBy: `ArchiMate-inspired:${name}`,
  }))

export const conceptKinds: readonly ConceptKind[] = [
  ...kind('motivation', 'motivation', [
    ['stakeholder', 'Stakeholder'],
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
    ['businessRole', 'Business role'],
    ['businessCollaboration', 'Business collaboration'],
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
    ['product', 'Product'],
  ]),
  ...kind('application', 'active-structure', [
    ['applicationComponent', 'Application component'],
    ['applicationCollaboration', 'Application collaboration'],
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
    ['technologyCollaboration', 'Technology collaboration'],
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
  readonly intent: string
  readonly sourceAspects?: readonly Aspect[]
  readonly targetAspects?: readonly Aspect[]
  /**
   * Repair hint appended to endpoint-aspect diagnostics (YM404). A remedy,
   * never a correction: the compiler still rejects the input.
   */
  readonly repair?: string
}

/**
 * Safe, intentionally broad semantic constraints. A future licensed
 * compatibility package may layer an exact external relationship matrix over
 * these native YarraMate rules.
 */
export const relationshipPolicies: readonly RelationshipPolicy[] = [
  { id: 'composition', intent: 'Strong whole-part structure' },
  { id: 'aggregation', intent: 'Weak whole-part structure' },
  {
    id: 'assignment',
    intent: 'Allocate an active structure to behavior or responsibility',
    sourceAspects: ['active-structure'],
    repair:
      'assign from an active-structure element (an actor, component, or node), or use "association"',
  },
  { id: 'realization', intent: 'Fulfil a more abstract concept' },
  { id: 'serving', intent: 'Make behavior or an interface available' },
  {
    id: 'access',
    intent: 'Read, write, create, or use passive structure',
    targetAspects: ['passive-structure'],
    repair:
      'point "access" at passive structure (a business object, data object, or artifact), or use "association"',
  },
  {
    id: 'influence',
    intent: 'Affect a motivation concept',
    targetAspects: ['motivation'],
    repair:
      'point "influence" at a motivation concept (a goal, requirement, or principle), or use "association"',
  },
  { id: 'association', intent: 'Relevant connection with no stronger meaning' },
  {
    id: 'triggering',
    intent: 'Express temporal or causal precedence',
    sourceAspects: ['behavior'],
    targetAspects: ['behavior'],
    repair:
      'use "flow" between active-structure elements, or introduce a behavior concept and "assignment"',
  },
  { id: 'flow', intent: 'Transfer information, value, goods, or material' },
  { id: 'specialization', intent: 'Express a more specific form' },
]
