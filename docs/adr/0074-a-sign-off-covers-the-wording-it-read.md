# A sign-off covers the wording it read

Status: accepted

From the requirements-capture exploration (2026-08-05, issue #148): an
attestation records that an accountable human accepted a subject *as
stated on a date*, and nothing noticed when the statement changed
afterwards. A requirement could be reworded arbitrarily and the old
sign-off kept the question closed. Every ingredient already existed:
the attested subject's authored source span, the attestation's `on`
date, and the text-span by git-diff intersection built for review
slices (ADR 0065).

Decided: staleness is a **reconcile finding**, not an evaluator
reopening. `reconcile` is the verb that already reports intent against
observed reality, carries provenance on every finding, and never
auto-fixes; a sign-off that predates the current wording fits that
contract exactly. The design evaluator stays git-free in v1, so
`design` remains a pure function of the documents it is handed, and
`ask --advise` keeps reporting evidence reconciliation only.

The finding kind is `stale-attestation`. Unlike an evidence finding it
carries no `evidenceDocument`, because no provider authored it: its
provider is `git`, and it names the attestation (topic, by, on), the
subject, and the commit that introduced the current wording together
with that commit's date.

**The comparison rule.** An attestation records a date; commits carry
timestamps. A sign-off dated `on` covers every commit up to and
including the end of that calendar day in UTC. A change counts as
later exactly when its committer timestamp is at or past midnight UTC
of the following day. Choosing the end of the day rather than its
start is the reading that favours the attester: someone who signs off
on a Tuesday has plausibly read anything committed that Tuesday, and
the alternative would report a sign-off as stale against wording the
signer almost certainly saw. UTC rather than a local zone keeps the
answer identical on every machine, which a report claiming
determinism cannot trade away. The boundary is tested on both sides,
including a commit stamped in a non-UTC zone that lands inside the
covered day.

**Granularity: name and description only.** These are the spans an
attester reads as the statement of the subject. Kind, status, owner,
constraints, and references are structure and lifecycle around the
claim rather than the wording of it, and folding them in would report
a sign-off as stale when someone merely marked the subject `current`.
Widening this later is additive; narrowing it after the fact would
not be.

**Degrading honestly.** Outside a git repository, on a shallow clone,
against an untracked document, or when the sign-off predates the
file's earliest commit, the engine emits **no** staleness findings and
a plainly worded note in the report instead. A missing answer is
reported as missing; it is never inferred, and it is never an error,
because a workspace without git history is a legitimate workspace with
one fewer question answered. The `staleAttestations` counter appears
only when staleness was assessed at all, so a report that never looked
is distinguishable from one that looked and found nothing.

**`check --strict` is unaffected, deliberately.** Strict fails on
evidence contradictions: a provider looked at reality and disagreed
with the model. A stale attestation is a freshness signal about a
human process, not a contradiction; the model and the code may agree
perfectly while a sign-off simply needs renewing. Gating CI on it
would fail builds for a condition no code change can resolve, and
would push teams to backdate attestations to stay green. Reconcile
reports it; a later opt-in policy layer may decide it matters.

The report contract grows additively within v1 (ADR 0024): the
`findings` array accepts the new kind alongside the existing evidence
findings, whose shape is untouched, plus an optional
`summary.staleAttestations` and an optional top-level `notes` array.

Recorded as deferred, not forgotten: re-attestation that references
the commit it covers would make this exact rather than date-based, and
the evaluator-side question of reopening `motivation-unattested` on a
stale sign-off stays open for the catalogue to answer separately.
