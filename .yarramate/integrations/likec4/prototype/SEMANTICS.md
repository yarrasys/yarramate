# YarraMate semantic contract

The LikeC4 specification defines YarraMate's modeling vocabulary. This document
states how that vocabulary should be used.

## Semantic coordinates

Every concept kind belongs to a layer and, where applicable, an aspect.

| Layer | Purpose |
| --- | --- |
| Motivation | Why change or architecture is needed |
| Strategy | Capabilities, resources, value delivery, and chosen direction |
| Business | Organizational structure, behavior, services, and information |
| Application | Software structure, behavior, services, and data |
| Technology | Runtime structure, behavior, services, and artifacts |
| Physical | Physical structure and material |
| Implementation | Work, deliverables, transitions, plateaus, and gaps |

The cross-layer aspects are:

- **Active structure** — something capable of performing behavior.
- **Behavior** — something that occurs or is made available.
- **Passive structure** — something behavior acts on or produces.
- **Motivation** — a reason, intention, evaluation, requirement, or value.
- **Composite** — grouping, location, or relationship connector.

## Relationships

Use the most specific valid relationship. `association` is the last resort, not
the default.

| Relationship | Meaning in YarraMate |
| --- | --- |
| `composition` | Exclusive or strong whole-part structure |
| `aggregation` | Non-exclusive or weak whole-part structure |
| `assignment` | Allocation of an active structure to behavior, responsibility, or use |
| `realization` | A concrete concept fulfills a more abstract concept |
| `serving` | A service, interface, or behavior is made available to another concept |
| `access` | Behavior or active structure reads, writes, creates, or uses passive structure |
| `influence` | A concept affects motivation; metadata may state direction and strength |
| `association` | Relevant connection for which no stronger semantic relationship applies |
| `triggering` | Temporal or causal precedence between behavior or events |
| `flow` | Transfer of information, value, goods, or material |
| `specialization` | A concept is a more specific form of another concept |

The bundled native profile uses broad aspect restrictions, not an external
kind-to-kind matrix. `assignment` requires an active-structure source;
`access` requires a passive-structure target; `influence` requires a
motivation target; and `triggering` connects behavior. These are deterministic
correctness rules and do not require every concept to participate in any
relationship.

Native `access` relationships may declare a controlled `mode` of `read`,
`write`, `read-write`, or `unspecified`. Native `flow` relationships may
declare non-empty `content`. These values are semantic claims, not rendering
metadata.

A workspace must not claim both `composition` and `aggregation` for the same
ordered endpoints in overlapping architecture states. Strong and weak
whole-part membership are competing claims while their relationship
applicability overlaps. Explicitly disjoint state scopes may express a
whole-part change over time.

## LikeC4 containment

LikeC4 nesting establishes one FQN and one visual parent. Do not use it as a
substitute for `composition` or `aggregation` when the relation itself is part
of the semantic model. Prefer shallow semantic elements connected by typed
relationships; reserve nesting for genuine architectural containment that
should govern navigation and identity.

## Metadata

Use metadata for stable classifications and trace identifiers:

```likec4
metadata {
  layer 'application'
  status 'accepted'
  owner 'platform'
  decisions ['adr-0004']
  requirements ['req-approval-01']
  invariants ['proposal-intent-match']
}
```

Metadata is deliberately flat. Do not embed YAML or JSON documents inside a
metadata string. Promote a concept to an element or relationship when it needs
identity and navigation; use a schema-validated companion artifact when it
needs nested data or executable rules.

## Compatibility

YarraMate uses familiar ArchiMate-inspired concept names to make mappings
legible. Compatibility is recorded concept-by-concept and relationship-by-
relationship; it is not inferred from similar rendering. YarraMate may add
conformance rules or metadata conventions where LikeC4 and ArchiMate have
different structural capabilities.
