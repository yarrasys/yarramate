# LikeC4 kind compatibility is explicit

Subject identity mappings and kind compatibility solve different problems.
The optional LikeC4 adapter therefore uses a separate versioned
`yarramate/likec4-kind-mapping/v1` companion document for transforming
globally qualified semantic concept and relationship kinds into LikeC4
declaration kinds.

Each native kind may be mapped at most once within its category. Multiple
native kinds may intentionally share one external kind because presentation
vocabularies can be less specific than semantic profiles. Unmapped kinds keep
their terminal kind identifier, preserving the existing Core-compatible
behavior.

Generated metadata always retains the full native semantic kind as
`yarramateKind`. A kind transformation therefore changes presentation syntax,
not semantic identity or graph v2. Kind mappings remain adapter-owned and
neither Core compilation nor native documents depend on them.

Raw source export may target a consumer-supplied specification. Self-contained
project export instead uses the bundled specification and deterministically
rejects any resolved external kind absent from that catalogue before writing.

## Status

Accepted.
