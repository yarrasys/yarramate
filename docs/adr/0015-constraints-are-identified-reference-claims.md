# Constraints are identified reference claims

## Status

Accepted.

## Context

An architectural subject may be governed by several declared constraints.
Routine syntax should remain concise, while compiled claim identities must not
depend on list position or provider-specific rule languages.

## Decision

A native concept may declare a `constraints` list. Each entry contains an
authored local `id`, unique within that list, and a local or globally qualified
`ref` to an existing concept. The compiler emits:

- identity `<subject>~constraint-<id>`;
- predicate `yarramate/constraint/requires`;
- an object reference to the globally qualified constraint subject;
- the source location of the authored `ref`.

Core checks reference existence and local constraint-ID uniqueness. It does
not require a particular target kind, evaluate satisfaction, infer
enforcement, or define exceptions and waivers.

The constraint claim and a `realization` relationship are not alternate
spellings. `constraints` says that its subject is bound by or must satisfy the
referenced rule. `realization` says that its source implements or fulfils a
more abstract target. Use `constraints` for applicability, `realization` for
implementation, and both only when both independent statements are intended.

## Consequences

Multiple constraints remain concise, reorder-safe, and queryable in graph v2.
Profiles can specialize referenced concepts. Future policy or evidence layers
may evaluate constraints without changing declared intent.

## Provenance

This rule is original YarraMate Core wording derived from the product
contract's claim-centred, extensible-profile, and deterministic-validation
boundaries.
