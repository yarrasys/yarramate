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

The JSON Schema is structural. Compiler conformance additionally guarantees
referential integrity, unique semantic IDs, known qualified kinds, and the
correctness rules documented for native compilation.

## Canonical serialization

`serializeSemanticGraph(graph)` and `yarramate compile` emit UTF-8 JSON with:

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
yarramate compile profiles/project.yaml architecture/*.yaml > graph.json
```

Exit status is `0` with the graph on standard output, `1` with deterministic
correctness diagnostics, or `2` for invocation and file errors. Adapter
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

The v2 schema is exported as `yarramate/schema/graph-v2`.
