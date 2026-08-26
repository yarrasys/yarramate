import Ajv2020Import from 'ajv/dist/2020.js'
import type Ajv2020Type from 'ajv/dist/2020.js'
import { LineCounter, parse, parseDocument } from 'yaml'
import {
  conceptKinds,
  relationshipPolicies,
  type Aspect,
  type Layer,
  type RelationshipKind,
  type Rigidity,
} from './profile.js'
import {
  isCoreConceptKindId,
  matrixEndpointAspects,
  permittedRelationshipKinds as tablePermittedKinds,
  type CoreConceptKindId,
} from './relationship-matrix.js'
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
import patternSchema from '../schema/yarramate-pattern.schema.json' with {
  type: 'json',
}
import { ATTESTATION_PREDICATE_PREFIX, attestationClaimValue } from './graph-claims.js'
import {
  shippedPolicyIdentity,
  shippedPolicySource,
} from './shipped-profile.js'

const coreProfile = 'yarramate/core@0.1'
// `ajv/dist/2020.js` is CJS, and its default-export shape is resolved
// differently under this repo's two tsconfigs: NodeNext (root) sees the raw
// `module.exports` (needs `.default`), Bundler+esModuleInterop
// (tsconfig.visual.json) sees the already-unwrapped class. The `??` picks
// whichever arrived; the type is normalized the same way.
//
// A STATIC import, never `createRequire`. A bundler cannot follow
// `createRequire`, so loading Ajv that way put `(0, cre.createRequire)(...)`
// into the browser bundle, where it is not a function - which is exactly how
// this module became unimportable from a browser, and why the editor could
// only ever run behind a Node process (#252).
type Ajv2020Ctor = typeof Ajv2020Type extends { default: infer D } ? D : typeof Ajv2020Type
const ajv2020Module = Ajv2020Import as unknown as {
  default?: Ajv2020Ctor
} & Ajv2020Ctor
const Ajv2020 = ajv2020Module.default ?? ajv2020Module
const validateDocument = new Ajv2020({ allErrors: true }).compile(documentSchema)
const validateProfile = new Ajv2020({ allErrors: true }).compile(profileSchema)
const validatePattern = new Ajv2020({ allErrors: true }).compile(patternSchema)

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
  /**
   * The subjects this diagnostic is about, most relevant first, when its
   * pointer names one. A consumer that draws the model - a canvas badging the
   * element a rule refused - needs the subject, not the byte offset, and the
   * rules already knew it: YM404 interpolates both endpoint ids into its own
   * message.
   *
   * Absence is meaningful and is not the same as "not yet populated". These
   * are derived in one place from the pointer, so every diagnostic that names
   * a concept or a relationship carries them, and the ones that stay empty are
   * exactly the ones that belong to no subject: a YAML parse failure, a
   * whole-document schema violation, a projection's own definition, a
   * manifest. A consumer can therefore treat an empty list as "this belongs
   * somewhere other than the canvas" rather than as missing data.
   */
  readonly subjects?: readonly string[]
}

interface NativeConcept {
  readonly id: string
  readonly kind: string
  readonly name: string
  readonly description?: string
  readonly aka?: readonly string[]
  readonly status?: 'planned' | 'current' | 'retired'
  readonly owner?: string
  readonly folder?: string
  /**
   * The subjects that fill this instance's pattern slots (#268, ADR 0123).
   * Only a kind with a pattern may carry it; the compiler mints the pattern's
   * wiring between the instance and what these name.
   */
  readonly parts?: Readonly<Record<string, string>>
  readonly distinctFrom?: readonly string[]
  readonly supersedes?: readonly NativeSuccession[]
  readonly constraints?: ReadonlyArray<{
    readonly id: string
    readonly ref: string
    readonly expects?: NativeExpectedObservation
  }>
  /**
   * Relationship shapes this subject rules out, checked against the graph.
   *
   * A constraint nothing tests is a comment: it reads like a rule, survives
   * review because the prose is true, and never once contradicts the model it
   * is attached to (ADR 0108). Deliberately narrow: forbid a relationship kind
   * between named endpoints, with exceptions. That covers "everything goes
   * through X", the most common architectural rule anyone writes, and needs no
   * traversal, so it stays inside the no-derivation boundary of ADR 0003.
   */
  readonly forbids?: ReadonlyArray<{
    readonly relationship: string
    readonly from?: string
    readonly to?: string
    readonly exceptFrom?: readonly string[]
    readonly exceptTo?: readonly string[]
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

/**
 * A structural pattern document, `yarramate/pattern/v1` (#268, ADR 0123): the
 * shape a concept kind promises. Ajv-validated before any of this is read.
 */
interface NativePatternPart {
  readonly kind: string
  readonly required?: boolean
}

interface NativePatternWire {
  readonly from: string
  readonly kind: string
  readonly to: string
}

interface NativePatternShape {
  readonly kind: string
  readonly parts: Readonly<Record<string, NativePatternPart>>
  readonly wiring: readonly NativePatternWire[]
}

interface NativePattern {
  readonly format: 'yarramate/pattern/v1'
  readonly id: string
  readonly version: string
  readonly patterns: readonly NativePatternShape[]
}

interface ResolvedSlot {
  readonly name: string
  readonly kindIdentity: string
  readonly required: boolean
}

interface ResolvedWire {
  /** A slot name, or `self` for the instance. */
  readonly from: string
  readonly to: string
  readonly kindIdentity: string
  readonly coreKind: RelationshipKind
}

interface ResolvedPattern {
  readonly kindIdentity: string
  /** The document that declared it, named when a second one tries to. */
  readonly declaredBy: string
  readonly slots: ReadonlyMap<string, ResolvedSlot>
  readonly wiring: readonly ResolvedWire[]
}

/**
 * One instance of a pattern, collected while its document is read and expanded
 * once every document has been, because expansion has to see the whole
 * workspace: what a slot binds may be declared anywhere, and whether an
 * authored relationship already says what the wiring says is a question about
 * every document at once.
 */
interface PatternInstance {
  readonly instance: string
  readonly pattern: ResolvedPattern
  readonly bindings: ReadonlyMap<string, string>
  /** Where each binding was written, so a minted claim points at a real line. */
  readonly sourceOf: ReadonlyMap<string, GraphSource>
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
  /**
   * The core relationship kind this one resolves to: `lineage[0]`'s local
   * id, which is the letter the relationship table is read by.
   */
  readonly coreKind: RelationshipKind
  /**
   * Declared narrowing on an extension kind only. Core kinds carry none:
   * the table already says which pairs they may join.
   */
  readonly sourceAspects?: readonly (typeof conceptKinds)[number]['aspect'][]
  readonly targetAspects?: readonly (typeof conceptKinds)[number]['aspect'][]
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

// The aspects a relationship kind may carry at each endpoint, resolved
// through profile lineage: an extension's declared narrowing where it has
// one, otherwise the shadow the ArchiMate relationship table casts on the
// aspect axis. Both sides are always present now that every kind is
// constrained by the table (ADR 0097); the coarse aspect view survives
// because extension profiles still narrow in those terms (YM412).
export interface RelationshipEndpointAspects {
  readonly source: readonly Aspect[]
  readonly target: readonly Aspect[]
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
  /** Kind identity -> the core kind it resolves to through lineage. */
  readonly conceptKindCoreAncestors: ReadonlyMap<string, CoreConceptKindId>
  readonly relationshipKindCoreAncestors: ReadonlyMap<string, RelationshipKind>
  /**
   * The core relationship kinds the ArchiMate table permits between two
   * concept kind identities, resolved through lineage; undefined when either
   * identity is unknown. An extension relationship kind's own narrowing is
   * not applied here: read `relationshipKindEndpointAspects` for that.
   */
  readonly permittedRelationshipKinds: (
    fromKindIdentity: string,
    toKindIdentity: string,
  ) => ReadonlySet<RelationshipKind> | undefined
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
  readonly kind: 'profile' | 'document' | 'pattern'
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

const utf8Encoder = new TextEncoder()

const utf8Hex = (value: string): string => {
  let hex = ''
  for (const byte of utf8Encoder.encode(value)) {
    hex += byte.toString(16).padStart(2, '0')
  }
  return hex
}

const presenceClaimId = (subject: string, state: string) =>
  `${subject}~present-in-${utf8Hex(state)}`

// Alternative labels and distinctness records are unordered sets, not
// authored lists with ids. Hex-encoding the value the way presence
// encodes its state keeps the claim id derived from content rather than
// position, so reordering the YAML leaves the graph byte-identical.
const aliasClaimId = (subject: string, alias: string) =>
  `${subject}~alias-${utf8Hex(alias)}`

const distinctFromClaimId = (subject: string, other: string) =>
  `${subject}~distinct-from-${utf8Hex(other)}`

/**
 * A succession entry: a bare predecessor id, or one with the respect in which
 * it was superseded.
 *
 * The scope is load-bearing rather than decorative. A model claimed that Zoekt
 * superseded the Elasticsearch indexer, unqualified, while the source it was
 * built from says Zoekt "handles only code search and does not replace
 * Elasticsearch". The prose carried the qualifier and the field could not, and
 * `ask --compare` reads the field, so the declared target architecture became
 * the deletion of a component that is not being deleted (ADR 0109).
 */
export type NativeSuccession =
  | string
  | { readonly subject: string; readonly inRespectOf: string }

export const successionSubject = (entry: NativeSuccession): string =>
  typeof entry === 'string' ? entry : entry.subject

export const successionScope = (
  entry: NativeSuccession,
): string | undefined =>
  typeof entry === 'string' ? undefined : entry.inRespectOf

const supersedesClaimId = (subject: string, predecessor: string) =>
  `${subject}~supersedes-${utf8Hex(predecessor)}`

export {
  ATTESTATION_PREDICATE_PREFIX,
  attestationClaimValue,
  parseAttestationClaimValue,
  parseConstraintExpectsValue,
  type AttestationClaimParts,
  type ConstraintExpectsParts,
} from './graph-claims.js'

const localKindId = (identity: string): string =>
  identity.slice(identity.indexOf('#') + 1)

// Candidate order is the resolved kind map's insertion order: core kinds
// first, then extension kinds as declared. Scoped to the selected profile
// (ADR 0079), so a profile nobody selected never surfaces here. A candidate
// has to clear both the table and any narrowing the kind declares, or the
// suggestion would be the next rejection.
const permittedCandidates = (
  kinds: ReadonlyMap<string, ResolvedRelationshipKind>,
  rejected: string,
  permitted: ReadonlySet<RelationshipKind>,
  sourceAspect: Aspect,
  targetAspect: Aspect,
): string[] =>
  [...kinds]
    .filter(
      ([id, kind]) =>
        id !== rejected &&
        permitted.has(kind.coreKind) &&
        (kind.sourceAspects?.includes(sourceAspect) ?? true) &&
        (kind.targetAspects?.includes(targetAspect) ?? true),
    )
    .map(([id]) => id)

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
  if (yaml.get('format') === 'yarramate/pattern/v1') {
    return {
      entry: {
        source: input.source,
        kind: 'pattern',
        value,
        schemaDiagnostics: parseDiagnostics,
        positions: new Map(),
      },
      fresh,
    }
  }

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

// Resolves each diagnostic's subject from the pointer it already carries, so
// the rules themselves stay unchanged and no construction site has to remember
// to name what it refused.
//
// A pointer into a document reads `/concepts/<n>/...` or
// `/relationships/<n>/...`, and `<n>` indexes the authored array, so the id is
// one lookup away in the same parsed value the diagnostic was located against.
// Pointers are positional - inserting a concept shifts every index below it -
// which is exactly why this is done here, against the parse that produced the
// diagnostic, rather than by a consumer against whatever it holds later.
//
// Anything else keeps no subjects: a parse failure, a whole-document schema
// violation, a manifest, a projection's own definition. That absence is the
// signal a consumer needs, so it is left empty rather than guessed at.
const subjectsForPointer = (
  pointer: string,
  documentValue: unknown,
): readonly string[] => {
  const match = /^\/(concepts|relationships)\/(\d+)(?:\/|$)/.exec(pointer)
  if (match === null) return []
  const value = documentValue as
    | { readonly id?: unknown; readonly [key: string]: unknown }
    | undefined
  const documentId = typeof value?.id === 'string' ? value.id : undefined
  if (documentId === undefined) return []
  const items = value?.[match[1]!]
  if (!Array.isArray(items)) return []
  const item = items[Number(match[2])] as { readonly id?: unknown } | undefined
  return typeof item?.id === 'string' ? [item.id] : []
}

export const withDiagnosticSubjects = (
  diagnostics: readonly Diagnostic[],
  sources: readonly WorkspaceSource[],
): readonly Diagnostic[] => {
  if (diagnostics.length === 0) return diagnostics
  // Only the documents something was actually said about are parsed, and each
  // at most once: a clean workspace pays nothing, and a workspace refused on
  // one document does not pay for the rest.
  const wanted = new Set(diagnostics.map((diagnostic) => diagnostic.path))
  const valueByPath = new Map<string, unknown>()
  for (const source of sources) {
    if (!wanted.has(source.path)) continue
    try {
      valueByPath.set(source.path, parse(source.source))
    } catch {
      // A source that will not parse is exactly one whose diagnostics belong
      // to no subject, so failing to read it here is the right answer.
    }
  }
  return diagnostics.map((diagnostic) => {
    if (diagnostic.subjects !== undefined) return diagnostic
    const subjects = subjectsForPointer(
      diagnostic.pointer,
      valueByPath.get(diagnostic.path),
    )
    return subjects.length === 0 ? diagnostic : { ...diagnostic, subjects }
  })
}

function compileWorkspaceResolved(
  parsed: readonly ParsedSource[],
): ContextualCompilationResult {
  const profileInputs: ParsedSource[] = []
  const patternInputs: ParsedSource[] = []
  const documentInputs: ParsedSource[] = []
  for (const source of parsed) {
    if (source.entry.kind === 'profile') {
      profileInputs.push(source)
    } else if (source.entry.kind === 'pattern') {
      patternInputs.push(source)
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
      coreKind: policy.id,
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

  const alreadyDeclaresPolicy = pendingProfiles.some(
    ({ identity }) => identity === shippedPolicyIdentity,
  )
  if (!alreadyDeclaresPolicy) {
    const selected = documentInputs.some(({ entry }) => {
      const value = entry.value as { readonly profile?: unknown }
      return value.profile === shippedPolicyIdentity
    })
    const extended = pendingProfiles.some(
      ({ value }) => value.extends === shippedPolicyIdentity,
    )
    if (selected || extended) {
      const input = {
        path: 'yarramate:profile:yarramate/policy@0.1',
        source: shippedPolicySource,
      }
      const { entry, fresh } = parseWorkspaceSource(input)
      const value = entry.value as NativeProfile
      if (entry.schemaDiagnostics.length > 0) {
        profileDiagnostics.push(...entry.schemaDiagnostics)
      } else if (!validateProfile(value)) {
        for (const error of validateProfile.errors ?? []) {
          profileDiagnostics.push({
            severity: 'error',
            code: 'YM201',
            message: `Profile schema violation: ${describeSchemaViolation(error)}`,
            path: input.path,
            pointer: error.instancePath || '/',
            line: 1,
            column: 1,
          })
        }
      } else {
        pendingProfiles.push({
          input,
          value,
          identity: shippedPolicyIdentity,
          positionFor: positionReader(input.source, entry.positions, fresh),
        })
      }
    }
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
          // A parent that declares no narrowing is bounded by the table:
          // an extension may not admit an aspect its core ancestor can never
          // carry at that end.
          const inherited =
            parent[field] ??
            [...matrixEndpointAspects(parent.coreKind, endpoint)]
          if (
            declared !== undefined &&
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
          coreKind: parent.coreKind,
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

  /**
   * Which core relationship kinds the vendored 3.2 table permits between two
   * resolved concept kinds, or `undefined` where either side is an extension
   * whose core ancestor is not a core kind. The same rule `profileContext`
   * publishes below; needed here because a pattern's legality is decided
   * before any document is read.
   */
  const permittedBetween = (
    fromKindIdentity: string,
    toKindIdentity: string,
  ): ReadonlySet<RelationshipKind> | undefined => {
    const from = conceptKindByIdentity.get(fromKindIdentity)
    const to = conceptKindByIdentity.get(toKindIdentity)
    if (from === undefined || to === undefined) return undefined
    const fromCore = localKindId(from.lineage[0] ?? from.identity)
    const toCore = localKindId(to.lineage[0] ?? to.identity)
    return isCoreConceptKindId(fromCore) && isCoreConceptKindId(toCore)
      ? new Set(tablePermittedKinds(fromCore, toCore))
      : undefined
  }

  // ---- structural patterns (#268, ADR 0123) --------------------------------
  //
  // Resolved here, after the profiles they name and before the documents that
  // instantiate them. A pattern declares the shape a kind promises: the slots
  // an instance binds and the wiring the compiler mints between them. Faults
  // in the pattern itself are reported ONCE, against the pattern, rather than
  // once per instance - including whether the wiring it describes is legal
  // ArchiMate at all, which is a property of the slot kinds and so knowable
  // without any instance.
  const patternDiagnostics: Diagnostic[] = []
  const patternsByKind = new Map<string, ResolvedPattern>()
  for (const { input, entry, fresh } of patternInputs) {
    const value = entry.value as NativePattern
    const positionFor = positionReader(input.source, entry.positions, fresh)
    const at = (
      yamlPath: readonly (string | number)[],
      pointer: string,
    ): Pick<Diagnostic, 'path' | 'pointer' | 'line' | 'column'> => {
      const position = positionFor(yamlPath)
      return {
        path: input.path,
        pointer,
        line: position.line,
        column: position.col,
      }
    }
    if (entry.schemaDiagnostics.length > 0) {
      patternDiagnostics.push(...entry.schemaDiagnostics)
      continue
    }
    if (!validatePattern(value)) {
      for (const error of validatePattern.errors ?? []) {
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
          .map((segment) => (/^\d+$/.test(segment) ? Number(segment) : segment))
        patternDiagnostics.push({
          severity: 'error',
          code: 'YM201',
          message: describeSchemaViolation(error),
          ...at(yamlPath, pointer),
        })
      }
      continue
    }
    for (const [index, pattern] of value.patterns.entries()) {
      const anchor = conceptKindByIdentity.get(pattern.kind)
      if (anchor === undefined) {
        patternDiagnostics.push({
          severity: 'error',
          code: 'YM401',
          message: `Concept kind "${pattern.kind}" is not available to this pattern`,
          ...at(['patterns', index, 'kind'], `/patterns/${index}/kind`),
        })
        continue
      }
      const existing = patternsByKind.get(pattern.kind)
      if (existing !== undefined) {
        patternDiagnostics.push({
          severity: 'error',
          code: 'YM411',
          message: `Concept kind "${pattern.kind}" already has a pattern, declared by "${existing.declaredBy}"; a kind has at most one shape`,
          ...at(['patterns', index, 'kind'], `/patterns/${index}/kind`),
        })
        continue
      }
      const slots = new Map<string, ResolvedSlot>()
      let slotsOk = true
      for (const [slot, part] of Object.entries(pattern.parts)) {
        const kind = conceptKindByIdentity.get(part.kind)
        if (kind === undefined) {
          patternDiagnostics.push({
            severity: 'error',
            code: 'YM401',
            message: `Concept kind "${part.kind}" is not available to the "${slot}" part`,
            ...at(
              ['patterns', index, 'parts', slot, 'kind'],
              `/patterns/${index}/parts/${slot}/kind`,
            ),
          })
          slotsOk = false
          continue
        }
        slots.set(slot, {
          name: slot,
          kindIdentity: kind.identity,
          required: part.required === true,
        })
      }
      if (!slotsOk) continue
      // `self` is the instance, so it is spelled apart from the slots and can
      // never be one: a slot named `self` would make the wiring ambiguous
      // about which end it meant.
      if (slots.has('self')) {
        patternDiagnostics.push({
          severity: 'error',
          code: 'YM201',
          message: `A part cannot be named "self"; "self" names the instance itself in wiring`,
          ...at(['patterns', index, 'parts'], `/patterns/${index}/parts`),
        })
        continue
      }
      const kindOfEndpoint = (endpoint: string): string | undefined =>
        endpoint === 'self' ? anchor.identity : slots.get(endpoint)?.kindIdentity
      const wiring: ResolvedWire[] = []
      let wiringOk = true
      const seenWires = new Set<string>()
      for (const [wireIndex, wire] of pattern.wiring.entries()) {
        const wireAt = at(
          ['patterns', index, 'wiring', wireIndex],
          `/patterns/${index}/wiring/${wireIndex}`,
        )
        const fromKind = kindOfEndpoint(wire.from)
        const toKind = kindOfEndpoint(wire.to)
        for (const [end, endpoint, kind] of [
          ['from', wire.from, fromKind],
          ['to', wire.to, toKind],
        ] as const) {
          if (kind !== undefined) continue
          patternDiagnostics.push({
            severity: 'error',
            code: 'YM302',
            message: `Wiring names "${endpoint}" as its ${end}, which is neither "self" nor a declared part`,
            ...wireAt,
          })
          wiringOk = false
        }
        if (wire.from === wire.to) {
          patternDiagnostics.push({
            severity: 'error',
            code: 'YM201',
            message: `Wiring joins "${wire.from}" to itself`,
            ...wireAt,
          })
          wiringOk = false
        }
        const policy = relationshipKindByIdentity.get(wire.kind)
        if (policy === undefined) {
          patternDiagnostics.push({
            severity: 'error',
            code: 'YM402',
            message: `Relationship kind "${wire.kind}" is not available to this pattern`,
            ...wireAt,
          })
          wiringOk = false
        }
        if (fromKind === undefined || toKind === undefined || policy === undefined) {
          continue
        }
        const duplicate = `${wire.from}\u0000${wire.kind}\u0000${wire.to}`
        if (seenWires.has(duplicate)) {
          patternDiagnostics.push({
            severity: 'error',
            code: 'YM201',
            message: `Wiring repeats "${wire.from}" ${policy.coreKind} "${wire.to}"`,
            ...wireAt,
          })
          wiringOk = false
          continue
        }
        seenWires.add(duplicate)
        // Legality is a property of the PATTERN, because the slot kinds fix
        // both endpoint kinds: a pattern whose wiring the relationship table
        // forbids can never expand legally, and saying so once here beats
        // saying it against every instance that was authored correctly.
        const permitted = permittedBetween(fromKind, toKind)
        if (permitted !== undefined && !permitted.has(policy.coreKind)) {
          patternDiagnostics.push({
            severity: 'error',
            code: 'YM404',
            message:
              `Wiring "${wire.from}" ${policy.coreKind} "${wire.to}" is not permitted between ` +
              `"${fromKind}" and "${toKind}"`,
            ...wireAt,
          })
          wiringOk = false
          continue
        }
        wiring.push({
          from: wire.from,
          to: wire.to,
          kindIdentity: policy.identity,
          coreKind: policy.coreKind,
        })
      }
      if (!wiringOk) continue
      patternsByKind.set(pattern.kind, {
        kindIdentity: pattern.kind,
        declaredBy: input.path,
        slots,
        wiring,
      })
    }
  }

  if (patternDiagnostics.length > 0) {
    return diagnosticFailure(patternDiagnostics)
  }

  const patternInstances: PatternInstance[] = []

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

  // Every `forbids` rule in the workspace, with the subject that declared it.
  // A rule is about the graph, not about who wrote it down, so it is applied
  // wherever it was declared and the message names the declarer (ADR 0108).
  interface ForbidRule {
    readonly declaredBy: string
    readonly relationship: string
    readonly from?: string
    readonly to?: string
    readonly exceptFrom: ReadonlySet<string>
    readonly exceptTo: ReadonlySet<string>
  }
  const forbidRules: ForbidRule[] = []

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
            concept.id,
            {
              concept,
              profile: value.profile,
              document: value.id,
            },
          ] as const,
      ),
    ),
  )
  for (const { value } of documents) {
    for (const concept of value.concepts) {
      for (const rule of concept.forbids ?? []) {
        forbidRules.push({
          declaredBy: concept.id,
          relationship: rule.relationship,
          ...(rule.from === undefined ? {} : { from: rule.from }),
          ...(rule.to === undefined ? {} : { to: rule.to }),
          exceptFrom: new Set(rule.exceptFrom ?? []),
          exceptTo: new Set(rule.exceptTo ?? []),
        })
      }
    }
  }
  // Subject identity is the authored id, unique across the workspace, so a
  // reference resolves as written. Kept as a named step rather than inlined
  // because every reference in the model passes through here, and that is
  // where a future scheme would hook.
  const qualifyReference = (_documentId: string, reference: string) => reference
  const architectureStateIds = new Set(
    documents.flatMap(({ value }) =>
      (value.states ?? []).map((state) => state.id),
    ),
  )
  const subjectIds = new Set(
    documents.flatMap(({ value }) => [
      ...(value.states ?? []).map((state) => state.id),
      ...value.concepts.map((concept) => concept.id),
      ...value.relationships.map(
        (relationship) => relationship.id,
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
                state.id,
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
                concept.id,
                concept.supersedes.map((predecessor) =>
                  qualifyReference(value.id, successionSubject(predecessor)),
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

  // Subject identity is the authored id and carries no document prefix, so an
  // id declared twice anywhere in the workspace names one subject twice. The
  // walk below therefore remembers across documents, not just within one.
  const declaringDocument = new Map<string, string>()
  // A document whose own id is a duplicate (YM303) would collide on every
  // subject it declares, burying the one fault worth acting on under a
  // diagnostic per concept. It is walked for nothing else here.
  const documentIdsSeen = new Set<string>()
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
    const duplicateDocumentId = documentIdsSeen.has(value.id)
    documentIdsSeen.add(value.id)
    for (const declaration of declarations) {
      if (duplicateDocumentId) break
      const firstDeclarer = declaringDocument.get(declaration.id)
      if (firstDeclarer !== undefined) {
        const source = location(declaration.yamlPath, declaration.pointer)
        // Two documents claiming one id is a different fault from one document
        // repeating itself, and it reads differently to whoever has to fix it:
        // the second names a file they may not have open.
        const sameDocument = firstDeclarer === input.path
        diagnostics.push({
          severity: 'error',
          code: sameDocument ? 'YM301' : 'YM314',
          message: sameDocument
            ? `Duplicate ID "${declaration.id}"`
            : `ID "${declaration.id}" is already declared by "${firstDeclarer}"; a subject id is unique across the workspace`,
          path: input.path,
          pointer: declaration.pointer,
          line: source.line,
          column: source.column,
        })
      } else {
        declaringDocument.set(declaration.id, input.path)
      }
    }

    for (const [index, state] of (value.states ?? []).entries()) {
      const stateIdentity = state.id
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
      const subject = state.id
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
        } else if (otherIdentity === concept.id) {
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
        const predecessorIdentity = qualifyReference(
          value.id,
          successionSubject(predecessor),
        )
        const subjectIdentity = concept.id
        if (!conceptByQualifiedId.has(predecessorIdentity)) {
          const source = location(
            ['concepts', index, 'supersedes', supersedesIndex],
            pointer,
          )
          diagnostics.push({
            severity: 'error',
            code: 'YM312',
            message: `Unresolved succession reference "${successionSubject(predecessor)}"`,
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
            message: `Unresolved concept reference "${reference}"${(() => {
              // A reference written the way ids read before 1.0 flattened them
              // (ADR 0099) is not a typo, and the edit distance from
              // `<document>#<local>` to `<local>` is usually past the
              // suggestion threshold, so it would otherwise get no hint at all
              // on the one change most likely to produce it.
              const hash = reference.lastIndexOf('#')
              if (hash !== -1) {
                const local = reference.slice(hash + 1)
                if (
                  conceptByQualifiedId.has(qualifyReference(value.id, local))
                ) {
                  return `; a subject id carries no document prefix since 1.0, and "${local}" exists`
                }
              }
              const suggestion = closestCandidate(
                reference,
                [...conceptByQualifiedId.keys()],
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
      }
      const policy = selectedProfile.relationshipKinds.get(relationship.kind)
      if (policy !== undefined) {
        // Each endpoint resolves to the core kind its declared kind descends
        // from: the ArchiMate relationship table is defined over core kinds,
        // and an extension inherits its parent's row and column (ADR 0097).
        const endpointKind = (reference: string) => {
          const resolvedConcept = conceptByQualifiedId.get(
            qualifyReference(value.id, reference),
          )
          if (resolvedConcept === undefined) return undefined
          const resolvedKind = profiles
            .get(resolvedConcept.profile)
            ?.conceptKinds.get(resolvedConcept.concept.kind)
          if (resolvedKind === undefined) return undefined
          const core = localKindId(
            resolvedKind.lineage[0] ?? resolvedKind.identity,
          )
          return isCoreConceptKindId(core)
            ? { declared: resolvedConcept.concept.kind, core, aspect: resolvedKind.aspect }
            : undefined
        }
        const from = endpointKind(relationship.from)
        const to = endpointKind(relationship.to)
        // An unresolved endpoint was already reported as YM302; nothing more
        // can be said about a pair that does not exist.
        if (from !== undefined && to !== undefined) {
          const permitted = tablePermittedKinds(from.core, to.core)
          const describe = (endpoint: { declared: string; core: string }) =>
            endpoint.declared === endpoint.core
              ? endpoint.core
              : `${endpoint.declared}, a ${endpoint.core}`
          const candidates = permittedCandidates(
            selectedProfile.relationshipKinds,
            relationship.kind,
            permitted,
            from.aspect,
            to.aspect,
          )
          const tail =
            candidates.length === 0
              ? ''
              : `; ArchiMate 3.2 permits: ${candidates.join(', ')}`
          // A declared rule about the graph, checked against the graph. The
          // field is new, so no existing model can violate one: this can only
          // fire on a rule someone deliberately wrote (ADR 0108).
          for (const rule of forbidRules) {
            const kindMatches =
              rule.relationship === relationship.kind ||
              rule.relationship === policy.coreKind
            if (!kindMatches) continue
            if (rule.from !== undefined && rule.from !== relationship.from) {
              continue
            }
            if (rule.to !== undefined && rule.to !== relationship.to) continue
            if (rule.exceptFrom.has(relationship.from)) continue
            if (rule.exceptTo.has(relationship.to)) continue
            const pointer = `/relationships/${index}/kind`
            diagnostics.push({
              severity: 'error',
              code: 'YM415',
              message:
                `Relationship "${relationship.kind}" from "${relationship.from}" ` +
                `to "${relationship.to}" is forbidden by "${rule.declaredBy}"`,
              ...location(['relationships', index, 'kind'], pointer),
            })
          }
          if (!permitted.has(policy.coreKind)) {
            const pointer = `/relationships/${index}/kind`
            const source = location(['relationships', index, 'kind'], pointer)
            const kindLabel =
              relationship.kind === policy.coreKind
                ? `"${relationship.kind}"`
                : `"${relationship.kind}" (${policy.coreKind})`
            diagnostics.push({
              severity: 'error',
              code: 'YM404',
              message: `Relationship ${kindLabel} is not permitted from "${relationship.from}" (${describe(from)}) to "${relationship.to}" (${describe(to)})${tail}`,
              path: input.path,
              pointer,
              line: source.line,
              column: source.column,
            })
          } else {
            // The table permits the pair; an extension kind may still
            // narrow it by aspect, and that narrowing is reported per end.
            for (const endpoint of ['source', 'target'] as const) {
              const reference =
                endpoint === 'source' ? relationship.from : relationship.to
              const aspect = endpoint === 'source' ? from.aspect : to.aspect
              const allowed =
                endpoint === 'source'
                  ? policy.sourceAspects
                  : policy.targetAspects
              if (allowed !== undefined && !allowed.includes(aspect)) {
                const field = endpoint === 'source' ? 'from' : 'to'
                const pointer = `/relationships/${index}/${field}`
                const source = location(
                  ['relationships', index, field],
                  pointer,
                )
                diagnostics.push({
                  severity: 'error',
                  code: 'YM404',
                  message: `Relationship "${relationship.kind}" requires a ${endpoint} with aspect ${allowed.map((entry) => `"${entry}"`).join(' or ')}; "${reference}" has aspect "${aspect}"${tail}`,
                  path: input.path,
                  pointer,
                  line: source.line,
                  column: source.column,
                })
              }
            }
          }
        }
      }
    }

    for (const [index, concept] of value.concepts.entries()) {
      const subject = concept.id
      subjects.push({ id: subject, type: 'concept' })
      // A pattern instance is only COLLECTED here. What its slots bind may be
      // declared in any document, so the bindings cannot be checked until
      // every document has been read (#268, ADR 0123).
      if (concept.parts !== undefined) {
        const kindIdentity =
          selectedProfile.conceptKinds.get(concept.kind)?.identity ??
          concept.kind
        const pattern = patternsByKind.get(kindIdentity)
        if (pattern === undefined) {
          const where = location(
            ['concepts', index, 'parts'],
            `/concepts/${index}/parts`,
          )
          diagnostics.push({
            severity: 'error',
            code: 'YM419',
            message: `Concept "${subject}" declares parts, but kind "${kindIdentity}" has no pattern to bind them to`,
            path: where.path,
            pointer: where.pointer,
            line: where.line,
            column: where.column,
          })
        } else {
          const bindings = new Map<string, string>()
          const sourceOf = new Map<string, GraphSource>()
          for (const [slot, target] of Object.entries(concept.parts)) {
            const where = location(
              ['concepts', index, 'parts', slot],
              `/concepts/${index}/parts/${slot}`,
            )
            if (!pattern.slots.has(slot)) {
              diagnostics.push({
                severity: 'error',
                code: 'YM419',
                message:
                  `Concept "${subject}" binds "${slot}", which the pattern for ` +
                  `"${kindIdentity}" does not declare; its parts are ` +
                  `${[...pattern.slots.keys()].map((name) => `"${name}"`).join(', ')}`,
                path: where.path,
                pointer: where.pointer,
                line: where.line,
                column: where.column,
              })
              continue
            }
            bindings.set(slot, qualifyReference(value.id, target))
            sourceOf.set(slot, where)
          }
          patternInstances.push({
            instance: subject,
            pattern,
            bindings,
            sourceOf,
          })
        }
      }
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
        const predecessorIdentity = qualifyReference(
          value.id,
          successionSubject(predecessor),
        )
        const scope = successionScope(predecessor)
        const successionSource = location(
          ['concepts', index, 'supersedes', supersedesIndex],
          `/concepts/${index}/supersedes/${supersedesIndex}`,
        )
        claims.push({
          id: supersedesClaimId(subject, predecessorIdentity),
          subject,
          predicate: 'yarramate/lineage/supersedes',
          object: { ref: predecessorIdentity },
          origin: 'declared',
          source: successionSource,
        })
        // The respect is a claim of its own rather than a field on the
        // succession claim: `GraphClaim` is a triple, and widening it would
        // widen the published graph schema for one optional string. Its id is
        // the succession claim's, suffixed, so the two correlate.
        if (scope !== undefined) {
          claims.push({
            id: `${supersedesClaimId(subject, predecessorIdentity)}~respect`,
            subject,
            predicate: 'yarramate/lineage/supersedes-respect',
            object: { value: scope },
            origin: 'declared',
            source: successionSource,
          })
        }
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
      if (concept.folder !== undefined) {
        claims.push({
          id: `${subject}~folder`,
          subject,
          predicate: 'yarramate/organisation/folder',
          // A VALUE, not a ref. A folder is a label the author writes, not a
          // subject the workspace declares: nothing can be said about it, it
          // resolves to nothing, and two documents writing the same label mean
          // the same folder without either naming the other (ADR 0104).
          object: { value: concept.folder },
          origin: 'declared',
          source: location(
            ['concepts', index, 'folder'],
            `/concepts/${index}/folder`,
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
      const id = relationship.id
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
                id: relationship.id,
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

  // A junction takes the kind of the relationships that pass through it, so
  // every relationship on one junction must be the same kind (ArchiMate 3.2,
  // junctions). The table cannot say this: it rules on one pair at a time,
  // and this is a property of the set. Sorted by id, so the first-listed
  // relationship's kind is the one the others are measured against and the
  // diagnostic lands on the later ones.
  const junctionKinds: ReadonlySet<string> = new Set([
    'andJunction',
    'orJunction',
  ])
  const junctionRelationships = documents
    .flatMap(({ value, location }) =>
      value.relationships.flatMap((relationship, index) => {
        const policy = profiles
          .get(value.profile)
          ?.relationshipKinds.get(relationship.kind)
        if (policy === undefined) return []
        return (['from', 'to'] as const).flatMap((endpoint) => {
          const junction = qualifyReference(value.id, relationship[endpoint])
          const resolvedConcept = conceptByQualifiedId.get(junction)
          const resolvedKind =
            resolvedConcept === undefined
              ? undefined
              : profiles
                  .get(resolvedConcept.profile)
                  ?.conceptKinds.get(resolvedConcept.concept.kind)
          if (
            resolvedKind === undefined ||
            !junctionKinds.has(
              localKindId(resolvedKind.lineage[0] ?? resolvedKind.identity),
            )
          ) {
            return []
          }
          return [
            {
              id: relationship.id,
              localId: relationship.id,
              junction,
              kind: relationship.kind,
              coreKind: policy.coreKind,
              source: location(
                ['relationships', index, 'kind'],
                `/relationships/${index}/kind`,
              ),
            },
          ]
        })
      }),
    )
    .sort(compareById)
  const relationshipsByJunction = new Map<
    string,
    typeof junctionRelationships
  >()
  for (const entry of junctionRelationships) {
    const group = relationshipsByJunction.get(entry.junction) ?? []
    group.push(entry)
    relationshipsByJunction.set(entry.junction, group)
  }
  for (const [junction, group] of relationshipsByJunction) {
    const expected = group[0]?.coreKind
    if (expected === undefined) continue
    for (const entry of group) {
      if (entry.coreKind === expected) continue
      diagnostics.push({
        severity: 'error',
        code: 'YM414',
        message: `Relationship "${entry.localId}" (${entry.kind}) joins junction "${junction}" whose relationships are "${expected}"; every relationship on one junction must be the same kind`,
        path: entry.source.path,
        pointer: entry.source.pointer,
        line: entry.source.line,
        column: entry.source.column,
      })
    }
  }

  // ---- pattern expansion (#268, ADR 0123) ----------------------------------
  //
  // Every document has been read, so this can see the whole workspace: what a
  // slot binds, what kind that subject is, and whether an authored
  // relationship already says what a wiring edge says. Minted claims are
  // `declared` and sourced to the binding line that produced them, because
  // that is where the author said it - the pattern only says which KIND of
  // edge a bound pair gets.
  if (patternInstances.length > 0) {
    const kindOfSubject = new Map<string, string>()
    for (const claim of claims) {
      if (
        claim.predicate === 'yarramate/concept/kind' &&
        'value' in claim.object
      ) {
        kindOfSubject.set(claim.subject, claim.object.value)
      }
    }
    const declaredIds = new Set(subjects.map(({ id }) => id))
    // Authored relationships indexed by the UNORDERED pair they join, which is
    // the granularity the ownership rule is stated at: the pattern speaks for
    // a pair, so a reversed edge is a contradiction rather than a new fact.
    const pairKey = (left: string, right: string): string =>
      left < right ? `${left}\u0000${right}` : `${right}\u0000${left}`
    const authoredByPair = new Map<
      string,
      Array<{
        readonly id: string
        readonly from: string
        readonly to: string
        readonly predicate: string
        readonly source: GraphSource
      }>
    >()
    const relationshipIds = new Set(
      subjects.filter(({ type }) => type === 'relationship').map(({ id }) => id),
    )
    for (const claim of claims) {
      if (!relationshipIds.has(claim.id) || !('ref' in claim.object)) continue
      const entry = {
        id: claim.id,
        from: claim.subject,
        to: claim.object.ref,
        predicate: claim.predicate,
        source: claim.source,
      }
      const key = pairKey(entry.from, entry.to)
      const group = authoredByPair.get(key)
      if (group === undefined) authoredByPair.set(key, [entry])
      else group.push(entry)
    }

    for (const { instance, pattern, bindings, sourceOf } of patternInstances) {
      const boundTo = new Map<string, string>()
      for (const [slot, target] of bindings) {
        const where = sourceOf.get(slot)
        if (where === undefined) continue
        const slotShape = pattern.slots.get(slot)
        if (slotShape === undefined) continue
        if (!declaredIds.has(target)) {
          diagnostics.push({
            severity: 'error',
            code: 'YM315',
            message: `Part "${slot}" of "${instance}" names "${target}", which is not a declared subject`,
            path: where.path,
            pointer: where.pointer,
            line: where.line,
            column: where.column,
          })
          continue
        }
        const already = boundTo.get(target)
        if (already !== undefined) {
          diagnostics.push({
            severity: 'error',
            code: 'YM315',
            message: `"${instance}" binds "${target}" as both "${already}" and "${slot}"; one subject fills one slot`,
            path: where.path,
            pointer: where.pointer,
            line: where.line,
            column: where.column,
          })
          continue
        }
        boundTo.set(target, slot)
        const actual = kindOfSubject.get(target)
        if (actual !== slotShape.kindIdentity) {
          diagnostics.push({
            severity: 'error',
            code: 'YM417',
            message:
              `Part "${slot}" of "${instance}" binds "${target}", which is ` +
              `"${actual ?? 'not a concept'}"; the pattern declares this part ` +
              `"${slotShape.kindIdentity}"`,
            path: where.path,
            pointer: where.pointer,
            line: where.line,
            column: where.column,
          })
        }
      }
      const instanceSource = [...sourceOf.values()][0]
      for (const slot of pattern.slots.values()) {
        if (!slot.required || bindings.has(slot.name)) continue
        if (instanceSource === undefined) continue
        diagnostics.push({
          severity: 'error',
          code: 'YM416',
          message: `"${instance}" leaves the required part "${slot.name}" unbound`,
          path: instanceSource.path,
          pointer: instanceSource.pointer,
          line: instanceSource.line,
          column: instanceSource.column,
        })
      }

      const subjectOf = (endpoint: string): string | undefined =>
        endpoint === 'self' ? instance : bindings.get(endpoint)
      for (const wire of pattern.wiring) {
        const from = subjectOf(wire.from)
        const to = subjectOf(wire.to)
        // An optional part nobody bound wires nothing. The required ones have
        // already been reported above, so this is silence by design.
        if (from === undefined || to === undefined) continue
        if (!declaredIds.has(from) || !declaredIds.has(to)) continue
        const where =
          sourceOf.get(wire.to === 'self' ? wire.from : wire.to) ??
          instanceSource
        if (where === undefined) continue
        const authored = authoredByPair.get(pairKey(from, to)) ?? []
        let satisfied = false
        for (const edge of authored) {
          if (
            edge.from === from &&
            edge.to === to &&
            edge.predicate === wire.kindIdentity
          ) {
            // Exactly what the wiring says. The authored relationship IS the
            // wiring, so nothing is minted and nothing is reported: adoption
            // costs no edit, and the redundant lines can go later.
            satisfied = true
            continue
          }
          diagnostics.push({
            severity: 'error',
            code: 'YM418',
            message:
              `Relationship "${edge.id}" joins "${edge.from}" to "${edge.to}", a pair ` +
              `the pattern for "${pattern.kindIdentity}" wires as "${from}" ` +
              `${wire.coreKind} "${to}"`,
            path: edge.source.path,
            pointer: edge.source.pointer,
            line: edge.source.line,
            column: edge.source.column,
          })
        }
        if (satisfied) continue
        const wireId = [
          instance,
          ...(wire.from === 'self' ? [] : [wire.from]),
          wire.coreKind,
          wire.to,
        ].join('-')
        if (declaredIds.has(wireId)) {
          diagnostics.push({
            severity: 'error',
            code: 'YM420',
            message:
              `The pattern for "${pattern.kindIdentity}" derives the wiring id ` +
              `"${wireId}" for "${instance}", which is already a declared subject`,
            path: where.path,
            pointer: where.pointer,
            line: where.line,
            column: where.column,
          })
          continue
        }
        declaredIds.add(wireId)
        subjects.push({ id: wireId, type: 'relationship' })
        claims.push({
          id: wireId,
          subject: from,
          predicate: wire.kindIdentity,
          object: { ref: to },
          origin: 'declared',
          source: where,
        })
      }
    }
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
              source: Object.freeze([
                ...(kind.sourceAspects ??
                  matrixEndpointAspects(kind.coreKind, 'source')),
              ]),
              target: Object.freeze([
                ...(kind.targetAspects ??
                  matrixEndpointAspects(kind.coreKind, 'target')),
              ]),
            }) as RelationshipEndpointAspects,
          ] as const),
      ),
      conceptKindCoreAncestors: immutableMap(
        [...conceptKindByIdentity]
          .sort(([left], [right]) => left.localeCompare(right))
          .flatMap(([identity, kind]) => {
            const core = localKindId(kind.lineage[0] ?? identity)
            return isCoreConceptKindId(core)
              ? [[identity, core] as const]
              : []
          }),
      ),
      relationshipKindCoreAncestors: immutableMap(
        [...relationshipKindByIdentity]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([identity, kind]) => [identity, kind.coreKind] as const),
      ),
      permittedRelationshipKinds: (fromKindIdentity, toKindIdentity) => {
        const from = conceptKindByIdentity.get(fromKindIdentity)
        const to = conceptKindByIdentity.get(toKindIdentity)
        if (from === undefined || to === undefined) return undefined
        const fromCore = localKindId(from.lineage[0] ?? from.identity)
        const toCore = localKindId(to.lineage[0] ?? to.identity)
        return isCoreConceptKindId(fromCore) && isCoreConceptKindId(toCore)
          ? tablePermittedKinds(fromCore, toCore)
          : undefined
      },
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
