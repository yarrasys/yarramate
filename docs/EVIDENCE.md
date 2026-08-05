# Evidence overlays

Evidence overlays evaluate existing native architecture subjects and claims
without changing canonical documents or graph v2. Their normative structure is
`schema/yarramate-evidence.schema.json`.

```yaml
format: yarramate/evidence/v1
id: repository-observation
version: "1.0"
provider: repository-audit
observations:
  - subject: yarramate-engine#compiler
    result: confirmed
    evidence:
      uri: repo:src/compiler.ts
  - claim: yarramate-repository#compiler-source-realizes-compiler
    result: contradicted
    evidence:
      uri: repo:src/compiler.ts
      message: Expected implementation marker was not found
```

Each observation targets exactly one globally qualified graph subject or
stable claim ID. It has one controlled result:

- `confirmed` — the provider observed evidence supporting the target;
- `contradicted` — the provider observed evidence conflicting with the target;
- `unknown` — the provider cannot determine a result;
- `not-observed` — the provider looked but found no relevant observation.

These results are facts reported by the named provider. A contradiction does
not by itself fail Core validation, and confirmation is not approval.

The `evidence.uri` value is opaque to YarraMate Core. Its provider owns URI
resolution and external validity. An optional non-empty message may explain
the observation; arbitrary provider metadata is not accepted.

## Evaluation

Generic evaluation checks:

- every subject target exists in graph v2;
- every claim target exists in graph v2;
- one evidence document evaluates a target at most once;
- versioned evidence document identities are unique in one workspace.

Successful evaluation produces deterministic
`yarramate/evidence-report/v1` JSON with counts and sorted observations. Its
normative structure is `schema/yarramate-evidence-report.schema.json`. The
input semantic graph is not modified.

No command emits the per-document report directly: it is a library-level
format. Workspace evidence declared in the manifest is evaluated by
`yarramate reconcile` — the aggregated reconciliation report below — and
gated by `yarramate check --strict`. Structural or reference correctness
failures emit `yarramate/diagnostic-result/v1` with exit status `1`; status
`2` means invocation or file access failed.

The typed API exposes `loadEvidence`, `evaluateEvidence`, and
`evaluateEvidenceWorkspace`. Evidence documents may be declared in the
optional `evidence` category of a workspace manifest, in which case
`yarramate check` validates them against the compiled graph.

`yarramate check --strict` additionally fails the check (exit `1`) when any
evidence observation is `contradicted`, rendering each contradiction as a
source-located `YM901` diagnostic anchored at the declared claim. `unknown`
and `not-observed` results stay advisory. A strict pass reports how many
observations it evaluated, so a gate over zero evidence is visible rather
than silently vacuous (ADR 0047).

## Reconciliation

```sh
yarramate reconcile .yarramate/workspace.yaml
```

This command evaluates every evidence overlay declared by the manifest and
emits deterministic `yarramate/reconciliation-report/v1` JSON. Its normative
schema is `schema/yarramate-reconciliation-report.schema.json`.

The summary counts all observations. The `findings` array contains only
`contradicted`, `unknown`, and `not-observed` results, ordered by target and
provider, plus the `stale-attestation` findings described below. Confirmed
observations remain summarized rather than repeated so a reviewer or agent
can focus on unresolved evidence.

When a finding targets the primary claim of a declared relationship, it also
carries an optional `asserted` object with the declared `from`, `to`, and
`kind` (and `name` when present), so the disagreement between the model and
the evidence is visible in the finding itself:

```json
{
  "target": { "type": "claim", "id": "payments#payment-api-writes-ledger" },
  "asserted": {
    "from": "payments#payment-api",
    "to": "payments#ledger",
    "kind": "yarramate/core@0.1#access",
    "name": "Records payments"
  },
  "result": "contradicted",
  "provider": "repository-inspection",
  "evidenceDocument": "payments-repository@1.0",
  "evidence": {
    "uri": "repo:src/payments.ts",
    "message": "Payment API writes to the billing store, not the ledger"
  }
}
```

Subject-targeted findings and findings on relationship sub-claims (such as
`…~name`) do not carry `asserted`.

The summary also counts `current` concepts that appear in no observation at
all — neither targeted directly, nor through a claim they own, nor as an
endpoint of an observed relationship claim — as `subjectsWithoutEvidence`.
When the count is positive the report lists them in a top-level
`unobservedSubjects` array, sorted lexicographically. This is not a finding:
no provider looked and disagreed; reconciliation simply has no opinion, and
the report says so instead of letting the gap pass as verified.

A finding is advisory evidence, not a proposed replacement claim, validation
error, CI verdict, or authorization to modify the native model.

## Stale attestations

An attestation records that an accountable human accepted a subject *as
stated on a date*. `reconcile` reports when that sign-off no longer covers
the current wording (ADR 0074). Using git, it compares the attestation's
`on` date against the commits that touched the attested subject's `name`
and `description` spans; if the wording changed later, it emits a
`stale-attestation` finding:

```json
{
  "target": { "type": "subject", "id": "policy#refund-rule" },
  "result": "stale-attestation",
  "attestation": {
    "topic": "signed-off",
    "by": "Dana Okafor",
    "on": "2026-01-15"
  },
  "provider": "git",
  "changedAt": "2026-06-01T12:00:00+00:00",
  "evidence": {
    "uri": "git:9f2c1ab…",
    "message": "Attestation \"signed-off\" by Dana Okafor on 2026-01-15 predates the current wording of policy#refund-rule: the description changed in commit 9f2c1ab on 2026-06-01T12:00:00+00:00."
  }
}
```

This finding kind has no `evidenceDocument`: no provider authored it, so
its provider is `git`. When the change is only in the working tree the
locator is `git:worktree` and `changedAt` is absent.

The comparison rule is exact. A sign-off dated `on` covers every commit up
to and including the end of that calendar day in UTC; a change counts as
later only when its committer timestamp is at or past midnight UTC of the
following day. Only the `name` and `description` spans are compared in v1,
so marking a subject `current` or adding a reference does not reopen a
sign-off.

When git cannot answer honestly the report says so instead of guessing.
Outside a git repository, on a shallow clone, against an untracked
document, or when the sign-off predates the file's earliest commit, no
staleness finding is emitted and a note is added to a top-level `notes`
array:

```json
"notes": [
  "Attestation staleness was not assessed: the workspace is not inside a git repository."
]
```

The `summary.staleAttestations` counter is present exactly when staleness
was assessed, so a report that never looked is distinguishable from one
that looked and found nothing. `check --strict` is unaffected: staleness
is a freshness signal about a human process, not a contradiction between
the model and observed reality, so it reports rather than gates.

## Boundary

Evidence overlays do not:

- introduce independent observed claims;
- mutate graph v2 or native documents;
- define completeness or CI failure policy;
- grant approval or governance status;
- require Graphify or another provider;
- interpret provider-specific URIs.

A later opt-in policy layer may decide how a report affects CI. Independent
observed claims would require a separate semantic contract rather than an
unstructured extension of this format.

Constraint satisfaction uses this same boundary. A provider may target a
stable claim such as
`yarramate-engine#compiler~constraint-tool-neutral`; its result is a
constraint assessment, not Core conformance. Core does not execute policy
rules, interpret missing observations, manage exceptions, or convert a result
into CI failure.

Diagnostics use `YM801` for an unknown subject, `YM802` for an unknown claim,
`YM803` for a duplicate target, and `YM804` for a duplicate evidence document.
The schemas are exported as `yarramate/schema/evidence` and
`yarramate/schema/evidence-report`. The reconciliation schema is exported as
`yarramate/schema/reconciliation-report`.

Evidence locators also answer the inverse question. `ask --where`
(ADR 0068) reads the same observations as verified code locations for
matched subjects — so every observation authored for reconciliation
doubles as a pointer, and every subject a `--where` answer lists as
unobserved is a nudge toward the missing observation.
