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
