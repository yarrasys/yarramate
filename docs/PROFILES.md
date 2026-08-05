# Native extension profiles

YarraMate projects extend the bundled vocabulary through explicit profile
documents. Their normative structure is
`schema/yarramate-profile.schema.json`.

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
makes extension sound is stated here rather than left to be discovered.

> **Loading a profile extension adds subjects. It never changes verdicts.**
>
> Let `W` be a workspace and let `E` be an extension: one or more profile
> documents that no document in `W` selects, together with any documents that
> select them. Then for every subject present in `W`, every diagnostic,
> catalogue evaluation, and projection result concerning that subject is the
> same in `W` and in `W + E`. Loading `E` may add outcomes concerning the
> subjects `E` itself introduces. It may change no outcome concerning a
> subject that was already there.

The prior art is the standard ontology-modularization criterion: a module is a
conservative extension when it adds nothing about the original vocabulary.
Everything the base said about base terms still holds, and nothing new about
base terms becomes derivable. That is what lets someone import a module
without auditing it.

### Why the naive phrasing is wrong

"A query about core kinds returns the same answer" is false here, and it is
false by design. A core-kind selector with `kindMatching: descendants` returns
more subjects once an extension exists: `yarramate/core@0.1#applicationComponent`
matches an extension's `microservice`, which is exactly what ADR 0029 built it
to do, and catalogue conditions resolve through lineage by default for the
same reason. If the property forbade that, the property would be wrong rather
than the behaviour.

It survives because it is quantified over subjects, not over queries. The
extra matches are subjects the extension brought with it. Nothing that was in
the answer has left it, and nothing that was already in the model has changed
kind, status, lineage, or diagnosis. An extension may enlarge the domain. It
may not revise the domain it enlarged.

### The testable form

When `E` introduces no documents, a profile loaded but never selected, it adds
no subjects at all. The property then collapses to exact output identity, and
that is what `test/conservative-extension.test.ts` asserts: a core-only
workspace compiles to a byte-identical graph, byte-identical diagnostics,
byte-identical catalogue evaluation, and byte-identical projection results
with and without an unrelated extension loaded. A fifth case covers the
widening, asserting both that the answer grows and that every arrival is a
subject the extension document introduced.

This is a test discipline rather than a mechanical check. A general proof over
every future feature would be out of proportion to a property that currently
holds by construction.

### What it rules out

Any future profile feature that lets an extension restate, re-parent,
re-annotate, or constrain a kind it did not declare would violate this, and
would therefore need to be a deliberate decision with this section rewritten,
not a discovered consequence. Today no such feature exists: an extension may
only add kinds, and may only narrow constraints on the kinds it adds.

The rigidity annotation (ADR 0078) sits on the right side of this line for
extensions, since a profile may only annotate kinds it declares. Annotating
the core profile's own kinds is a different matter, and it is honestly not
conservative: it adds a fact about core vocabulary. That is why it was done in
core, with a compatibility argument, rather than through a profile (ADR 0079).
