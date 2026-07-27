# Core release boundaries are explicit contract manifests

YarraMate records each Core release boundary in a closed, versioned contract
manifest listing tool-neutral formats, CLI families, deterministic guarantees,
and explicit exclusions. The existing `yarramate check` command validates the
manifest against valid JSON Schema 2020-12 documents, their declared format
identities, and package exports instead of adding another command family.
Optional adapter contracts remain outside Core, and the manifest is an
implementation inventory rather than certification or an architecture-quality
assessment.

## Status

Accepted.
