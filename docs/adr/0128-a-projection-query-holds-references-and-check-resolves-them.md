# A projection query holds references, and `check` resolves them

Status: accepted

A projection is a document in the workspace, and its `query` block is a WHERE
clause: `states`, `subjects`, `kinds`, `owners` and the rest name things in the
model. YarraMate refuses a relationship pointing at a concept that does not
exist. It did not refuse a query naming a state that does not exist.

The symptom is silent, and it reaches a client:

```yaml
query:
  states:
    - target-stat        # target-state, mistyped
```

That selects no state, which selects no subject, which writes a clean empty
artifact and exits 0. `check` passed, because `check` loaded every projection
against its schema and never against the model. Every export kind is affected:
`graph`, `markdown`, `briefs`, `rtm`, `likec4` and `xlsx` alike.

Found by asking whether YarraMate refuses an empty compile the way an adopter's
own projection call had just started to.

## Decision

**The check is REFERENTIAL, not emptiness.** A query value that names nothing
is refused. A query whose every name resolves and which selects nothing is not.

That distinction is the whole decision. An architecture state nobody has
populated yet is empty, correctly, and asking about it is a real question with
an honest answer. Refusing every empty result would catch the typo and break
that workflow with it. The mechanism is a dangling reference, so the check is
for a dangling reference — the symptom was an empty file, and a detector shaped
like the symptom would have been wrong.

**It runs at `check`, and only on projections the MANIFEST declares.**

This is the part that took a correction. `docs/PROJECTIONS.md` already recorded
a deliberate principle: *"Selectors are portable by default... absent from the
current graph contributes no matches and is not a validation error. This
supports partial models and reuse across repositories."* A blanket referential
check reverses that, and reversing a recorded decision by accident is worse
than the defect it fixes.

They hold together because they are about different documents. A projection in
the workspace manifest is **this repository's own document**, checked against
this repository's model, and portability was never the point of it. A
projection handed to `ask` or `export` as a path — including one written for
another repository, against a partial model — is evaluated and never
reference-checked, so it still degrades to no matches rather than to an error.

`check` iterates `resolved.projections`, which is the manifest list, so the
implementation lands on that line by construction rather than by a special
case. The typo is in a file rather than in an invocation, which is why CI is
the right place to catch it, and every verb over a declared projection inherits
the guard rather than each growing its own.

It runs AFTER compilation succeeds, alongside the adapter-mapping and evidence
diagnostics, rather than beside the projection's own schema load. A reference
can only be resolved against a model that built; reporting dangling names out
of a workspace that does not compile buries the real failure under its
consequences.

**Every facet with a closed namespace is checked**, and each namespace is
derived the way the FILTER derives it, so the check cannot drift from what it
guards. `documents` reads the same provenance the `documents` facet compares
against; `states` is the same `yarramate/state/type` scan `conceptSelector`
runs.

`owners` and `constraints` are included. They look like free text and are not:
both are refs to concepts, which the compiler proves by refusing an unresolved
owner with YM304. They are checked against the SUBJECT list rather than against
owners currently in use, because a team that owns nothing yet is a real concept
and selecting it is a real question with an empty answer.

`statuses` and `excludeStatuses` are schema enums, refused upstream.

**A kind whose profile is not loaded is dormant, not wrong.** The kind facets
are checked only when a profile context is present, the same distinction #351
drew for question catalogues.

**The diagnostic suggests the near miss.** `similarity` already exists for
near-duplicate subject detection, so the suggestion reuses it rather than
introducing a second string-distance function. A diagnostic aimed at a typo
should offer the correction.

## Consequences

`check` compiles with `compileWorkspaceWithProfileContext` rather than
`compileWorkspace`. These do identical work; the former simply keeps the
profile context the kind facets need.

A workspace with a mistyped projection now fails `check`. That is a breaking
change for anyone whose projection has been quietly selecting nothing, which is
the point.

The rule is exported as `unmatchedSelectors` and `projectionReferenceDiagnostics`
so `ask` or a visual session can adopt it and refuse in identical words with an
identical code (YM921), rather than each rebuilding it.

An empty export is still written, silently, when the query is honest. If that
should change it is a separate decision about deliverables, not about queries.

A projection used across repositories keeps its portable behaviour, but only
while it stays out of the consuming workspace's manifest. Declaring it is the
act that says "this is ours", and it is then held to this model.
