# Ownership is a singular reference claim

## Status

Accepted.

## Context

Routine authors need a concise way to state accountability without manually
declaring a relationship. Generated claim identities must remain stable under
reordering, and Core must not infer teams, people, approval, or governance.

## Decision

A native concept may declare one optional `owner` reference. The compiler
resolves it with the same local-or-globally-qualified reference rules used by
relationships and emits:

- claim identity `<subject>~owner`;
- predicate `yarramate/ownership/owner`;
- an object reference to the globally qualified owner subject;
- declared origin and the authored `owner` source location.

The owner must exist, but Core does not restrict its concept kind. Ownership
states accountable stewardship only. It grants no approval authority and
introduces no workflow.

Additional responsibility semantics remain expressible through explicit
profile relationship kinds. They are not collapsed into the singular
accountability shorthand.

## Consequences

Common ownership stays concise and deterministically compiled. A document
cannot accidentally create order-dependent ownership claim identities.
Profiles and projections may interpret or select ownership without changing
graph v2.

## Provenance

This rule is original YarraMate Core wording derived from the product
contract's claim-centred, tool-neutral, Git-governed boundaries.
