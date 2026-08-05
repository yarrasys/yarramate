# Constraints carry expected observations

Status: accepted

A requirement rewritten to contradict the data-residency constraint sitting
next to it passes `check` with exit 0. That is not a defect in the checker: the
rule lives inside an opaque description string, and the engine deliberately
does not read words (ADR 0054). The documented word-blindness boundary is
therefore also a documented hole, and the fix is not to start parsing prose.

Decided: a constraint entry may declare the observation it expects, and
evidence providers may report the values they read. Reconciliation compares
the two.

```yaml
constraints:
  - id: residency
    ref: australia-only
    expects:
      provider: terraform-scan
      key: region
      value: ap-southeast-2
```

## The authoring surface is a field that compiles to a claim

`expects` is a structured field on a constraint entry, not a free-form claim
predicate the author writes by hand. The field gives the shape a schema can
reject at authoring time, and the compiler is where every stable claim
identity in this codebase is minted. It compiles to `<subject>~expects-<id>`
with predicate `yarramate/constraint/expects`, alongside the unchanged
`yarramate/constraint/requires` claim. The claim ID is suffixed on the
authored constraint ID, which `YM306` already keeps unique, so identity is
reorder-safe for the same reason constraint claims are (ADR 0015).

Graph v2 gains no field and no structure. The claim carries one string value,
`<provider> <key> <expected value>`, exactly as an attestation carries
`<by> <on>`. Provider and key admit no whitespace, so the first two spaces
delimit them and the remainder is the expected value verbatim, spaces
included. A consumer that has never heard of the predicate keeps reading the
graph correctly, which is the whole additivity contract
(`docs/SEMANTIC-GRAPH.md`). Encoding three parts in one value is the price of
that contract; the alternative, a structured object in a claim, would be a
graph v3.

## Evidence gains values, not a second kind of observation

An observation may carry an observed `key` and `value` together. This is
additive within `yarramate/evidence/v1`: both fields are optional, required
only in each other's presence, and every existing overlay stays valid.

`result` is untouched and orthogonal. It still answers whether the target
holds up at all, a presence or absence judgment; the keyed value reports a
fact. A provider confirming a subject exists while reporting that its region
is `us-east-1` is making both statements at once, and they are separate
statements.

One consequence had to be conceded: the duplicate-target rule (`YM803`) now
keys on target plus observed key, because a provider that reads three facts in
one file must be able to report three keyed values there. A target still
carries at most one presence result and at most one observation per key.

## Comparison is string equality, and stays that way

Two strings are equal or they are not. No case folding, no numeric coercion,
no globbing, no regular expressions, no ranges. A provider that needs any of
that normalizes before it reports, which puts the interpretation in the
component that already owns URI resolution and external validity.

This is the boundary that keeps the feature honest. The moment Core acquires a
matching language it has acquired a policy engine, and ADR 0016 exists
precisely to keep that out. Requests for richer comparison should be answered
by the provider, not by the model.

## A disagreement is an ordinary contradicted finding

A declared expectation is matched to observations by provider and key. The
observation's own target anchors provenance but does not narrow the match: a
keyed value is a fact about the project ("this deployment's region is X"), not
about one subject, and several constraints on different subjects may
legitimately expect the same fact. Requiring providers to enumerate every
subject a keyed fact bears on would make a config reader model-aware for no
gain in truth.

Disagreement produces a `contradicted` finding with an additive optional
`expectation` object rendering both sides: the declared provider, key, and
expected value with the source location where it was authored, next to the
observed value with its provider, evidence document, and locator. Findings
already restate declared intent for contrast (ADR 0046); an expectation
finding is the same move for a value rather than an endpoint pair, and it is
equally advisory. No document is mutated and no remediation is authorized
(ADR 0032).

`check --strict` needed no new gate semantics, which was the point. A
contradicted expectation is a contradicted finding, so it already failed the
existing gate; only the diagnostic wording is specialized, because both sides
of this disagreement are known values worth naming. It anchors at the authored
expected value, so the failure is repairable where it is reported (ADR 0039).

## Silence is reported as silence

An expectation no provider observed is not a finding. Findings carry a
provider and an evidence locator, and here no provider produced anything, so
shoehorning the gap into `findings` would fabricate an accusation. It goes
where ADR 0049 put the same problem: a top-level `unobservedExpectations`
array, present only when non-empty, plus `expectationsCompared` and
`expectationsWithoutObservation` counters that are always emitted. Both
counters are optional in the schema, so reports produced before this change
still validate.

An unobserved expectation therefore does not fail `--strict`. Absence of
evidence is not contradiction, and a gate that failed on it would punish
authors for declaring expectations at all, which is the opposite of the
incentive this feature needs.

ADR 0074 reached the same conclusion independently for stale attestations: a
freshness signal about a human process is not a contradiction, so it stays out
of the gate too. The two land consistently. `--strict` fails on exactly one
thing, a provider that looked at reality and disagreed with the model, and
both new report additions grow the report without growing the gate. They also
compose additively with each other: `unobservedExpectations` and
`notes` are independent optional arrays, `expectationsCompared`,
`expectationsWithoutObservation`, and `staleAttestations` are independent
optional counters, and a report produced before either change still
validates.

## Consequences

A constraint stops being prose and becomes a monitor: every fact moved out of
a description and into a claim is a fact that can testify against a
contradiction. The cost is that authors must state expectations explicitly and
providers must report keyed values; nothing is inferred, and a model that
declares nothing is exactly as blind as it was.
