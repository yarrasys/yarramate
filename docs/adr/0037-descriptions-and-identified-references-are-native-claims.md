# Descriptions and identified references are native claims

Status: accepted

## Context

The first native format allowed descriptions only on concepts. Architectural
rationale attached to an interaction therefore had no truthful home: moving
it onto either endpoint changed what the prose was about. Prose also commonly
cites one normative subject from another. Leaving those citations as ID-like
characters made renamed or removed targets undetectable.

Dynamic LikeC4 views exposed a related pressure. Interaction steps may need
rationale, conditions, and failure consequences, but making adapter-owned step
order into Core workflow semantics would reverse ADR 0034 and introduce
completeness and logical-equivalence rules that YarraMate does not define.

The adoption evidence is recorded in issues 9, 10, and 11. This decision uses
original YarraMate wording and does not reproduce external-language
definitions or derivation rules.

## Decision

Both concepts and relationships may declare a non-empty `description`.
Descriptions compile into stable claims:

- concept: `<subject>~description` with
  `yarramate/concept/description`;
- relationship: `<subject>~description` with
  `yarramate/relationship/description`.

A description is narrative architectural meaning about its subject. Its text
is opaque to Core. Evidence may target the stable claim ID, but Core does not
parse conditions, IDs, rules, or logical implications from the text.

Concepts and relationships may also declare `references`, a list of closed
`{id, ref}` records. Each entry compiles to
`<subject>~reference-<id>` with predicate
`yarramate/reference/refers-to` and a globally qualified subject reference as
its object. The target may be any concept, architecture-state, or relationship
subject supplied to the workspace compiler.

Reference IDs are unique within their authored subject and preserve claim
identity across list reordering. Core rejects dangling targets and duplicates.
An identified reference is a citation only; it does not imply ownership,
constraint, dependency, realization, ordering, or approval.

LikeC4 may render relationship descriptions on logical relationships and
dynamic steps and may retain identified references as flat traceability
metadata. Dynamic step order remains adapter presentation. A flow that needs
native identity uses behavior concepts and native relationships for normal and
failure paths. Core checks those structures and explicit references, not
workflow completeness or prose equivalence.

## Consequences

- Rationale can be attached to the exact relationship it describes and
  evaluated through its stable description claim.
- Cross-subject citations become resolvable and reverse-queryable without
  introducing inline prose markup.
- Graph v2 remains structurally unchanged; the new predicates fit its existing
  extensible claim envelope under ADR 0011.
- Routine YAML and CLI authoring remain concise and closed.
- YarraMate does not become a workflow engine, formal-logic evaluator, or
  metadata dumping ground.
