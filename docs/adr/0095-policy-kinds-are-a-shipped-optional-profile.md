# Policy kinds are a shipped optional profile

Status: accepted

YarraMate Core has one `constraint` kind. An authentication rule and a
rate-limit rule can both be stored as constraints, and the catalogue cannot
tell them apart. Distinct NFR questions need distinct closing claims.

ADR 0087 rejected adding ArchiMate as a profile because that would fork
*notation* into a second vocabulary for the same subjects. This decision is
the opposite case: the kinds are **new semantics** (specializations of
`constraint`), not a competing name for an existing Core kind. Profiles are
the extension point for that. The kinds are not added to Core, because Core
kinds are lineage roots and every workspace would then see the NFR questions
as applicable.

## Decision

Ship `yarramate/policy@0.1` as a built-in optional profile, resolved the way
Core is resolved: a document may select `profile: yarramate/policy@0.1`
without copying a file into the workspace. The compiler injects the shipped
YAML when a document selects it or another profile extends it, and does not
inject it when nobody does. A workspace file that already declares the same
identity wins; the shipped copy is not added beside it.

0.1 kinds, all parent `yarramate/core@0.1#constraint`, local ids kebab-case:

- `authentication-constraint`
- `rate-limit-constraint`
- `reliability-constraint`
- `mechanism-constraint`

Planned 0.2 (named now, not shipped): `authorization-constraint`,
`transport-security-constraint`. Versioning inside 0.x is additive, mirroring
ADR 0063, so catalogue 0.10 can name 0.2 kinds and workspaces still on 0.1
skip those questions (unknown-kind omission).

The profile is named `yarramate/policy`, not `integration-architecture`.
Webapps that call a system API need `authentication-constraint` too.

Adoption is multi-document: policy subjects live in a document that selects
this profile; components may stay on an existing org profile; hops bind with
qualified `constraints[].ref`. Re-basing an org profile onto policy is
allowed and not required. Multi-`extends` is out of scope.

Not-applicable is a declared subject of the same kind (`<policy>-not-applicable`
local ids) with the reason in `description`. Numeric values belong in
`expects` on the binding (ADR 0075).

## Consequences

Catalogue questions written against policy kinds are applicable only when
the profile is in `graph.profiles`. A vocabulary nobody selects still
changes nothing (ADR 0079). Core does not become an API specification
language.
