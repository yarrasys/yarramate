# Native extension profiles

YarraMate projects extend the bundled vocabulary through explicit profile
documents. Their normative structure is
`schema/yarramate-profile.schema.json`. One optional profile also ships
inside the package: `yarramate/policy@0.1` (ADR 0095). A document may
select `profile: yarramate/policy@0.1` without copying a file; the
compiler injects it when selected or extended. It is not an interrogation
switch. Webapps that call a system API need `authentication-constraint`
too. Policy subjects belong in a document that selects this profile;
other documents may keep an existing org profile and bind with qualified
`constraints[].ref`. Re-basing an org profile onto policy is allowed and
not required.

## Smallest profile

```yaml
format: yarramate/profile/v1
id: example/platform
version: "1.0"
extends: yarramate/core@0.1
conceptKinds:
  - id: platform-team
    name: Platform team
    parent: yarramate/core@0.1#businessActor
relationshipKinds:
  - id: owns
    name: Owns
    parent: yarramate/core@0.1#assignment
    targetAspects: [behavior]
```

The version is quoted because YAML otherwise parses values such as `1.0` as
numbers. A profile identity is `<id>@<version>`.

Every new kind declares a globally qualified semantic parent. A concept kind
inherits its parent's aspect. A relationship kind inherits its parent's
endpoint constraints and may narrow them with `sourceAspects` or
`targetAspects`; it cannot broaden an existing restriction.

Those endpoint constraints are the only thing that makes a concept kind
checkable. In the core profile just four relationship kinds pin an aspect —
`assignment` (source: active-structure), `access` (target: passive-structure),
`triggering` (both ends: behavior), and `influence` (target: motivation) — so
a subject touched by none of them could be reclassified to almost any other
kind and the workspace would still compile. `ask` reports that gap through
the `unconstrained-kind` trigger condition rather than guessing a kind
(ADR 0083); narrowing aspects on an extension relationship kind, as `owns`
does above, extends the set of claims that can falsify a classification.

Local kind names may not shadow inherited names. Profiles may extend other
explicit profiles, and resolution is independent of CLI/source order.

## Rigidity

A concept kind may declare one optional meta-property, `rigidity`, borrowed
from OntoClean:

```yaml
conceptKinds:
  - id: microservice
    name: Microservice
    parent: yarramate/core@0.1#applicationComponent
    rigidity: rigid
```

A kind is `rigid` when being of that kind is essential to every instance: a
thing IS an application component, and it stops existing before it stops being
one. A kind is `anti-rigid` when it is essential to no instance: a role is
played contingently, and the actor playing it survives giving it up. Most
kinds are neither, so the annotation is optional and an unannotated kind
constrains nothing in either direction.

One rule follows mechanically, and it is the only one the compiler checks:

> **A rigid kind may not specialize an anti-rigid one.**

Person is not a subclass of Student. If everything of kind X is essentially X,
and nothing of kind Y is essentially Y, then X cannot be a Y. Violating it is
`YM413`, a compile error, and the whole lineage is checked rather than the
immediate parent, because specialization is transitive and an unannotated kind
in between does not launder the violation.

The core profile annotates five of its own kinds, all `anti-rigid`, and only
where the ArchiMate-inspired semantics make the answer plain:
`stakeholder`, `businessRole`, `businessCollaboration`,
`applicationCollaboration`, and `technologyCollaboration`. Nothing is
essentially a role or a collaboration; both are held for as long as they are
held. Core declares no `rigid` kinds: core kinds are lineage roots, so the
annotation could never fire on them, and each one would be a fresh semantic
claim about a stable profile bought for nothing.

Rigidity is checked at profile-resolution time and then discarded. It reaches
no graph, no claim, and no projection, so annotating a kind changes no
compiled output. Identity and unity, OntoClean's other meta-properties, are
out of scope: neither yields a check this cheap (ADR 0078).

## Authoring and compiled identity

A document selects one profile and uses its local names:

```yaml
profile: example/platform@1.0
concepts:
  - id: team
    kind: platform-team
    name: Platform team
```

The selected profile includes all inherited kinds. The compiler emits graph v2
with globally qualified kind identities:

```json
{
  "predicate": "yarramate/concept/kind",
  "object": {
    "value": "example/platform@1.0#platform-team"
  }
}
```

Relationship claims use the qualified relationship kind directly as their
predicate. Core kinds follow the same rule, for example
`yarramate/core@0.1#realization`.

## Checking

Profile files are explicit workspace sources:

```sh
yarramate check profiles/platform.yaml architecture/platform.yaml
```

The graph records the selected profile and its complete inherited lineage.
Profile source files are not architecture documents and do not become graph
subjects or claims.

Profiles define semantic vocabulary and deterministic constraints. They do not
define adapter layout, organizational approval workflow, completeness taste,
or external-language compatibility unless they are separately governed for
that purpose.

## Conservative extension

Profiles are the extension point offered to users, so the safety property that
makes extension sound is stated here rather than left to be discovered. It is
two properties, because a profile and a document that selects it are different
things.

> **A vocabulary nobody selects changes nothing.**
>
> Let `W` be a workspace and let `P` be one or more profile documents that no
> document in `W` selects. Then every diagnostic, catalogue evaluation, and
> projection result over `W + P` is byte-identical to the one over `W`.

> **An extension document is never a worse neighbour than its core twin.**
>
> Let `D` be a document that selects a kind declared in `P`, and let the
> **core twin** of `D` be `D` rewritten to declare the same subjects under the
> nearest core ancestor of each kind it uses. Then for every subject already
> present in `W`, every verdict change caused by adding `D` is also caused by
> adding the core twin. The converse does not hold: the core twin may change
> more.

The prior art is the standard ontology-modularization criterion: a module is a
conservative extension when it adds nothing about the original vocabulary.
Everything the base said about base terms still holds, and nothing new about
base terms becomes derivable. That is what lets someone import a module
without auditing it.

### Why the naive phrasing is wrong

"A query about core kinds returns the same answer" is false here, and it is
false by design. A core-kind selector with `kindMatching: descendants` returns
more subjects once an extension exists:
`yarramate/core@0.1#applicationComponent` matches an extension's
`microservice`, which is exactly what ADR 0029 built it to do, and catalogue
conditions resolve through lineage by default for the same reason. If the
property forbade that, the property would be wrong rather than the behaviour.

The unit is subjects, not queries. The extra matches are subjects the extension
brought with it, and about every subject that was already there the answer is
unchanged: same kind, same status, same lineage, same claims. An extension may
enlarge the domain. It may not revise the domain it enlarged.

### Why one property is not enough

A single statement covering "the profile together with any documents that
select it" was tried first, and it is false. Adding a document changes what a
workspace-scoped catalogue asks about the subjects already in it — that is
what workspace scope is for, and it happens whether or not a profile is
involved. Measured on the bundled catalogue: an extension document declaring
`orders` with a relationship to a pre-existing goal resolves that goal's
`goal-unrealized` question. That is the feature working, and the single
statement called it a violation.

So the second property compares like with like. The question an importer
needs answered is not "does adding documents change anything" — it does —
but "does routing them through an extension profile expose me to anything
plain modelling would not". The answer is no, and it is stronger than
parity: the exposure is a subset.

### The testable form

The first property has a degenerate case that makes it exactly testable: a
profile loaded but never selected adds no subjects at all, so "changes
nothing" collapses to output identity and a string comparison settles it. That
is what `test/conservative-extension.test.ts` asserts across four surfaces —
graph, diagnostics, catalogue evaluation, and a descendant-matching projection
— plus a case that asserts the widening happens and that every arrival is a
subject the extension document introduced.

The second property is tested by control rather than by assertion: run the
same workspace with the extension document and with its core twin, and compare
the verdict changes about pre-existing subjects. Two controls are pinned. An
equality witness: both routes resolve the same `goal-unrealized` question, so
the extension route is not doing something of its own. And a strictness
witness: near-duplicate detection buckets by exact kind (ADR 0077), so an
arrival named `Orders Gateway` under the extension's `microservice` leaves the
pre-existing `Order Gateway`'s question closed, while the same arrival under
`applicationComponent` opens it. The extension route changed strictly less.

This is a test discipline rather than a mechanical check. A general proof over
every future feature would be out of proportion to a property that currently
holds by construction.

### What it rules out

Any future profile feature that lets an extension restate, re-parent,
re-annotate, or constrain a kind it did not declare would violate this, and
would therefore need to be a deliberate decision with this section rewritten,
not a discovered consequence. Today no such feature exists: an extension may
only add kinds, and may only narrow constraints on the kinds it adds.

The second property rules out something narrower and easier to introduce by
accident: a surface where an extension kind is treated as a wider participant
than the core kind it specializes. Descendant bucketing in the near-duplicate
check would do exactly that, which is why ADR 0077 buckets by exact kind and
two regression tests pin it. A catalogue condition that resolved counterparts
through lineage where the selector does not would be the same fault in another
place.

The rigidity annotation (ADR 0078) sits on the right side of this line for
extensions, since a profile may only annotate kinds it declares. Annotating
the core profile's own kinds is a different matter, and it is honestly not
conservative: it adds a fact about core vocabulary. That is why it was done in
core, with a compatibility argument, rather than through a profile (ADR 0079).
