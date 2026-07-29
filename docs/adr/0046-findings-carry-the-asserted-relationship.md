# Findings carry the asserted relationship

Status: accepted

A reconciliation finding used to name the disputed claim and quote the
evidence locator, which describes what was observed — never what the model
asserts. Reviewers and agents therefore read contradictions as reconciler
false positives, because the disagreement itself was not visible in the
finding.

When a finding targets the primary claim of a declared relationship, the
report now also renders that assertion: an optional `asserted` object with
the declared `from`, `to`, and `kind`, plus `name` when present, taken
verbatim from the compiled graph. Subject-targeted findings and relationship
sub-claims (name, description, status, and similar) are unchanged, because a
concept or attribute has no endpoint rendering that is equally cheap and
coherent.

The field is additive within `yarramate/reconciliation-report/v1`; existing
consumers keep working. It restates declared intent for contrast and remains
advisory: no replacement claim is proposed, no document is mutated, and no
remediation is authorized (ADR 0032).
