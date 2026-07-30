# Reconciliation counts the unobserved

Status: accepted

A reconciliation summary used to count only the observations that evidence
providers made. Subjects with no observation at all were absent from the
denominator, so after a dogfooded slice marked its new concepts `current`,
the summary read as fully verified while those concepts had never been
looked at. `not-observed` is a provider's opinion that something is missing;
no observation is the absence of any opinion, and the two were
indistinguishable at summary level.

The report now computes, from the compiled graph, the concepts whose
lifecycle status is `current` yet which appear in no observation — neither
targeted directly, nor through a claim they own, nor as an endpoint of an
observed relationship claim. The summary always carries a
`subjectsWithoutEvidence` counter, and when the count is positive the report
lists the subjects in a top-level `unobservedSubjects` array, sorted
lexicographically. The filter is deliberate: `current` is where the claim
"this exists" is being made without support, while `planned` and `retired`
subjects make no such claim.

Absence of evidence is reported as absence, never as a finding: findings
carry a provider and an evidence locator, and no provider produced anything
here, so shoehorning the gap into `findings` would fabricate an accusation.
The change is additive within `yarramate/reconciliation-report/v1`, the same
pattern as ADR 0046; existing consumers keep working, and `unobservedSubjects`
is omitted when the graph is unavailable or the list is empty.
