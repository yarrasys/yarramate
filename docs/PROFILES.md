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
