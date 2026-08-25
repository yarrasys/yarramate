# A recorded search makes an absence auditable

Status: accepted

Every evidence result except one is checkable by something. `confirmed` and
`contradicted` name a locator a reader can open. `unknown` says explicitly that
nothing was resolved. `not-observed` asserts a **negative about a tree nobody
read exhaustively**, and its message is free prose that nothing in the pipeline
can test.

That is backwards. The one result a reader most needs checked is the one the
engine cannot touch.

## What it cost

The GitLab showcase was positioned on a single deliberate non-confirmation:

> `praefect` · `not-observed` · "Declared on GitLab's architecture page beside
> Gitaly; no version pin, directory, or client for it exists in the FOSS tree
> at v19.3.0."

Two of those three clauses were false. `lib/gitlab/gitaly_client/praefect_info_service.rb`
defines `PraefectInfoService`; `doc/administration/gitaly/praefect/` documents
operating it. `check --strict` was green and `reconcile` reported the
observation as a finding like any other.

The mechanism of the failure is worth stating precisely, because it is not
carelessness. The observation carried the locator `repo:GITALY_SERVER_VERSION`,
**which exists**. The provider resolved it and reported success. The locator
and the assertion were about different things: the locator pointed at a version
file, the message asserted a fact about `lib/`, `doc/` and a client surface, and
nothing connected them. A locator says what the author looked at. It does not
say where they looked for the thing they claim is absent.

## Decided

**A `not-observed` observation may record `searched`: what was looked for and
not found, in a form a reader can re-run.**

```yaml
- subject: praefect
  result: not-observed
  searched:
    - glob: 'PRAEFECT_*'
    - grep: 'Praefect'
      paths: ['lib/', 'app/']
  evidence:
    uri: repo:doc/development/architecture.md
    message: Declared upstream, absent here.
```

**An observation may record `measured`: a figure quoted in its message, with
how it was produced.**

```yaml
  measured:
    - value: '68'
      method: "find app/services/ci -maxdepth 1 -name '*.rb' | wc -l"
```

`reconcile` counts `not-observed` observations that name no search as
`summary.unsupportedAbsences` and names each one in `notes`.

## yarramate does not run any of this

The obvious next step is for `reconcile` to re-run the search and flip the
observation to `contradicted` when it now matches. That is deliberately not
what this ADR decides, and the reason is a boundary rather than effort.

**yarramate has never resolved an evidence locator.** The `uri` is opaque text.
`reconcile` compares asserted relationships in the model against observed ones
recorded in the evidence document, and the evidence document is itself an
authored artifact. `reconciliation.ts` imports nothing but types; the CLI does
the I/O and passes results in, which is why git-derived attestation staleness
lives outside it (ADR 0074).

Running a probe would mean the engine reads a foreign tree and executes
patterns out of a committed file. That is a real capability with a sandboxing
question attached, and it deserves its own decision rather than arriving as a
side effect of a field. Recording the probe is what is decided here, and the
data has to exist before running it means anything.

So the falsification stays where it already was: with the provider, on its next
pass. What changes is that the provider now has something to re-run, and a
reviewer can tell a claim that was searched for from one that was asserted.

## Why this is not a check error

Making an unsupported `not-observed` fail `check` would fail existing models on
upgrade, which is the argument [ADR 0083](0083-a-kind-nothing-constrains-is-a-label.md)
used to keep `unconstrained-kind` out of the gate. It is also not the right
shape: an unverifiable claim is not a contradiction.

`--strict` folds in contradictions only, and [ADR 0074](0074-a-stale-attestation-is-a-note-not-a-gate.md)
established that a signal which is not a contradiction does not gate. An
unsupported absence is a signal of that kind, so it is counted and named rather
than enforced. A count in the summary is where a reader actually looks: the
report on the failure above was read as "48 confirmed, 1 not-observed", and
`unsupportedAbsences: 1` beside it would have said what that finding was worth.

## Consequences

- `searched` and `measured` are optional and additive. No existing evidence
  document becomes invalid.
- `summary.unsupportedAbsences` is a new optional counter, and appears in the
  reconciliation report and in both copies of that summary inside `ask-result`.
  Adding it meant editing **three** copies of one shape, which is the same
  duplication [#278](https://github.com/yarrasys/yarramate/issues/278) records
  for the interrogation report and is worth collapsing on its own.
- A provider that records nothing keeps working and reports one number saying
  so.
