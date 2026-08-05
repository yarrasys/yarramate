# Semantic graph v2 interchange contract

`yarramate/graph/v2` is the normative tool-neutral interchange graph emitted
by the native compiler. Its structural contract is
`schema/yarramate-graph-v2.schema.json`.

## Stable shape

A graph contains:

- `profiles`: the complete versioned profile lineage used by its documents;
- `documents`: stable document identities and source provenance;
- `subjects`: globally qualified concept and relationship identities;
- `claims`: explicit, sourced assertions sorted by claim identity.

Concept and relationship subjects use `<document-id>#<local-id>`. Concept kind
claim values and relationship predicates use
`<profile-id>@<version>#<kind-id>`. File paths never participate in semantic
identity.

Every graph-v2 claim has:

- a stable claim ID and globally qualified subject;
- a predicate;
- exactly one string value or globally qualified reference object;
- the `declared` origin;
- source document, path, YAML pointer, line, and column.

Native ownership uses predicate `yarramate/ownership/owner`. Native constraint
references use `yarramate/constraint/requires`. Both point to globally
qualified concept subjects and use stable claim IDs derived from authored
syntax; neither adds fields to graph v2.

A constraint that declares an expected observation emits one further claim,
`yarramate/constraint/expects`, whose value is
`<provider> <key> <expected value>`. Provider and key admit no whitespace, so
the first two spaces delimit them and the remainder is the expected value
verbatim. It is an ordinary value claim in the existing envelope: no new
field, no new structure, and a consumer that does not know the predicate keeps
reading the graph correctly.

Concept and relationship descriptions use
`yarramate/concept/description` and
`yarramate/relationship/description`. Identified citations use
`yarramate/reference/refers-to`, point to any globally qualified subject, and
derive stable claim IDs from their authored reference IDs. These additions use
the existing claim envelope and do not change graph-v2 structure.

Optional architecture states compile as ordinary globally qualified concept
subjects with Core `plateau` kind. `yarramate/state/type`,
`yarramate/state/after`, and `yarramate/state/present-in` preserve state kind,
acyclic ordering, and subject membership using existing graph-v2 claims.
State-specific claim values are not part of graph v2.

The JSON Schema is structural. Compiler conformance additionally guarantees
referential integrity, unique semantic IDs, known qualified kinds, and the
correctness rules documented for native compilation.

## Canonical serialization

`serializeSemanticGraph(graph)` and `yarramate export graph` emit UTF-8 JSON
with:

- two-space indentation;
- object fields in the order defined by graph v2;
- profiles sorted lexically;
- documents sorted by ID then source;
- subjects sorted by ID then type;
- claims sorted by ID, subject, then predicate;
- one trailing newline.

No generated graph file is required in Git. The same native inputs must produce
byte-identical canonical output regardless of workspace source order.

```sh
yarramate export graph .yarramate/workspace.yaml \
  --out .yarramate-out/graph.v2.json
```

Exit status is `0` with the graph on standard output (or in the `--out`
file), `1` with deterministic correctness diagnostics, or `2` for
invocation and file errors. Adapter
mapping documents are not compiler inputs and do not become part of the graph.

## Compatibility

Graph v2 is stable for the lifetime of the `yarramate/graph/v2` format:

- existing fields will not be removed or reinterpreted;
- required structures will not change;
- canonical ordering and serialization will remain stable;
- a structural or semantic breaking change requires a new graph format, such
  as `yarramate/graph/v3`.

Implementations may fix a compiler defect when existing output violates the
documented v2 contract. New source-language features may emit additional
claims using the existing v2 claim structure. Consumers must interpret
predicates by identity and may ignore predicates they do not understand.

Graph v2 remains declared-only. Provider observations are evaluated through
the separate evidence overlay described in `docs/EVIDENCE.md`; they do not
change graph subjects, claims, or provenance.

The v2 schema is exported as `yarramate/schema/graph-v2`.

## Consuming graph v2 from your own tools

Graph v2 is the intended integration surface for renderers, linters, drift
detectors, and agent harnesses. Consumers need the emitted JSON and the
exported schema; they never need the compiler, the CLI internals, or the
authoring format.

Obtain and validate a graph:

```sh
npx yarramate export graph .yarramate/workspace.yaml --out graph.v2.json
```

Validate against the schema exported as `yarramate/schema/graph-v2` with any
JSON Schema 2020-12 validator.

The complete reading algorithm is: index `claims` by `predicate`, interpret
predicates by identity, and ignore predicates you do not understand. There is
no other structure to learn — every fact in the graph is a claim.

Core claim predicates:

| Predicate | Object | Meaning |
| --- | --- | --- |
| `yarramate/concept/kind` | value | Globally qualified kind of a concept |
| `yarramate/concept/name` | value | Display name |
| `yarramate/concept/description` | value | Narrative meaning claim |
| `yarramate/relationship/name` | value | Display name |
| `yarramate/relationship/description` | value | Narrative meaning claim |
| `yarramate/lifecycle/status` | value | `planned`, `current`, or `retired` |
| `yarramate/ownership/owner` | ref | Accountable concept subject |
| `yarramate/constraint/requires` | ref | Binding constraint subject |
| `yarramate/constraint/expects` | value | Expected observation as `<provider> <key> <expected value>` |
| `yarramate/reference/refers-to` | ref | Identified citation to any subject |
| `yarramate/access/mode` | value | Access mode of an access relationship |
| `yarramate/flow/content` | value | Transferred content of a flow |
| `yarramate/state/type` | value | `baseline`, `transition`, or `target` |
| `yarramate/state/after` | ref | Predecessor architecture state |
| `yarramate/state/present-in` | ref | Subject membership in a state |

Relationship claims use their globally qualified relationship kind directly
as the predicate — for example `yarramate/core@0.1#serving` — with the
`from` concept as `subject` and the `to` concept as `object.ref`. The claim
`id` is the relationship's own subject identity, so relationship metadata
claims attach to it.

Every claim carries its authored source (document, path, pointer, line,
column), so a consumer can cite or deep-link any fact it reports. Consumers
must treat the graph as read-only: derived findings belong in your tool's
own output, or in an evidence overlay if they should flow back into
reconciliation.
