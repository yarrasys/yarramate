# ADR 0009: Validate authoring edits with explicit workspace sources

## Status

Accepted

## Context

The CLI is the stable interface for routine human and agent authoring. Native
documents should remain concise, but a convenience command must not write a
document that the compiler rejects. Extension kinds and qualified references
also require sources beyond the edited document.

Implicit workspace discovery would introduce ordering, directory-layout, and
profile-resolution policy before those policies are designed.

## Decision

`init` creates a minimal Core document and never overwrites an existing one.
`add` and `connect` construct an in-memory candidate, compile it, and replace
the target file only on success. Failed validation leaves the file unchanged.

Required profile documents and related native documents are provided through
repeatable `--source <source.yaml>` options. These inputs form the candidate
workspace with the edited document. No directory search or network resolution
occurs.

The commands emit block-style YAML and retain authored local references.
Compilation continues to produce globally qualified document subject and kind
identities.

## Consequences

- Routine concept and relationship authoring stays concise.
- CI and agents receive the same correctness boundary as direct compiler use.
- Extension-profile and cross-document edits remain deterministic.
- Callers must enumerate dependent sources until a separate discovery contract
  is accepted.
- These commands do not add review, approval, or governance state; Git retains
  those responsibilities.
