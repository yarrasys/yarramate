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
the observation; arbitrary provider metadata is not accepted. One syntactic
reading is the exception (ADR 0130): artifact coverage, below, compares
`repo:<path>` locators against a declared scope as strings — still without
resolving, opening, or validating anything a locator points at.

## Value observations

An observation may additionally report the value it read, by carrying an
observed `key` and `value` together (ADR 0075):

```yaml
observations:
  - subject: shop#customer-data
    result: confirmed
    key: region
    value: us-east-1
    evidence:
      uri: repo:infra/main.tf#L12
      message: aws_s3_bucket.customer_data region
```

The two fields are required together: a key without a value, or a value
without a key, is rejected. The key is provider-owned naming with no
whitespace; the value is any non-empty string, compared verbatim.

`key` and `value` do not replace or reinterpret `result`. The result still
answers whether the target holds up at all, which is a presence or absence
judgment; the keyed value reports a fact that a declared expectation can be
compared against. A provider that reads several facts in one place may report
several keys at one target, and each key at a target at most once. Its
presence result is still stated once per target.

Providers own their key vocabulary. Core neither defines key names nor
resolves them: it only compares the reported value with the value a
constraint declared it expects.

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
source-located `YM901` diagnostic anchored at the declared claim. A
contradicted expectation surfaces the same way, anchored at the authored
expected value, with no gate semantics of its own. `unknown`
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
provider, plus the `stale-attestation` and `unconfirmed-attestation`
findings described below. Confirmed observations remain summarized rather
than repeated so a reviewer or agent can focus on unresolved evidence.

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

### Declared expectations

When a constraint declares an expected observation
(`expects` in `docs/NATIVE-DOCUMENT.md`), reconciliation compares the declared
value with what the named provider observed. A declared expectation is matched
to observations by provider and key. The observation's own target anchors its
provenance but does not narrow the match, because a keyed value is a fact
about the project rather than about one subject, and several constraints may
legitimately expect the same fact.

A disagreement is an ordinary `contradicted` finding, rendered with both
sides: the declared expectation with the source location where it was
authored, and the observed value with its provider, evidence document, and
locator.

```json
{
  "target": {
    "type": "claim",
    "id": "shop#customer-data~expects-residency"
  },
  "expectation": {
    "provider": "terraform-scan",
    "key": "region",
    "expected": "ap-southeast-2",
    "observed": "us-east-1",
    "declared": {
      "document": "shop",
      "path": "architecture/shop.yaml",
      "pointer": "/concepts/1/constraints/0/expects/value",
      "line": 18,
      "column": 18
    }
  },
  "result": "contradicted",
  "provider": "terraform-scan",
  "evidenceDocument": "shop-terraform@1.0",
  "evidence": {
    "uri": "repo:infra/main.tf#L12",
    "message": "aws_s3_bucket.customer_data region"
  }
}
```

The summary counts `expectationsCompared`, the declared expectations a
matching observation reached, and `expectationsWithoutObservation`, those no
provider reported on. An expectation nobody observed is listed in a top-level
`unobservedExpectations` array, sorted by claim then key, and never converted
into a finding: no provider disagreed, so there is nothing to accuse, and the
same discipline applies as for unobserved subjects (ADR 0049). An unobserved
expectation is therefore reported honestly rather than passing as satisfied,
and it does not fail `check --strict`.

The summary also counts `current` concepts that appear in no observation at
all — neither targeted directly, nor through a claim they own, nor as an
endpoint of an observed relationship claim — as `subjectsWithoutEvidence`.
When the count is positive the report lists them in a top-level
`unobservedSubjects` array, sorted lexicographically. This is not a finding:
no provider looked and disagreed; reconciliation simply has no opinion, and
the report says so instead of letting the gap pass as verified.

A finding is advisory evidence, not a proposed replacement claim, validation
error, CI verdict, or authorization to modify the native model.

## Artifact coverage

Unobserved subjects answer only half of the coverage question: they report
declared intent no observation supports, and nothing reported code the model
never mentions at all (#175, ADR 0130). A workspace manifest may therefore
declare a `coverage` list of glob patterns naming the artifacts the model
intends to cover:

```yaml
coverage:
  - src/**/*.ts
  - schema/*.json
```

`reconcile` — only `reconcile` — resolves the patterns against the root of
the git repository the manifest lives in. An artifact is any selected file
git can see there: tracked, or untracked and not ignored. An observation
claims an artifact when its locator is `repo:<path>`, with any `#fragment`
stripped; a locator naming a directory claims everything beneath it; a
locator in any other scheme claims nothing. The summary counts
`artifactsInScope` and `unclaimedArtifacts` exactly when coverage was
assessed, and a positive count lists the paths in a top-level
`unclaimedArtifacts` array, sorted, beside a `coverageScope` echo of the
declared patterns.

When coverage was not assessed — no scope declared, or no git repository —
the report says why in `notes` rather than staying silent, and a declared
pattern that selects no artifact gets a note naming it: a dead glob is
indistinguishable from a typo. An unclaimed artifact is absence, never
accusation: no finding is fabricated, and `check --strict` does not read
the list — the same line unobserved subjects and unobserved expectations
hold.

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
    "by": "policy#compliance-lead",
    "on": "2026-01-15"
  },
  "provider": "git",
  "changedAt": "2026-06-01T12:00:00+00:00",
  "evidence": {
    "uri": "git:9f2c1ab…",
    "message": "Attestation \"signed-off\" by policy#compliance-lead on 2026-01-15 predates the current wording of policy#refund-rule: the description changed in commit 9f2c1ab on 2026-06-01T12:00:00+00:00."
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

## Unconfirmed attestations

`by` names the authority a judgment belongs to, resolved against the
model as a subject reference; `recordedBy` names whoever actually
wrote the record, when that is not the authority's own hand (ADR
0082). `reconcile` reports when the two disagree — a recorder is
present and names someone other than the authority itself — as an
`unconfirmed-attestation` finding:

```json
{
  "target": { "type": "subject", "id": "policy#refund-rule" },
  "result": "unconfirmed-attestation",
  "attestation": {
    "topic": "signed-off",
    "by": "policy#compliance-lead",
    "recordedBy": "yarramate-apply-agent",
    "on": "2026-01-15"
  },
  "provider": "model",
  "declared": {
    "document": "policy",
    "path": "architecture/policy.yaml",
    "pointer": "/concepts/1/attestations/0/topic",
    "line": 24,
    "column": 16
  }
}
```

This finding kind has no `evidenceDocument` and involves no git
lookup: its provider is `model`, because the disagreement is legible
from the attestation claim alone. `declared` locates the authored
attestation entry — the same source location the claim carries, its
`topic` line — rather than an external observation. A recorder that names
the authority itself — by its qualified id or its document-local
form — is a self-recorded sign-off and produces no finding.

The `summary.unconfirmedAttestations` counter is present whenever a
graph was compiled, so a report that found nothing unconfirmed is
distinguishable from one that never had a graph to check against.
`check --strict` is unaffected: an unconfirmed recorder is a fact
about who wrote a record, not a contradiction between the model and
observed reality, so it reports rather than gates.

## Writing overlays

An overlay is a workspace document, so `yarramate apply` writes it the way
it writes a model document: `add-observation`, `update-observation`, and
`delete-observation` address an evidence document declared by the manifest's
`evidence` list (ADR 0089). Before this the only way to record what a
provider read was to open the file, which is exactly the hand-editing the
apply loop exists to prevent — a reviewer who adds a concept through the
visual canvas or a batch has no path to the evidence for it.

```yaml
format: yarramate/operations/v1
operations:
  - op: add-observation
    document: .yarramate/evidence/repository.yaml
    observation:
      subject: yarramate-engine#compiler
      result: confirmed
      evidence:
        uri: repo:src/compiler.ts
```

An observation is addressed by the pair (target, key) rather than by an
`id`, because an overlay entry has none: `reconcile` already treats that
pair as unique per document (ADR 0075, `YM803`). The target is the
observation's `subject` or `claim`; a keyless observation is the presence
claim for its target, so an absent `key` is itself an address rather than a
wildcard. `update-observation` names the entry the same way and changes
whatever else it carries — `result`, `value`, `evidence.uri`,
`evidence.message` — scalars replacing in place. Retraction is explicit and
narrow: `remove: [message]` is the only retraction an observation admits,
because `message` is the only optional field it holds, and setting and
removing it in one operation is rejected rather than ordered.
`delete-observation` removes the whole entry.

The gate is the one every batch passes. The candidate workspace compiles,
then every touched overlay is loaded and evaluated against the compiled
graph, before a single byte is written: an observation whose subject the
graph does not carry rejects the batch with `YM801` and leaves every source
unchanged. `yarramate/apply-result/v1` counts the work as
`addedObservations`, `updatedObservations`, and `deletedObservations`
alongside the concept and relationship counts.

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

A declared expectation does not change that boundary. Comparing two strings is
not a rule engine: Core still holds no policy language, no waivers, no
exceptions, and no opinion about which value is correct. It reports that the
model and a provider disagree, and leaves the judgment to a reviewer.

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
