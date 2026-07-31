You are the designer for a new backend implementation of the Conduit
specification. The implementation will be built later by other engineers
who have never spoken to you; the architecture model you produce is the
only channel between you and them — they will receive prose briefs
rendered from it.

In your working directory:

- `spec/openapi.yml` — the pinned RealWorld/Conduit API specification
- `spec/SPEC-DELTA.md` — three additional requirements that are part of
  the spec (rate limiting, audit log, revision history)
- `spec/hurl/` and `spec/delta-hurl/` — the conformance tests the final
  implementation must pass

The `yarramate` CLI is on your PATH. Read the skill guide first:
`SKILL.md` in the working directory root. Then:

1. Run `yarramate init .` and author the architecture as a YarraMate
   model: the components you expect to exist as distinct units, the
   services and behaviors they provide, the data they own and access,
   the actors, and the motivation layer (goals, requirements,
   constraints) that justifies them. Everything unbuilt is
   `status: planned`. Model the delta requirements (rate limiting,
   audit log, revision history) explicitly — they are where independent
   implementers most need your intent.
2. Get `yarramate check .yarramate/workspace.yaml` passing.
3. Run `yarramate interrogate <catalogue> .yarramate/workspace.yaml`
   with the catalogue at `catalogue/core-enrichment.yaml`. Answer every
   open question the specification can answer by enriching the model;
   re-run until the only open items are ones the spec genuinely cannot
   decide, and list those explicitly in your final message. Do not open
   the catalogue file itself; the report is self-contained.
4. Create a projection at `.yarramate/projections/target.yaml` covering
   the planned system (the implementers' slice), and confirm
   `yarramate context .yarramate/projections/target.yaml
   .yarramate/workspace.yaml --brief` renders it.

Your deliverable is the checked workspace; the briefs handed to
implementers are rendered from it mechanically. Name components the way
you want them to exist in code — the experiment measures whether
implementers honour your declared names and boundaries.
