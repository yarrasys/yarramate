import { createRequire } from 'node:module'
import type Ajv2020Type from 'ajv/dist/2020.js'
import { LineCounter, parseDocument } from 'yaml'
import {
  conceptKinds,
  relationshipPolicies,
  type Aspect,
  type Layer,
  type Rigidity,
} from './profile.js'
import {
  closestCandidate,
  describeSchemaViolation,
} from './source-document.js'
import documentSchema from '../schema/yarramate-document.schema.json' with {
  type: 'json',
}
import profileSchema from '../schema/yarramate-profile.schema.json' with {
  type: 'json',
}

const coreProfile = 'yarramate/core@0.1'
// `ajv/dist/2020.js` is CJS. Its default-export shape is resolved
// differently under this repo's two tsconfigs: NodeNext (root) sees the raw
// `module.exports` (needs `.default`), Bundler+esModuleInterop
// (tsconfig.visual.json) sees the already-unwrapped class. `require()`
// sidesteps the value-level ambiguity; the type is normalized the same way.
type Ajv2020Ctor = typeof Ajv2020Type extends { default: infer D } ? D : typeof Ajv2020Type
const require = createRequire(import.meta.url)
const ajv2020Module = require('ajv/dist/2020.js') as { default?: Ajv2020Ctor } & Ajv2020Ctor
const Ajv2020 = ajv2020Module.default ?? ajv2020Module
const validateDocument = new Ajv2020({ allErrors: true }).compile(documentSchema)
const validateProfile = new Ajv2020({ allErrors: true }).compile(profileSchema)

export interface WorkspaceSource {
  readonly path: string
  readonly source: string
}

export interface Diagnostic {
  readonly severity: 'error'
  readonly code: string
  readonly message: string
  readonly path: string
  readonly pointer: string
  readonly line: number
  readonly column: number
}

interface NativeConcept {
  readonly id: string
  readonly kind: string
  readonly name: string
  readonly description?: string
  readonly aka?: readonly string[]
  readonly status?: 'planned' | 'current' | 'retired'
  readonly owner?: string
  readonly distinctFrom?: readonly string[]
  readonly supersedes?: readonly string[]
  readonly constraints?: ReadonlyArray<{
    readonly id: string
    readonly ref: string
    readonly expects?: NativeExpectedObservation
  }>
  readonly references?: readonly NativeIdentifiedReference[]
  readonly presentIn?: readonly string[]
  readonly attestations?: ReadonlyArray<{
    readonly topic: string
    readonly by: string
    readonly recordedBy?: string
    readonly on: string
  }>
}

interface NativeIdentifiedReference {
  readonly id: string
  readonly ref: string
}

interface NativeExpectedObservation {
  readonly provider: string
  readonly key: string
  readonly value: string
}

interface NativeRelationship {
  readonly id: string
  readonly kind: string
  readonly from: string
  readonly to: string
  readonly name?: string
  readonly description?: string
  readonly mode?: 'read' | 'write' | 'read-write' | 'unspecified'
  readonly content?: string
  readonly status?: 'planned' | 'current' | 'retired'
  readonly references?: readonly NativeIdentifiedReference[]
  readonly presentIn?: readonly string[]
}

interface NativeArchitectureState {
  readonly id: string
  readonly kind: 'baseline' | 'transition' | 'target'
  readonly name: string
  readonly description?: string
  readonly after?: string
}

interface NativeDocument {
  readonly format: 'yarramate/v1'
  readonly id: string
  readonly profile: string
  readonly states?: readonly NativeArchitectureState[]
  readonly concepts: readonly NativeConcept[]
  readonly relationships: readonly NativeRelationship[]
}

interface NativeProfileKind {
  readonly id: string
  readonly name: string
  readonly parent: string
}

interface NativeProfileConceptKind extends NativeProfileKind {
  readonly rigidity?: Rigidity
  readonly layer?: Layer
}

interface NativeProfileRelationshipKind extends NativeProfileKind {
  readonly sourceAspects?: readonly (typeof conceptKinds)[number]['aspect'][]
  readonly targetAspects?: readonly (typeof conceptKinds)[number]['aspect'][]
}

interface NativeProfile {
  readonly format: 'yarramate/profile/v1'
  readonly id: string
  readonly version: string
  readonly extends: string
  readonly conceptKinds: readonly NativeProfileConceptKind[]
  readonly relationshipKinds: readonly NativeProfileRelationshipKind[]
}

interface ResolvedConceptKind {
  readonly identity: string
  readonly aspect: (typeof conceptKinds)[number]['aspect']
  readonly layer: Layer
  readonly lineage: readonly string[]
  readonly rigidity?: Rigidity
}

interface ResolvedRelationshipKind {
  readonly identity: string
  readonly lineage: readonly string[]
  readonly sourceAspects?: readonly (typeof conceptKinds)[number]['aspect'][]
  readonly targetAspects?: readonly (typeof conceptKinds)[number]['aspect'][]
  readonly repair?: string
}

interface ResolvedProfile {
  readonly identity: string
  readonly lineage: readonly string[]
  readonly conceptKinds: ReadonlyMap<string, ResolvedConceptKind>
  readonly relationshipKinds: ReadonlyMap<string, ResolvedRelationshipKind>
}

export interface GraphSource {
  readonly document: string
  readonly path: string
  readonly pointer: string
  readonly line: number
  readonly column: number
}

export interface GraphClaim {
  readonly id: string
  readonly subject: string
  readonly predicate: string
  readonly object: { readonly ref: string } | { readonly value: string }
  readonly origin: 'declared'
  readonly source: GraphSource
}

export interface SemanticGraph {
  readonly format: 'yarramate/graph/v2'
  readonly profiles: readonly string[]
  readonly documents: ReadonlyArray<{
    readonly id: string
    readonly source: string
  }>
  readonly subjects: ReadonlyArray<{
    readonly id: string
    readonly type: 'concept' | 'relationship'
  }>
  readonly claims: readonly GraphClaim[]
}

// Which endpoint aspects a relationship kind pins, resolved through profile
// lineage. An absent side is the honest reading: that endpoint accepts any
// aspect, so a claim of this kind tests nothing about how its subject was
// classified (ADR 0083).
export interface RelationshipEndpointAspects {
  readonly source?: readonly Aspect[]
  readonly target?: readonly Aspect[]
}

export interface ResolvedProfileContext {
  readonly conceptKindLineages: ReadonlyMap<string, readonly string[]>
  readonly relationshipKindLineages: ReadonlyMap<string, readonly string[]>
  readonly conceptKindLayers: ReadonlyMap<string, string>
  readonly conceptKindAspects: ReadonlyMap<string, string>
  readonly relationshipKindEndpointAspects: ReadonlyMap<
    string,
    RelationshipEndpointAspects
  >
}

export type CompilationResult =
  | { readonly ok: true; readonly graph: SemanticGraph }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] }

export type ContextualCompilationResult =
  | {
      readonly ok: true
      readonly graph: SemanticGraph
      readonly profileContext: ResolvedProfileContext
    }

  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] }

/**
 * One parsed workspace source, retained by a {@link CompilationCache}. Hold it
 * and hand it back; never construct one. `value` is the composed YAML of
 * `source` and nothing else, so an entry is a pure function of its text.
 */
export interface ParsedWorkspaceSource {
  readonly source: string
  readonly kind: 'profile' | 'document'
  readonly value: unknown
  readonly schemaDiagnostics: readonly Diagnostic[]
  /**
   * Line/column already resolved for this text, keyed by YAML path. An
   * internal memo of the compiler, filled as positions are asked for; a
   * consumer that mutates it corrupts the `source` of later claims.
   */
  readonly positions: Map<string, ResolvedPosition>
}

/**
 * Opaque parse cache returned by {@link compileWorkspaceIncremental} and
 * accepted by its next call. Reuse is decided by exact source-text equality,
 * not by a caller-declared change set and not by a digest, so a stale cache
 * cannot change the compiled output - it can only fail to save work.
 */
export interface CompilationCache {
  readonly sources: ReadonlyMap<string, ParsedWorkspaceSource>
}

export type IncrementalCompilationResult = (
  | {
      readonly ok: true
      readonly graph: SemanticGraph
      readonly profileContext: ResolvedProfileContext
    }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] }
) & {
  /** False when every source had to be parsed, e.g. the first call. */
  readonly incremental: boolean
  readonly cache: CompilationCache
}

const immutableMap = <K, V>(
  entries: Iterable<readonly [K, V]>,
): ReadonlyMap<K, V> => {
  const backing = new Map(entries)
  const facade: ReadonlyMap<K, V> = {
    get: backing.get.bind(backing),
    has: backing.has.bind(backing),
    forEach(callback, thisArg) {
      backing.forEach((value, key) => callback.call(thisArg, value, key, facade))
    },
    entries: backing.entries.bind(backing),
    keys: backing.keys.bind(backing),
    values: backing.values.bind(backing),
    [Symbol.iterator]: backing[Symbol.iterator].bind(backing),
    get size() {
      return backing.size
    },
  }
  return Object.freeze(facade)
}

const compareById = <T extends { readonly id: string }>(left: T, right: T) =>
  left.id.localeCompare(right.id)

const presenceClaimId = (subject: string, state: string) =>
  `${subject}~present-in-${Buffer.from(state, 'utf8').toString('hex')}`

// Alternative labels and distinctness records are unordered sets, not
// authored lists with ids. Hex-encoding the value the way presence
// encodes its state keeps the claim id derived from content rather than
// position, so reordering the YAML leaves the graph byte-identical.
const aliasClaimId = (subject: string, alias: string) =>
  `${subject}~alias-${Buffer.from(alias, 'utf8').toString('hex')}`

const distinctFromClaimId = (subject: string, other: string) =>
  `${subject}~distinct-from-${Buffer.from(other, 'utf8').toString('hex')}`

const supersedesClaimId = (subject: string, predecessor: string) =>
  `${subject}~supersedes-${Buffer.from(predecessor, 'utf8').toString('hex')}`

export const ATTESTATION_PREDICATE_PREFIX = 'yarramate/attestation/'

// An attestation claim packs the authority, the date it was given, and
// the recorder when a machine held the pen. A reference carries no
// spaces and the date is fixed width, so the three parse back out of one
// value unambiguously wherever a reader needs them.
export const attestationClaimValue = (attestation: {
  readonly by: string
  readonly on: string
  readonly recordedBy?: string
}): string =>
  attestation.recordedBy === undefined
    ? `${attestation.by} ${attestation.on}`
    : `${attestation.by} ${attestation.on} ${attestation.recordedBy}`

export interface AttestationClaimParts {
  readonly by: string
  readonly on: string
  readonly recordedBy?: string
}

export const parseAttestationClaimValue = (
  value: string,
): AttestationClaimParts | undefined => {
  const match = /^(\S+) ([0-9]{4}-[0-9]{2}-[0-9]{2})(?: (.+))?$/.exec(value)
  if (match === null) return undefined
  const recordedBy = match[3]
  return {
    by: match[1]!,
    on: match[2]!,
    ...(recordedBy === undefined ? {} : { recordedBy }),
  }
}

export interface ConstraintExpectsParts {
  readonly provider: string
  readonly key: string
  readonly value: string
}

// Mirrors the compiler's own write-side encoding (ADR 0075): provider and
// key admit no whitespace, so the first two spaces delimit them and
// everything after the second space is the expected value verbatim, spaces
// included. This is the sole authority for decoding the value written at
// the constraint's `expects` claim — reconciliation.ts delegates here
// rather than mirroring the regex itself.
export const parseConstraintExpectsValue = (
  value: string,
): ConstraintExpectsParts | undefined => {
  const match = /^(\S+) (\S+) ([\s\S]+)$/.exec(value)
  if (match === null) return undefined
  return {
    provider: match[1]!,
    key: match[2]!,
    value: match[3]!,
  }
}

const describeAspect = (aspect: (typeof conceptKinds)[number]['aspect']) =>
  aspect.replace('-', ' ')

// Candidate order is the policy-matrix declaration order: the resolved kind
// map inserts core policies first, then extension kinds as declared.
const candidateKindHint = (
  kinds: ReadonlyMap<string, ResolvedRelationshipKind>,
  rejected: string,
  sourceAspect: (typeof conceptKinds)[number]['aspect'],
  targetAspect: (typeof conceptKinds)[number]['aspect'],
) => {
  const candidates = [...kinds]
    .filter(
      ([id, kind]) =>
        id !== rejected &&
        (kind.sourceAspects?.includes(sourceAspect) ?? true) &&
        (kind.targetAspects?.includes(targetAspect) ?? true),
    )
    .map(([id]) => id)
  if (candidates.length === 0) {
    return ''
  }
  const observed =
    sourceAspect === targetAspect
      ? `both endpoints are ${describeAspect(sourceAspect)}`
      : `source is ${describeAspect(sourceAspect)} and target is ${describeAspect(targetAspect)}`
  return `; ${observed}; valid candidates: ${candidates.join(', ')}`
}

const diagnosticFailure = (
  diagnostics: readonly Diagnostic[],
): Extract<CompilationResult, { readonly ok: false }> => ({
  ok: false,
  diagnostics: [...diagnostics].sort(
    (left, right) =>
      left.path.localeCompare(right.path) ||
      left.line - right.line ||
      left.column - right.column ||
      left.code.localeCompare(right.code) ||
      left.message.localeCompare(right.message),
  ),
})

type ParsedYaml = ReturnType<typeof parseDocument>

interface ResolvedPosition {
  readonly line: number
  readonly col: number
}

const nodePosition = (
  yaml: ParsedYaml,
  lineCounter: LineCounter,
  yamlPath: readonly (string | number)[],
): ResolvedPosition => {
  const node = yaml.getIn(yamlPath, true)
  const offset =
    typeof node === 'object' &&
    node !== null &&
    'range' in node &&
    Array.isArray(node.range)
      ? node.range[0]
      : 0
  return lineCounter.linePos(offset)
}

interface FreshParse {
  readonly yaml: ParsedYaml
  readonly lineCounter: LineCounter
}

// A position is read for every emitted claim's `source`, not only for faults,
// so a compile that re-derived them from text would parse every fresh source
// twice - measured at 282us/document against 193us/document for one parse.
// A source parsed in this call hands its composed document straight to the
// reader; a source served from cache carries the memo its earlier compile
// filled and parses only for a path never asked for before. The reader
// memoises either way, so the returned cache answers next time without the
// document - and without the memo a delta costs 95% of a full compile.
const positionReader = (
  source: string,
  positions: Map<string, ResolvedPosition>,
  fresh?: FreshParse,
) => {
  let parsed: FreshParse | undefined = fresh
  return (yamlPath: readonly (string | number)[]): ResolvedPosition => {
    // Paths mix keys and indices; a JSON key cannot confuse `['a']` with
    // `['a', 0]` the way a joined string could, and a wrong hit here would be
    // a wrong line number in compiled output rather than lost work.
    const key = JSON.stringify(yamlPath)
    const memoised = positions.get(key)
    if (memoised !== undefined) {
      return memoised
    }
    if (parsed === undefined) {
      const lineCounter = new LineCounter()
      parsed = { yaml: parseDocument(source, { lineCounter }), lineCounter }
    }
    const position = nodePosition(parsed.yaml, parsed.lineCounter, yamlPath)
    positions.set(key, position)
    return position
  }
}

// Every field of the entry is derived from `input.source` alone, which is what
// makes an entry reusable across compiles: profile membership, the composed
// value, and the faults the text carries on its own. Cross-document faults are
// never cached - they are re-derived on every compile.
const parseWorkspaceSource = (
  input: WorkspaceSource,
): { readonly entry: ParsedWorkspaceSource; readonly fresh: FreshParse } => {
  const lineCounter = new LineCounter()
  const yaml = parseDocument(input.source, { lineCounter })
  const value = yaml.toJS() as unknown
  const parseDiagnostics: Diagnostic[] = yaml.errors.map((error) => {
    const position = error.linePos?.[0] ?? { line: 1, col: 1 }
    return {
      severity: 'error',
      code: 'YM101',
      message: error.message.split(' at line ')[0] ?? error.message,
      path: input.path,
      pointer: '/',
      line: position.line,
      column: position.col,
    }
  })
  // Classification reads the composed mapping through the YAML document, which
  // types the lookup as `unknown` - the same key the old probe pass read.
  const fresh: FreshParse = { yaml, lineCounter }
  if (yaml.get('format') === 'yarramate/profile/v1') {
    return {
      entry: {
        source: input.source,
        kind: 'profile',
        value,
        schemaDiagnostics: parseDiagnostics,
        positions: new Map(),
      },
      fresh,
    }
  }

  const valid = parseDiagnostics.length === 0 && validateDocument(value)
  const schemaDiagnostics: Diagnostic[] =
    parseDiagnostics.length > 0
      ? parseDiagnostics
      : valid
        ? []
        : (validateDocument.errors ?? []).map((error) => {
            const property =
              error.keyword === 'additionalProperties'
                ? String(error.params.additionalProperty)
                : undefined
            const pointer = property
              ? `${error.instancePath}/${property}`
              : error.instancePath || '/'
            const yamlPath = pointer
              .split('/')
              .slice(1)
              .map((segment) =>
                /^\d+$/.test(segment) ? Number(segment) : segment,
              )
            const position = nodePosition(yaml, lineCounter, yamlPath)
            return {
              severity: 'error',
              code: 'YM201',
              message: property
                ? `Property "${property}" is not allowed`
                : `Document schema violation: ${describeSchemaViolation(error)}`,
              path: input.path,
              pointer,
              line: position.line,
              column: position.col,
            }
          })

  return {
    entry: {
      source: input.source,
      kind: 'document',
      value,
      schemaDiagnostics,
      positions: new Map(),
    },
    fresh,
  }
}

interface ParsedSource {
  readonly input: WorkspaceSource
  readonly entry: ParsedWorkspaceSource
  // Present only for a source parsed in this call, and held no longer than the
  // compile that asked for it: the returned cache carries the position memo,
  // never the composed document.
  readonly fresh?: FreshParse
}

// Reuse is decided by exact source-text equality against the previous cache, so
// a wrong or stale cache can only cost work, never change output. Sources that
// left the workspace leave the returned cache with them.
const parseSources = (
  sources: readonly WorkspaceSource[],
  previous?: CompilationCache,
): {
  readonly parsed: readonly ParsedSource[]
  readonly cache: CompilationCache
  readonly reused: number
} => {
  const entries = new Map<string, ParsedWorkspaceSource>()
  let reused = 0
  const parsed = sources.map((input): ParsedSource => {
    const cached = previous?.sources.get(input.path)
    if (cached !== undefined && cached.source === input.source) {
      reused += 1
      entries.set(input.path, cached)
      return { input, entry: cached }
    }
    const { entry, fresh } = parseWorkspaceSource(input)
    entries.set(input.path, entry)
    return { input, entry, fresh }
  })
  return { parsed, cache: { sources: entries }, reused }
}

function compileWorkspaceResolved(
  parsed: readonly ParsedSource[],
): ContextualCompilationResult {
  const profileInputs: ParsedSource[] = []
  const documentInputs: ParsedSource[] = []
  for (const source of parsed) {
    if (source.entry.kind === 'profile') {
      profileInputs.push(source)
    } else {
      documentInputs.push(source)
    }
  }

  const profiles = new Map<string, ResolvedProfile>()
  const conceptKindByIdentity = new Map<string, ResolvedConceptKind>()
  const relationshipKindByIdentity = new Map<string, ResolvedRelationshipKind>()
  const coreConceptKinds = new Map<string, ResolvedConceptKind>()
  for (const kind of conceptKinds) {
    const resolved = {
      identity: `${coreProfile}#${kind.id}`,
      aspect: kind.aspect,
      layer: kind.layer,
      lineage: [`${coreProfile}#${kind.id}`],
      ...(kind.rigidity === undefined ? {} : { rigidity: kind.rigidity }),
    } satisfies ResolvedConceptKind
    coreConceptKinds.set(kind.id, resolved)
    conceptKindByIdentity.set(resolved.identity, resolved)
  }
  const coreRelationshipKinds = new Map<string, ResolvedRelationshipKind>()
  for (const policy of relationshipPolicies) {
    const resolved = {
      identity: `${coreProfile}#${policy.id}`,
      lineage: [`${coreProfile}#${policy.id}`],
      sourceAspects: policy.sourceAspects,
      targetAspects: policy.targetAspects,
      repair: policy.repair,
    } satisfies ResolvedRelationshipKind
    coreRelationshipKinds.set(policy.id, resolved)
    relationshipKindByIdentity.set(resolved.identity, resolved)
  }
  profiles.set(coreProfile, {
    identity: coreProfile,
    lineage: [coreProfile],
    conceptKinds: coreConceptKinds,
    relationshipKinds: coreRelationshipKinds,
  })

  const profileDiagnostics: Diagnostic[] = []
  const pendingProfiles: Array<{
    readonly input: WorkspaceSource
    readonly value: NativeProfile
    readonly identity: string
    readonly positionFor: (
      yamlPath: readonly (string | number)[],
    ) => ResolvedPosition
  }> = []
  for (const { input, entry, fresh } of profileInputs) {
    // `validateProfile` below is what checks this shape; the cast carries the
    // same pre-validation assumption the loop has always made.
    const value = entry.value as NativeProfile
    const positionFor = positionReader(input.source, entry.positions, fresh)
    if (entry.schemaDiagnostics.length > 0) {
      profileDiagnostics.push(...entry.schemaDiagnostics)
      continue
    }
    if (!validateProfile(value)) {
      for (const error of validateProfile.errors ?? []) {
        const property =
          error.keyword === 'additionalProperties'
            ? String(error.params.additionalProperty)
            : undefined
        const pointer = property
          ? `${error.instancePath}/${property}`
          : error.instancePath || '/'
        const yamlPath = pointer
          .split('/')
          .slice(1)
          .map((segment) =>
            /^\d+$/.test(segment) ? Number(segment) : segment,
          )
        const position = positionFor(yamlPath)
        profileDiagnostics.push({
          severity: 'error',
          code: 'YM201',
          message: property
            ? `Property "${property}" is not allowed`
            : `Profile schema violation: ${describeSchemaViolation(error)}`,
          path: input.path,
          pointer,
          line: position.line,
          column: position.col,
        })
      }
      continue
    }

    const identity = `${value.id}@${value.version}`
    pendingProfiles.push({ input, value, identity, positionFor })
  }

  let unresolvedProfiles = pendingProfiles.sort((left, right) =>
    left.identity.localeCompare(right.identity) ||
    left.input.path.localeCompare(right.input.path),
  )
  while (unresolvedProfiles.length > 0) {
    const next: typeof unresolvedProfiles = []
    let resolvedAny = false

    for (const entry of unresolvedProfiles) {
      const { input, value, identity, positionFor } = entry
      const parentProfile = profiles.get(value.extends)
      if (parentProfile === undefined) {
        next.push(entry)
        continue
      }
      if (profiles.has(identity)) {
        const position = positionFor(['id'])
        profileDiagnostics.push({
          severity: 'error',
          code: 'YM411',
          message: `Profile "${identity}" is declared more than once`,
          path: input.path,
          pointer: '/id',
          line: position.line,
          column: position.col,
        })
        continue
      }

      const resolvedConceptKinds = new Map(parentProfile.conceptKinds)
      for (const [index, kind] of value.conceptKinds.entries()) {
        if (resolvedConceptKinds.has(kind.id)) {
          const position = positionFor(['conceptKinds', index, 'id'])
          profileDiagnostics.push({
            severity: 'error',
            code: 'YM409',
            message: `Concept kind "${kind.id}" conflicts with an inherited kind`,
            path: input.path,
            pointer: `/conceptKinds/${index}/id`,
            line: position.line,
            column: position.col,
          })
          continue
        }
        const parent = conceptKindByIdentity.get(kind.parent)
        if (parent === undefined) {
          const position = positionFor(['conceptKinds', index, 'parent'])
          profileDiagnostics.push({
            severity: 'error',
            code: 'YM407',
            message: `Concept parent "${kind.parent}" is not available`,
            path: input.path,
            pointer: `/conceptKinds/${index}/parent`,
            line: position.line,
            column: position.col,
          })
          continue
        }
        // OntoClean: an anti-rigid kind cannot subsume a rigid one. The
        // parent's lineage is the full ancestor chain, and subsumption is
        // transitive, so an unannotated kind sitting in between does not
        // launder the violation (ADR 0078).
        if (kind.rigidity === 'rigid') {
          const antiRigidAncestor = parent.lineage.find(
            (ancestor) =>
              conceptKindByIdentity.get(ancestor)?.rigidity === 'anti-rigid',
          )
          if (antiRigidAncestor !== undefined) {
            const position = positionFor(['conceptKinds', index, 'rigidity'])
            profileDiagnostics.push({
              severity: 'error',
              code: 'YM413',
              message: `Rigid concept kind "${kind.id}" specializes anti-rigid kind "${antiRigidAncestor}"; nothing is essentially of an anti-rigid kind, so parent "${kind.id}" under an entity kind, or drop its "rigid" annotation`,
              path: input.path,
              pointer: `/conceptKinds/${index}/rigidity`,
              line: position.line,
              column: position.col,
            })
            continue
          }
        }
        const resolved = {
          identity: `${identity}#${kind.id}`,
          aspect: parent.aspect,
          layer: kind.layer ?? parent.layer,
          lineage: [...parent.lineage, `${identity}#${kind.id}`],
          ...(kind.rigidity === undefined ? {} : { rigidity: kind.rigidity }),
        } satisfies ResolvedConceptKind
        resolvedConceptKinds.set(kind.id, resolved)
        conceptKindByIdentity.set(resolved.identity, resolved)
      }

      const resolvedRelationshipKinds = new Map(
        parentProfile.relationshipKinds,
      )
      for (const [index, kind] of value.relationshipKinds.entries()) {
        if (resolvedRelationshipKinds.has(kind.id)) {
          const position = positionFor(['relationshipKinds', index, 'id'])
          profileDiagnostics.push({
            severity: 'error',
            code: 'YM410',
            message: `Relationship kind "${kind.id}" conflicts with an inherited kind`,
            path: input.path,
            pointer: `/relationshipKinds/${index}/id`,
            line: position.line,
            column: position.col,
          })
          continue
        }
        const parent = relationshipKindByIdentity.get(kind.parent)
        if (parent === undefined) {
          const position = positionFor(['relationshipKinds', index, 'parent'])
          profileDiagnostics.push({
            severity: 'error',
            code: 'YM408',
            message: `Relationship parent "${kind.parent}" is not available`,
            path: input.path,
            pointer: `/relationshipKinds/${index}/parent`,
            line: position.line,
            column: position.col,
          })
          continue
        }
        let broadensParent = false
        for (const endpoint of ['source', 'target'] as const) {
          const field = `${endpoint}Aspects` as const
          const declared = kind[field]
          const inherited = parent[field]
          if (
            declared !== undefined &&
            inherited !== undefined &&
            declared.some((aspect) => !inherited.includes(aspect))
          ) {
            const position = positionFor([
              'relationshipKinds',
              index,
              field,
            ])
            profileDiagnostics.push({
              severity: 'error',
              code: 'YM412',
              message: `Relationship kind "${kind.id}" broadens its parent ${endpoint} aspects`,
              path: input.path,
              pointer: `/relationshipKinds/${index}/${field}`,
              line: position.line,
              column: position.col,
            })
            broadensParent = true
          }
        }
        if (broadensParent) {
          continue
        }
        const resolved = {
          identity: `${identity}#${kind.id}`,
          lineage: [...parent.lineage, `${identity}#${kind.id}`],
          sourceAspects: kind.sourceAspects ?? parent.sourceAspects,
          targetAspects: kind.targetAspects ?? parent.targetAspects,
        } satisfies ResolvedRelationshipKind
        resolvedRelationshipKinds.set(kind.id, resolved)
        relationshipKindByIdentity.set(resolved.identity, resolved)
      }

      profiles.set(identity, {
        identity,
        lineage: [...parentProfile.lineage, identity],
        conceptKinds: resolvedConceptKinds,
        relationshipKinds: resolvedRelationshipKinds,
      })
      resolvedAny = true
    }

    if (!resolvedAny) {
      for (const { input, value, positionFor } of next) {
        const position = positionFor(['extends'])
        profileDiagnostics.push({
          severity: 'error',
          code: 'YM406',
          message: `Parent profile "${value.extends}" is not available`,
          path: input.path,
          pointer: '/extends',
          line: position.line,
          column: position.col,
        })
      }
      break
    }
    unresolvedProfiles = next
  }

  if (profileDiagnostics.length > 0) {
    return diagnosticFailure(profileDiagnostics)
  }

  const documents = documentInputs.map(({ input, entry, fresh }) => {
    // Schema-checked by `parseWorkspaceSource`; the faults it found are the
    // `schemaDiagnostics` returned below, and they gate every later phase.
    const value = entry.value as NativeDocument
    const positionAt = positionReader(input.source, entry.positions, fresh)

    const location = (
      yamlPath: readonly (string | number)[],
      pointer: string,
    ): GraphSource => {
      const position = positionAt(yamlPath)
      return {
        document: value?.id ?? '<unknown>',
        path: input.path,
        pointer,
        line: position.line,
        column: position.col,
      }
    }

    return {
      input,
      value,
      location,
      schemaDiagnostics: entry.schemaDiagnostics,
    }
  })

  const claims: GraphClaim[] = []
  const subjects: SemanticGraph['subjects'][number][] = []
  const diagnostics: Diagnostic[] = documents.flatMap(
    ({ schemaDiagnostics }) => schemaDiagnostics,
  )

  if (diagnostics.length > 0) {
    return diagnosticFailure(diagnostics)
  }

  const seenDocumentIds = new Set<string>()
  for (const { input, value, location } of documents) {
    if (seenDocumentIds.has(value.id)) {
      const source = location(['id'], '/id')
      diagnostics.push({
        severity: 'error',
        code: 'YM303',
        message: `Duplicate document ID "${value.id}"`,
        path: input.path,
        pointer: '/id',
        line: source.line,
        column: source.column,
      })
    }
    seenDocumentIds.add(value.id)
  }

  const conceptByQualifiedId = new Map<
    string,
    {
      readonly concept: NativeConcept
      readonly profile: string
      readonly document: string
    }
  >(
    documents.flatMap(({ value }) =>
      value.concepts.map(
        (concept) =>
          [
            `${value.id}#${concept.id}`,
            {
              concept,
              profile: value.profile,
              document: value.id,
            },
          ] as const,
      ),
    ),
  )
  const qualifyReference = (documentId: string, reference: string) =>
    reference.includes('#') ? reference : `${documentId}#${reference}`
  const architectureStateIds = new Set(
    documents.flatMap(({ value }) =>
      (value.states ?? []).map((state) => `${value.id}#${state.id}`),
    ),
  )
  const subjectIds = new Set(
    documents.flatMap(({ value }) => [
      ...(value.states ?? []).map((state) => `${value.id}#${state.id}`),
      ...value.concepts.map((concept) => `${value.id}#${concept.id}`),
      ...value.relationships.map(
        (relationship) => `${value.id}#${relationship.id}`,
      ),
    ]),
  )
  const architectureStateAfter = new Map<string, string>(
    documents.flatMap(({ value }) =>
      (value.states ?? []).flatMap((state) =>
        state.after === undefined
          ? []
          : [
              [
                `${value.id}#${state.id}`,
                qualifyReference(value.id, state.after),
              ] as const,
            ],
      ),
    ),
  )
  const participatesInStateCycle = (start: string) => {
    const visited = new Set<string>()
    let current = architectureStateAfter.get(start)
    while (current !== undefined) {
      if (current === start) return true
      if (visited.has(current)) return false
      visited.add(current)
      current = architectureStateAfter.get(current)
    }
    return false
  }
  // A succession points backwards, from a successor to the predecessors it
  // took over from (ADR 0080). Unlike state ordering it is a list, so the
  // walk fans out rather than following a single link.
  const supersededBy = new Map<string, readonly string[]>(
    documents.flatMap(({ value }) =>
      value.concepts.flatMap((concept) =>
        concept.supersedes === undefined
          ? []
          : [
              [
                `${value.id}#${concept.id}`,
                concept.supersedes.map((predecessor) =>
                  qualifyReference(value.id, predecessor),
                ),
              ] as const,
            ],
      ),
    ),
  )
  // Self-succession is a cycle of length one, but it has its own diagnostic
  // because it is the case that actually happens; skipping it here keeps
  // exactly one diagnostic firing per defect.
  const participatesInSuccessionCycle = (start: string) => {
    const visited = new Set<string>([start])
    const pending = [
      ...(supersededBy.get(start) ?? []).filter(
        (predecessor) => predecessor !== start,
      ),
    ]
    while (pending.length > 0) {
      const current = pending.pop()!
      if (current === start) return true
      if (visited.has(current)) continue
      visited.add(current)
      pending.push(
        ...(supersededBy.get(current) ?? []).filter(
          (predecessor) => predecessor !== current,
        ),
      )
    }
    return false
  }

  for (const { input, value, location } of documents) {
    const selectedProfile = profiles.get(value.profile)
    if (selectedProfile === undefined) {
      const source = location(['profile'], '/profile')
      diagnostics.push({
        severity: 'error',
        code: 'YM403',
        message: `Profile "${value.profile}" is not available`,
        path: input.path,
        pointer: '/profile',
        line: source.line,
        column: source.column,
      })
      continue
    }

    const seenIds = new Set<string>()
    const declarations = [
      ...(value.states ?? []).map((state, index) => ({
        id: state.id,
        yamlPath: ['states', index, 'id'] as const,
        pointer: `/states/${index}/id`,
      })),
      ...value.concepts.map((concept, index) => ({
        id: concept.id,
        yamlPath: ['concepts', index, 'id'] as const,
        pointer: `/concepts/${index}/id`,
      })),
      ...value.relationships.map((relationship, index) => ({
        id: relationship.id,
        yamlPath: ['relationships', index, 'id'] as const,
        pointer: `/relationships/${index}/id`,
      })),
    ]
    for (const declaration of declarations) {
      if (seenIds.has(declaration.id)) {
        const source = location(declaration.yamlPath, declaration.pointer)
        diagnostics.push({
          severity: 'error',
          code: 'YM301',
          message: `Duplicate local ID "${declaration.id}"`,
          path: input.path,
          pointer: declaration.pointer,
          line: source.line,
          column: source.column,
        })
      }
      seenIds.add(declaration.id)
    }

    for (const [index, state] of (value.states ?? []).entries()) {
      const stateIdentity = `${value.id}#${state.id}`
      if (
        state.after !== undefined &&
        !architectureStateIds.has(
          qualifyReference(value.id, state.after),
        )
      ) {
        const pointer = `/states/${index}/after`
        const source = location(['states', index, 'after'], pointer)
        diagnostics.push({
          severity: 'error',
          code: 'YM307',
          message: `Unresolved architecture state reference "${state.after}"`,
          path: input.path,
          pointer,
          line: source.line,
          column: source.column,
        })
      }
      if (
        state.after !== undefined &&
        participatesInStateCycle(stateIdentity)
      ) {
        const pointer = `/states/${index}/after`
        const source = location(['states', index, 'after'], pointer)
        diagnostics.push({
          severity: 'error',
          code: 'YM502',
          message: `Architecture state "${stateIdentity}" participates in an ordering cycle`,
          path: input.path,
          pointer,
          line: source.line,
          column: source.column,
        })
      }
    }

    for (const [index, state] of (value.states ?? []).entries()) {
      const subject = `${value.id}#${state.id}`
      subjects.push({ id: subject, type: 'concept' })
      claims.push(
        {
          id: `${subject}~kind`,
          subject,
          predicate: 'yarramate/concept/kind',
          object: { value: `${coreProfile}#plateau` },
          origin: 'declared',
          source: location(
            ['states', index, 'kind'],
            `/states/${index}/kind`,
          ),
        },
        {
          id: `${subject}~name`,
          subject,
          predicate: 'yarramate/concept/name',
          object: { value: state.name },
          origin: 'declared',
          source: location(
            ['states', index, 'name'],
            `/states/${index}/name`,
          ),
        },
        {
          id: `${subject}~state-type`,
          subject,
          predicate: 'yarramate/state/type',
          object: { value: state.kind },
          origin: 'declared',
          source: location(
            ['states', index, 'kind'],
            `/states/${index}/kind`,
          ),
        },
      )
      if (state.description !== undefined) {
        claims.push({
          id: `${subject}~description`,
          subject,
          predicate: 'yarramate/concept/description',
          object: { value: state.description },
          origin: 'declared',
          source: location(
            ['states', index, 'description'],
            `/states/${index}/description`,
          ),
        })
      }
      if (state.after !== undefined) {
        claims.push({
          id: `${subject}~after`,
          subject,
          predicate: 'yarramate/state/after',
          object: {
            ref: qualifyReference(value.id, state.after),
          },
          origin: 'declared',
          source: location(
            ['states', index, 'after'],
            `/states/${index}/after`,
          ),
        })
      }
    }

    for (const [index, concept] of value.concepts.entries()) {
      if (!selectedProfile.conceptKinds.has(concept.kind)) {
        const pointer = `/concepts/${index}/kind`
        const source = location(['concepts', index, 'kind'], pointer)
        diagnostics.push({
          severity: 'error',
          code: 'YM401',
          message: `Unknown concept kind "${concept.kind}" in profile "${value.profile}"${(() => {
            const suggestion = closestCandidate(
              concept.kind,
              selectedProfile.conceptKinds.keys(),
            )
            return suggestion === undefined
              ? ''
              : `; did you mean "${suggestion}"?`
          })()}`,
          path: input.path,
          pointer,
          line: source.line,
          column: source.column,
        })
      }
      if (
        concept.owner !== undefined &&
        !conceptByQualifiedId.has(
          qualifyReference(value.id, concept.owner),
        )
      ) {
        const pointer = `/concepts/${index}/owner`
        const source = location(['concepts', index, 'owner'], pointer)
        diagnostics.push({
          severity: 'error',
          code: 'YM304',
          message: `Unresolved owner reference "${concept.owner}"`,
          path: input.path,
          pointer,
          line: source.line,
          column: source.column,
        })
      }
      for (const [distinctIndex, other] of (
        concept.distinctFrom ?? []
      ).entries()) {
        const pointer = `/concepts/${index}/distinctFrom/${distinctIndex}`
        const otherIdentity = qualifyReference(value.id, other)
        if (!conceptByQualifiedId.has(otherIdentity)) {
          const source = location(
            ['concepts', index, 'distinctFrom', distinctIndex],
            pointer,
          )
          diagnostics.push({
            severity: 'error',
            code: 'YM310',
            message: `Unresolved distinct-from reference "${other}"`,
            path: input.path,
            pointer,
            line: source.line,
            column: source.column,
          })
        } else if (otherIdentity === `${value.id}#${concept.id}`) {
          const source = location(
            ['concepts', index, 'distinctFrom', distinctIndex],
            pointer,
          )
          diagnostics.push({
            severity: 'error',
            code: 'YM311',
            message: `Concept "${concept.id}" declares itself distinct from itself`,
            path: input.path,
            pointer,
            line: source.line,
            column: source.column,
          })
        }
      }
      for (const [supersedesIndex, predecessor] of (
        concept.supersedes ?? []
      ).entries()) {
        const pointer = `/concepts/${index}/supersedes/${supersedesIndex}`
        const predecessorIdentity = qualifyReference(value.id, predecessor)
        const subjectIdentity = `${value.id}#${concept.id}`
        if (!conceptByQualifiedId.has(predecessorIdentity)) {
          const source = location(
            ['concepts', index, 'supersedes', supersedesIndex],
            pointer,
          )
          diagnostics.push({
            severity: 'error',
            code: 'YM312',
            message: `Unresolved succession reference "${predecessor}"`,
            path: input.path,
            pointer,
            line: source.line,
            column: source.column,
          })
        } else if (predecessorIdentity === subjectIdentity) {
          const source = location(
            ['concepts', index, 'supersedes', supersedesIndex],
            pointer,
          )
          diagnostics.push({
            severity: 'error',
            code: 'YM313',
            message: `Concept "${concept.id}" declares that it supersedes itself`,
            path: input.path,
            pointer,
            line: source.line,
            column: source.column,
          })
        } else if (participatesInSuccessionCycle(subjectIdentity)) {
          const source = location(
            ['concepts', index, 'supersedes', supersedesIndex],
            pointer,
          )
          diagnostics.push({
            severity: 'error',
            code: 'YM504',
            message: `Concept "${subjectIdentity}" participates in a succession cycle`,
            path: input.path,
            pointer,
            line: source.line,
            column: source.column,
          })
        }
      }
      const seenConstraintIds = new Set<string>()
      for (const [constraintIndex, constraint] of (
        concept.constraints ?? []
      ).entries()) {
        if (seenConstraintIds.has(constraint.id)) {
          const pointer = `/concepts/${index}/constraints/${constraintIndex}/id`
          const source = location(
            ['concepts', index, 'constraints', constraintIndex, 'id'],
            pointer,
          )
          diagnostics.push({
            severity: 'error',
            code: 'YM306',
            message: `Duplicate constraint ID "${constraint.id}"`,
            path: input.path,
            pointer,
            line: source.line,
            column: source.column,
          })
        }
        seenConstraintIds.add(constraint.id)
        if (
          !conceptByQualifiedId.has(
            qualifyReference(value.id, constraint.ref),
          )
        ) {
          const pointer = `/concepts/${index}/constraints/${constraintIndex}/ref`
          const source = location(
            ['concepts', index, 'constraints', constraintIndex, 'ref'],
            pointer,
          )
          diagnostics.push({
            severity: 'error',
            code: 'YM305',
            message: `Unresolved constraint reference "${constraint.ref}"`,
            path: input.path,
            pointer,
            line: source.line,
            column: source.column,
          })
        }
      }
      const seenReferenceIds = new Set<string>()
      for (const [referenceIndex, reference] of (
        concept.references ?? []
      ).entries()) {
        if (seenReferenceIds.has(reference.id)) {
          const pointer = `/concepts/${index}/references/${referenceIndex}/id`
          const source = location(
            ['concepts', index, 'references', referenceIndex, 'id'],
            pointer,
          )
          diagnostics.push({
            severity: 'error',
            code: 'YM309',
            message: `Duplicate reference ID "${reference.id}"`,
            path: input.path,
            pointer,
            line: source.line,
            column: source.column,
          })
        }
        seenReferenceIds.add(reference.id)
        if (
          !subjectIds.has(
            qualifyReference(value.id, reference.ref),
          )
        ) {
          const pointer = `/concepts/${index}/references/${referenceIndex}/ref`
          const source = location(
            ['concepts', index, 'references', referenceIndex, 'ref'],
            pointer,
          )
          diagnostics.push({
            severity: 'error',
            code: 'YM308',
            message: `Unresolved subject reference "${reference.ref}"`,
            path: input.path,
            pointer,
            line: source.line,
            column: source.column,
          })
        }
      }
      for (const [stateIndex, state] of (
        concept.presentIn ?? []
      ).entries()) {
        if (
          !architectureStateIds.has(
            qualifyReference(value.id, state),
          )
        ) {
          const pointer = `/concepts/${index}/presentIn/${stateIndex}`
          const source = location(
            ['concepts', index, 'presentIn', stateIndex],
            pointer,
          )
          diagnostics.push({
            severity: 'error',
            code: 'YM307',
            message: `Unresolved architecture state reference "${state}"`,
            path: input.path,
            pointer,
            line: source.line,
            column: source.column,
          })
        }
      }
    }
    for (const [index, relationship] of value.relationships.entries()) {
      const seenReferenceIds = new Set<string>()
      for (const [referenceIndex, reference] of (
        relationship.references ?? []
      ).entries()) {
        if (seenReferenceIds.has(reference.id)) {
          const pointer = `/relationships/${index}/references/${referenceIndex}/id`
          const source = location(
            [
              'relationships',
              index,
              'references',
              referenceIndex,
              'id',
            ],
            pointer,
          )
          diagnostics.push({
            severity: 'error',
            code: 'YM309',
            message: `Duplicate reference ID "${reference.id}"`,
            path: input.path,
            pointer,
            line: source.line,
            column: source.column,
          })
        }
        seenReferenceIds.add(reference.id)
        if (
          !subjectIds.has(
            qualifyReference(value.id, reference.ref),
          )
        ) {
          const pointer = `/relationships/${index}/references/${referenceIndex}/ref`
          const source = location(
            [
              'relationships',
              index,
              'references',
              referenceIndex,
              'ref',
            ],
            pointer,
          )
          diagnostics.push({
            severity: 'error',
            code: 'YM308',
            message: `Unresolved subject reference "${reference.ref}"`,
            path: input.path,
            pointer,
            line: source.line,
            column: source.column,
          })
        }
      }
      for (const [stateIndex, state] of (
        relationship.presentIn ?? []
      ).entries()) {
        const stateIdentity = qualifyReference(value.id, state)
        if (
          !architectureStateIds.has(stateIdentity)
        ) {
          const pointer = `/relationships/${index}/presentIn/${stateIndex}`
          const source = location(
            ['relationships', index, 'presentIn', stateIndex],
            pointer,
          )
          diagnostics.push({
            severity: 'error',
            code: 'YM307',
            message: `Unresolved architecture state reference "${state}"`,
            path: input.path,
            pointer,
            line: source.line,
            column: source.column,
          })
        } else {
          for (const endpoint of [
            relationship.from,
            relationship.to,
          ]) {
            const endpointIdentity = qualifyReference(value.id, endpoint)
            const resolved = conceptByQualifiedId.get(endpointIdentity)
            const endpointStates =
              resolved?.concept.presentIn?.map((candidate) =>
                qualifyReference(resolved.document, candidate),
              ) ?? []
            if (
              resolved !== undefined &&
              endpointStates.length > 0 &&
              !endpointStates.includes(stateIdentity)
            ) {
              const pointer = `/relationships/${index}/presentIn/${stateIndex}`
              const source = location(
                ['relationships', index, 'presentIn', stateIndex],
                pointer,
              )
              diagnostics.push({
                severity: 'error',
                code: 'YM503',
                message: `Relationship "${relationship.id}" is present in "${stateIdentity}" but endpoint "${endpointIdentity}" is absent`,
                path: input.path,
                pointer,
                line: source.line,
                column: source.column,
              })
            }
          }
        }
      }
      for (const controlled of [
        { field: 'mode', kind: 'access' },
        { field: 'content', kind: 'flow' },
      ] as const) {
        if (
          relationship[controlled.field] !== undefined &&
          relationship.kind !== controlled.kind
        ) {
          const pointer = `/relationships/${index}/${controlled.field}`
          const source = location(
            ['relationships', index, controlled.field],
            pointer,
          )
          diagnostics.push({
            severity: 'error',
            code: 'YM405',
            message: `Field "${controlled.field}" is only valid for relationship kind "${controlled.kind}"`,
            path: input.path,
            pointer,
            line: source.line,
            column: source.column,
          })
        }
      }
      if (!selectedProfile.relationshipKinds.has(relationship.kind)) {
        const pointer = `/relationships/${index}/kind`
        const source = location(['relationships', index, 'kind'], pointer)
        diagnostics.push({
          severity: 'error',
          code: 'YM402',
          message: `Unknown relationship kind "${relationship.kind}" in profile "${value.profile}"${(() => {
            const suggestion = closestCandidate(
              relationship.kind,
              selectedProfile.relationshipKinds.keys(),
            )
            return suggestion === undefined
              ? ''
              : `; did you mean "${suggestion}"?`
          })()}`,
          path: input.path,
          pointer,
          line: source.line,
          column: source.column,
        })
      }
      for (const endpoint of ['from', 'to'] as const) {
        const reference = relationship[endpoint]
        if (
          !conceptByQualifiedId.has(qualifyReference(value.id, reference))
        ) {
          const pointer = `/relationships/${index}/${endpoint}`
          const source = location(
            ['relationships', index, endpoint],
            pointer,
          )
          diagnostics.push({
            severity: 'error',
            code: 'YM302',
            message: `Unresolved concept reference "${reference}"`,
            path: input.path,
            pointer,
            line: source.line,
            column: source.column,
          })
        }
      }
      const policy = selectedProfile.relationshipKinds.get(relationship.kind)
      if (policy !== undefined) {
        const aspectOf = (reference: string) => {
          const resolvedConcept = conceptByQualifiedId.get(
            qualifyReference(value.id, reference),
          )
          return resolvedConcept === undefined
            ? undefined
            : profiles
                .get(resolvedConcept.profile)
                ?.conceptKinds.get(resolvedConcept.concept.kind)?.aspect
        }
        const sourceAspect = aspectOf(relationship.from)
        const targetAspect = aspectOf(relationship.to)
        const candidates =
          sourceAspect === undefined || targetAspect === undefined
            ? ''
            : candidateKindHint(
                selectedProfile.relationshipKinds,
                relationship.kind,
                sourceAspect,
                targetAspect,
              )
        for (const endpoint of ['source', 'target'] as const) {
          const reference =
            endpoint === 'source' ? relationship.from : relationship.to
          const aspect =
            endpoint === 'source' ? sourceAspect : targetAspect
          const allowed =
            endpoint === 'source'
              ? policy.sourceAspects
              : policy.targetAspects
          if (
            aspect !== undefined &&
            allowed !== undefined &&
            !allowed.includes(aspect)
          ) {
            const field = endpoint === 'source' ? 'from' : 'to'
            const pointer = `/relationships/${index}/${field}`
            const source = location(
              ['relationships', index, field],
              pointer,
            )
            diagnostics.push({
              severity: 'error',
              code: 'YM404',
              message: `Relationship "${relationship.kind}" requires a ${endpoint} with aspect ${allowed.map((entry) => `"${entry}"`).join(' or ')}; "${reference}" has aspect "${aspect}"${policy.repair === undefined ? '' : `; ${policy.repair}`}${candidates}`,
              path: input.path,
              pointer,
              line: source.line,
              column: source.column,
            })
          }
        }
      }
    }

    for (const [index, concept] of value.concepts.entries()) {
      const subject = `${value.id}#${concept.id}`
      subjects.push({ id: subject, type: 'concept' })
      claims.push(
        {
          id: `${subject}~kind`,
          subject,
          predicate: 'yarramate/concept/kind',
          object: {
            value:
              selectedProfile.conceptKinds.get(concept.kind)?.identity ??
              concept.kind,
          },
          origin: 'declared',
          source: location(
            ['concepts', index, 'kind'],
            `/concepts/${index}/kind`,
          ),
        },
        {
          id: `${subject}~name`,
          subject,
          predicate: 'yarramate/concept/name',
          object: { value: concept.name },
          origin: 'declared',
          source: location(
            ['concepts', index, 'name'],
            `/concepts/${index}/name`,
          ),
        },
      )
      if (concept.description !== undefined) {
        claims.push({
          id: `${subject}~description`,
          subject,
          predicate: 'yarramate/concept/description',
          object: { value: concept.description },
          origin: 'declared',
          source: location(
            ['concepts', index, 'description'],
            `/concepts/${index}/description`,
          ),
        })
      }
      // An alternative label is a matchable name, never a rendered one
      // (ADR 0076): one value claim each, so a consumer that does not know
      // the predicate keeps reading the preferred name correctly.
      for (const [akaIndex, alias] of (concept.aka ?? []).entries()) {
        claims.push({
          id: aliasClaimId(subject, alias),
          subject,
          predicate: 'yarramate/concept/alias',
          object: { value: alias },
          origin: 'declared',
          source: location(
            ['concepts', index, 'aka', akaIndex],
            `/concepts/${index}/aka/${akaIndex}`,
          ),
        })
      }
      if (concept.status !== undefined) {
        claims.push({
          id: `${subject}~status`,
          subject,
          predicate: 'yarramate/lifecycle/status',
          object: { value: concept.status },
          origin: 'declared',
          source: location(
            ['concepts', index, 'status'],
            `/concepts/${index}/status`,
          ),
        })
      }
      // A distinctness record is a human's dismissal of a near-duplicate
      // question (ADR 0077), stored the way an attestation is: the claim's
      // existence is the whole signal, and revocation is deletion.
      for (const [distinctIndex, other] of (
        concept.distinctFrom ?? []
      ).entries()) {
        const otherIdentity = qualifyReference(value.id, other)
        claims.push({
          id: distinctFromClaimId(subject, otherIdentity),
          subject,
          predicate: 'yarramate/identity/distinct-from',
          object: { ref: otherIdentity },
          origin: 'declared',
          source: location(
            ['concepts', index, 'distinctFrom', distinctIndex],
            `/concepts/${index}/distinctFrom/${distinctIndex}`,
          ),
        })
      }
      // A succession says where a subject's responsibility came from
      // (ADR 0080). One predicate carries rename, split, and merge, because
      // the shape is derivable from how many claims point where, and a
      // predecessor is not required to be retired: the transition period
      // during which both are current is real.
      for (const [supersedesIndex, predecessor] of (
        concept.supersedes ?? []
      ).entries()) {
        const predecessorIdentity = qualifyReference(value.id, predecessor)
        claims.push({
          id: supersedesClaimId(subject, predecessorIdentity),
          subject,
          predicate: 'yarramate/lineage/supersedes',
          object: { ref: predecessorIdentity },
          origin: 'declared',
          source: location(
            ['concepts', index, 'supersedes', supersedesIndex],
            `/concepts/${index}/supersedes/${supersedesIndex}`,
          ),
        })
      }
      if (concept.owner !== undefined) {
        claims.push({
          id: `${subject}~owner`,
          subject,
          predicate: 'yarramate/ownership/owner',
          object: {
            ref: qualifyReference(value.id, concept.owner),
          },
          origin: 'declared',
          source: location(
            ['concepts', index, 'owner'],
            `/concepts/${index}/owner`,
          ),
        })
      }
      for (const [constraintIndex, constraint] of (
        concept.constraints ?? []
      ).entries()) {
        claims.push({
          id: `${subject}~constraint-${constraint.id}`,
          subject,
          predicate: 'yarramate/constraint/requires',
          object: {
            ref: qualifyReference(value.id, constraint.ref),
          },
          origin: 'declared',
          source: location(
            ['concepts', index, 'constraints', constraintIndex, 'ref'],
            `/concepts/${index}/constraints/${constraintIndex}/ref`,
          ),
        })
        // An expected observation is a testable restatement of the rule the
        // constraint names (ADR 0075). Provider and key cannot contain
        // whitespace, so `<provider> <key> <expected value>` round-trips
        // through the single string value graph v2 already carries; the
        // reconciler mirrors this encoding when it parses the claim back.
        if (constraint.expects !== undefined) {
          claims.push({
            id: `${subject}~expects-${constraint.id}`,
            subject,
            predicate: 'yarramate/constraint/expects',
            object: {
              value: `${constraint.expects.provider} ${constraint.expects.key} ${constraint.expects.value}`,
            },
            origin: 'declared',
            source: location(
              [
                'concepts',
                index,
                'constraints',
                constraintIndex,
                'expects',
                'value',
              ],
              `/concepts/${index}/constraints/${constraintIndex}/expects/value`,
            ),
          })
        }
      }
      for (const [referenceIndex, reference] of (
        concept.references ?? []
      ).entries()) {
        claims.push({
          id: `${subject}~reference-${reference.id}`,
          subject,
          predicate: 'yarramate/reference/refers-to',
          object: {
            ref: qualifyReference(value.id, reference.ref),
          },
          origin: 'declared',
          source: location(
            ['concepts', index, 'references', referenceIndex, 'ref'],
            `/concepts/${index}/references/${referenceIndex}/ref`,
          ),
        })
      }
      // An attestation is a recorded judgment, not content the engine
      // evaluates: the claim's existence is what triggers can see, and
      // revocation is deletion, reviewed at the Git boundary.
      for (const [attestationIndex, attestation] of (
        concept.attestations ?? []
      ).entries()) {
        // The authority is held to the same rule as ownership: a judgment
        // is worthless if nobody in the model made it, and a name only the
        // signer knows cannot be checked by the reviewer reading the diff.
        const authority = qualifyReference(value.id, attestation.by)
        if (!conceptByQualifiedId.has(authority)) {
          const pointer = `/concepts/${index}/attestations/${attestationIndex}/by`
          const source = location(
            ['concepts', index, 'attestations', attestationIndex, 'by'],
            pointer,
          )
          diagnostics.push({
            severity: 'error',
            code: 'YM304',
            message: `Unresolved attestation authority reference "${attestation.by}"`,
            path: input.path,
            pointer,
            line: source.line,
            column: source.column,
          })
        }
        claims.push({
          id: `${subject}~attestation-${attestation.topic}`,
          subject,
          predicate: `${ATTESTATION_PREDICATE_PREFIX}${attestation.topic}`,
          object: {
            value: attestationClaimValue({
              by: authority,
              on: attestation.on,
              ...(attestation.recordedBy === undefined
                ? {}
                : { recordedBy: attestation.recordedBy }),
            }),
          },
          origin: 'declared',
          source: location(
            ['concepts', index, 'attestations', attestationIndex, 'topic'],
            `/concepts/${index}/attestations/${attestationIndex}/topic`,
          ),
        })
      }
      for (const [stateIndex, state] of (
        concept.presentIn ?? []
      ).entries()) {
        const stateIdentity = qualifyReference(value.id, state)
        claims.push({
          id: presenceClaimId(subject, stateIdentity),
          subject,
          predicate: 'yarramate/state/present-in',
          object: { ref: stateIdentity },
          origin: 'declared',
          source: location(
            ['concepts', index, 'presentIn', stateIndex],
            `/concepts/${index}/presentIn/${stateIndex}`,
          ),
        })
      }
    }

    for (const [index, relationship] of value.relationships.entries()) {
      const id = `${value.id}#${relationship.id}`
      subjects.push({ id, type: 'relationship' })
      claims.push({
        id,
        subject: qualifyReference(value.id, relationship.from),
        predicate:
          selectedProfile.relationshipKinds.get(relationship.kind)?.identity ??
          relationship.kind,
        object: { ref: qualifyReference(value.id, relationship.to) },
        origin: 'declared',
        source: location(
          ['relationships', index],
          `/relationships/${index}`,
        ),
      })
      if (relationship.name !== undefined) {
        claims.push({
          id: `${id}~name`,
          subject: id,
          predicate: 'yarramate/relationship/name',
          object: { value: relationship.name },
          origin: 'declared',
          source: location(
            ['relationships', index, 'name'],
            `/relationships/${index}/name`,
          ),
        })
      }
      if (relationship.description !== undefined) {
        claims.push({
          id: `${id}~description`,
          subject: id,
          predicate: 'yarramate/relationship/description',
          object: { value: relationship.description },
          origin: 'declared',
          source: location(
            ['relationships', index, 'description'],
            `/relationships/${index}/description`,
          ),
        })
      }
      if (relationship.mode !== undefined) {
        claims.push({
          id: `${id}~mode`,
          subject: id,
          predicate: 'yarramate/access/mode',
          object: { value: relationship.mode },
          origin: 'declared',
          source: location(
            ['relationships', index, 'mode'],
            `/relationships/${index}/mode`,
          ),
        })
      }
      if (relationship.content !== undefined) {
        claims.push({
          id: `${id}~content`,
          subject: id,
          predicate: 'yarramate/flow/content',
          object: { value: relationship.content },
          origin: 'declared',
          source: location(
            ['relationships', index, 'content'],
            `/relationships/${index}/content`,
          ),
        })
      }
      if (relationship.status !== undefined) {
        claims.push({
          id: `${id}~status`,
          subject: id,
          predicate: 'yarramate/lifecycle/status',
          object: { value: relationship.status },
          origin: 'declared',
          source: location(
            ['relationships', index, 'status'],
            `/relationships/${index}/status`,
          ),
        })
      }
      for (const [referenceIndex, reference] of (
        relationship.references ?? []
      ).entries()) {
        claims.push({
          id: `${id}~reference-${reference.id}`,
          subject: id,
          predicate: 'yarramate/reference/refers-to',
          object: {
            ref: qualifyReference(value.id, reference.ref),
          },
          origin: 'declared',
          source: location(
            ['relationships', index, 'references', referenceIndex, 'ref'],
            `/relationships/${index}/references/${referenceIndex}/ref`,
          ),
        })
      }
      for (const [stateIndex, state] of (
        relationship.presentIn ?? []
      ).entries()) {
        const stateIdentity = qualifyReference(value.id, state)
        claims.push({
          id: presenceClaimId(id, stateIdentity),
          subject: id,
          predicate: 'yarramate/state/present-in',
          object: { ref: stateIdentity },
          origin: 'declared',
          source: location(
            ['relationships', index, 'presentIn', stateIndex],
            `/relationships/${index}/presentIn/${stateIndex}`,
          ),
        })
      }
    }
  }

  const wholePartByEndpoints = new Map<
    string,
    Array<{
      readonly id: string
      readonly localId: string
      readonly document: string
      readonly kind: 'composition' | 'aggregation'
      readonly states: ReadonlySet<string>
    }>
  >()
  const wholePartRelationships = documents
    .flatMap(({ value, location }) =>
      value.relationships.flatMap((relationship, index) =>
        relationship.kind === 'composition' ||
        relationship.kind === 'aggregation'
          ? [
              {
                id: `${value.id}#${relationship.id}`,
                localId: relationship.id,
                document: value.id,
                kind: relationship.kind as 'composition' | 'aggregation',
                from: qualifyReference(value.id, relationship.from),
                to: qualifyReference(value.id, relationship.to),
                states: new Set(
                  (relationship.presentIn ?? []).map((state) =>
                    qualifyReference(value.id, state),
                  ),
                ),
                source: location(
                  ['relationships', index, 'kind'],
                  `/relationships/${index}/kind`,
                ),
              },
            ]
          : [],
      ),
    )
    .sort(compareById)

  for (const relationship of wholePartRelationships) {
    const endpointKey = `${relationship.from}\u0000${relationship.to}`
    const previousRelationships = wholePartByEndpoints.get(endpointKey) ?? []
    const previous = previousRelationships.find(
      (candidate) =>
        candidate.kind !== relationship.kind &&
        (candidate.states.size === 0 ||
          relationship.states.size === 0 ||
          [...candidate.states].some((state) =>
            relationship.states.has(state),
          )),
    )
    if (previous !== undefined) {
      const currentName =
        previous.document === relationship.document
          ? relationship.localId
          : relationship.id
      const previousName =
        previous.document === relationship.document
          ? previous.localId
          : previous.id
      diagnostics.push({
        severity: 'error',
        code: 'YM501',
        message: `Relationship "${currentName}" contradicts "${previousName}": the same endpoints cannot be both aggregation and composition`,
        path: relationship.source.path,
        pointer: relationship.source.pointer,
        line: relationship.source.line,
        column: relationship.source.column,
      })
    }
    previousRelationships.push(relationship)
    wholePartByEndpoints.set(endpointKey, previousRelationships)
  }

  if (diagnostics.length > 0) {
    return diagnosticFailure(diagnostics)
  }

  return {
    ok: true,
    profileContext: {
      conceptKindLineages: immutableMap(
        [...conceptKindByIdentity]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([identity, kind]) => [
            identity,
            Object.freeze([...kind.lineage]),
          ] as const),
      ),
      relationshipKindLineages: immutableMap(
        [...relationshipKindByIdentity]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([identity, kind]) => [
            identity,
            Object.freeze([...kind.lineage]),
          ] as const),
      ),
      conceptKindLayers: immutableMap(
        [...conceptKindByIdentity]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([identity, kind]) => [identity, kind.layer] as const),
      ),
      conceptKindAspects: immutableMap(
        [...conceptKindByIdentity]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([identity, kind]) => [identity, kind.aspect] as const),
      ),
      relationshipKindEndpointAspects: immutableMap(
        [...relationshipKindByIdentity]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([identity, kind]) => [
            identity,
            Object.freeze({
              ...(kind.sourceAspects === undefined
                ? {}
                : { source: Object.freeze([...kind.sourceAspects]) }),
              ...(kind.targetAspects === undefined
                ? {}
                : { target: Object.freeze([...kind.targetAspects]) }),
            }) as RelationshipEndpointAspects,
          ] as const),
      ),
    },
    graph: {
      format: 'yarramate/graph/v2',
      profiles: [
        ...new Set(
          documents.flatMap(
            ({ value }) => profiles.get(value.profile)?.lineage ?? [],
          ),
        ),
      ].sort(),
      documents: documents
        .map(({ input, value }) => ({ id: value.id, source: input.path }))
        .sort(compareById),
      subjects: subjects.sort(compareById),
      claims: claims.sort(compareById),
    },
  }
}

export function compileWorkspace(
  sources: readonly WorkspaceSource[],
): CompilationResult {
  const result = compileWorkspaceResolved(parseSources(sources).parsed)
  return result.ok ? { ok: true, graph: result.graph } : result
}

export const compileWorkspaceWithProfileContext = (
  sources: readonly WorkspaceSource[],
): ContextualCompilationResult =>
  compileWorkspaceResolved(parseSources(sources).parsed)

/**
 * Compiles the whole workspace, reusing the YAML parse of every source whose
 * text is unchanged since `previous`. The compiled output is byte-identical to
 * {@link compileWorkspaceWithProfileContext} for the same sources: the cache
 * holds parse results only, and every cross-document decision is re-derived.
 *
 * Hold the returned `cache` and pass it to the next call. It retains one
 * composed value per current source and drops sources that left the workspace.
 */
export const compileWorkspaceIncremental = (
  sources: readonly WorkspaceSource[],
  previous?: CompilationCache,
): IncrementalCompilationResult => {
  const { parsed, cache, reused } = parseSources(sources, previous)
  return {
    ...compileWorkspaceResolved(parsed),
    incremental: reused > 0,
    cache,
  }
}
