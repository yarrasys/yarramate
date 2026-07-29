# Projections are scaffolded through validated writes

Status: accepted

`add` and `connect` established the write discipline for concepts and
relationships: compose, validate, refuse to overwrite, then write. Yet
projections — the artifact every journey authors most often — still
required raw YAML, which is exactly where agent error rates concentrate.

`yarramate new projection <path>` extends the same discipline: it composes
a projection from explicit flags, validates the composed source through
the same loader `check` uses, refuses to touch an existing file, and only
then writes. At least one selector is required so an unselective
projection cannot be scaffolded by accident; the workspace manifest is
never edited, and the command reminds the author to include the file when
no glob covers it.

Other artifact families follow the same pattern when their shape permits:
evidence scaffolds are deferred until a structurally valid empty overlay
exists, and states are document members rather than standalone files, so
neither is forced into this command prematurely.
