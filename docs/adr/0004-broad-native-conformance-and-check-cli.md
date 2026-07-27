# Establish broad native conformance and the check CLI

Status: accepted

## Context

The product contract requires deterministic correctness checks without making
architectural taste or completeness mandatory. The bundled catalogue already
contains original YarraMate relationship policies expressed through semantic
aspects. The first native compiler also needs a stable CLI surface for people,
CI, skills, and agent harnesses.

## Decision

Core validates relationship endpoints against the broad aspect restrictions in
the selected native profile. It does not embed or reconstruct an external
kind-to-kind relationship matrix. Unrestricted native policies remain valid
between known concepts; restricted policies check only their declared source
and target aspects.

Native relationship syntax adds two controlled fields:

- `mode` on `access`, with `read`, `write`, `read-write`, and `unspecified`;
- `content` on `flow`, as non-empty text.

Each field compiles into a claim about the stable relationship subject. Using
either field on another relationship kind is an error.

The initial contradiction rule rejects declaring both `composition` and
`aggregation` over the same ordered endpoints. This rule means that one
whole-part assertion cannot simultaneously claim strong and weak membership.
No broader architectural consistency inference is implied.

Diagnostics are sorted by source path, line, column, code, and message.
`yarramate check <files...>` returns zero for valid documents, one for
correctness failures, and two for invocation or file errors. `--json` emits a
stable object containing `ok` and the ordered diagnostics. Checking does not
write compiled output.

## Consequences

Core catches useful deterministic errors without judging model completeness or
copying restricted compatibility material. Controlled relationship meaning
cannot leak into a metadata bag. CI and agents receive reproducible output,
while humans receive source-oriented text.

This slice does not add cross-document references, profile discovery,
derivation, evidence, completeness policies, repository discovery, or any
approval workflow. Additional contradiction rules require their own explicit
native semantics and examples.

All rules and wording in this decision originate in YarraMate. Their
provenance is this ADR and the versioned native profile catalogue.
