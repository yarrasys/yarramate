# Constraint assessment uses evidence overlays

YarraMate Core records constraints as declared architectural intent and does
not execute a policy language or decide whether constraints are satisfied.
An evidence provider may assess a stable constraint claim and report
`confirmed`, `contradicted`, `unknown`, or `not-observed` through the existing
evidence-overlay contract. This keeps deterministic correctness separate from
architectural policy, provider execution, missing-evidence interpretation, and
CI consequences.

## Status

Accepted.

## Consequences

Core gains no rule evaluator, waiver model, exception workflow, or compliance
status. A provider-specific adapter may translate external policy results into
evidence observations, while an opt-in consumer may independently decide how
those reports affect CI.

This decision uses original YarraMate wording and follows the product
contract's claim-centred Core, adapter independence, and Git-governance
boundaries.
