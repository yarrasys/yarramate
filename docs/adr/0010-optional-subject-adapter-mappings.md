# ADR 0010: Keep adapter subject mappings outside Core

## Status

Accepted

## Context

Native YarraMate documents are canonical, while optional tools may retain
their own element identities. Integrity requires an explicit correspondence,
but adapter-specific fields must not enter native YAML or the compiled
semantic graph. Core must remain useful without LikeC4, Graphify, or another
adapter.

Kind-level compatibility and complete round-tripping require separate
adapter-specific semantics. The first useful seam is stable instance identity.

## Decision

A versioned `yarramate/adapter-mapping/v1` companion document maps globally
qualified native compiled subject identities to opaque external identities.
Every entry declares whether the native subject is a concept or relationship.

The mapping module is separate from the compiler. It validates native subject
existence, subject type agreement, unique versioned mapping identities, and
one-to-one identity within each named adapter across the checked workspace. It
does not emit claims or alter a semantic graph.

The `check` CLI may orchestrate Core compilation and optional mapping
validation in one invocation. `compileWorkspace` remains adapter-independent.
External identity validity belongs to the named adapter.

Coverage is optional: an unmapped native subject is not a correctness error.
Mappings carry no layout, approval, authorship, or governance state.

## Consequences

- Native documents and globally qualified compiled identities remain
  authoritative.
- Adapter configuration stays replaceable and outside the core model.
- Mapping failures receive stable `YM6xx` source-located diagnostics.
- An adapter can validate its opaque identities without changing Core.
- Kind mappings, transformation rules, and round-trip behavior remain separate
  versioned adapter contracts.
- The current LikeC4 prototype can be linked incrementally without making
  YarraMate depend on LikeC4.
