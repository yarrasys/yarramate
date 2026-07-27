# ADR 0013: Evidence overlays evaluate existing subjects and claims

## Status

Accepted

## Context

Repository, catalogue, test, and runtime providers can observe whether declared
architecture appears true. Native documents remain canonical intent, graph v2
is stable and contains declared claims only, and Core must not depend on
Graphify or another evidence provider.

Allowing arbitrary independent observed claims immediately would create a
second semantic graph, new conflict semantics, and pressure to alter graph v2.

## Decision

YarraMate defines a separate versioned evidence overlay. An observation
evaluates exactly one existing globally qualified subject or stable claim ID
as confirmed, contradicted, unknown, or not observed.

The generic layer validates structure, graph references, target uniqueness,
and evidence document identity. Provider URIs remain opaque. Evaluation emits
a deterministic report and never modifies graph v2.

Observation results do not determine Core validity. A later explicit policy
may interpret reports for CI or completeness. Evidence has no approval or
governance meaning.

Independent observed claims, provider integrations, and provider-specific
fields are deferred.

## Consequences

- Evidence can detect stale or conflicting architecture without becoming
  canonical intent.
- Graph v2 remains unchanged and declared-only.
- Providers remain optional and independently replaceable.
- A contradicted observation is report content rather than an automatic error.
- The first evidence API is deliberately narrower than a general observed
  semantic graph.
