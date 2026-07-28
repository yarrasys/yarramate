---
name: yarramate-architecture
description: Discover architecture in an existing repository or design a new solution before implementation using native YarraMate documents and the stable CLI. Use when an agent needs to map a codebase, propose an evidence-backed architecture model, brainstorm solution alternatives, define current/transition/target architecture, reconcile intent with evidence, or provide bounded architecture context to implementation work.
---

# YarraMate architecture

Use one repository-native lifecycle for discovery and design:

```text
evidence or design conversation
  -> native-document proposal
  -> deterministic CLI checks and projections
  -> Git review
  -> declared architectural intent
  -> later evidence and reconciliation
```

Native YarraMate documents are canonical. Generated graphs, Markdown, JSON
context, and diagrams are derived. Never promote evidence into declared intent
automatically.

## Choose the journey

- Existing implementation is the starting point: follow **Discover an
  existing project**.
- Intent and a not-yet-built solution are the starting point: follow **Design
  a new solution**.
- Declared architecture and implementation both exist: begin with discovery,
  preserve the declared model, then report supported, contradicted, unknown,
  and unobserved claims without silently rewriting it.

Read [references/journey-checklists.md](references/journey-checklists.md) for
the minimum evidence and design questions. Read
[references/native-authoring.md](references/native-authoring.md) when native
document, projection, evidence, or architecture-state syntax is needed.

## Discover an existing project

1. Inspect repository instructions, structure, manifests, dependencies,
   entrypoints, tests, deployment files, and existing architecture sources.
2. If no workspace exists, run `yarramate init .`. Do not overwrite an
   existing `.yarramate/`.
3. Separate direct observations from architectural interpretation. Record the
   inspected repository locations before proposing semantic concepts.
4. Propose the smallest useful native model:
   - stable responsibilities and externally meaningful services;
   - principal information and dependencies;
   - significant actors, constraints, and ownership only when supported;
   - current state by default; do not infer target intent from code.
5. Prefer `yarramate add` and `yarramate connect` for simple additions. Edit
   YAML directly when states or several related declarations make that clearer.
6. Add an evidence overlay only for existing subjects or stable claim IDs.
   Evidence supports or challenges the proposal; it is not a second model.
7. Add one focused projection that answers the repository-orientation
   question.
8. Run:

```sh
yarramate check .yarramate/workspace.yaml --json
yarramate evidence .yarramate/evidence/<evidence>.yaml .yarramate/workspace.yaml
yarramate reconcile .yarramate/workspace.yaml
yarramate context .yarramate/projections/<projection>.yaml .yarramate/workspace.yaml
yarramate view .yarramate/projections/<projection>.yaml .yarramate/workspace.yaml
```

9. Present observations, reconciliation findings, interpretive proposals,
   evidence gaps, and Git diff separately. Do not claim completeness from a
   green check and do not automatically turn findings into edits.

## Design a new solution

1. Capture the decision context before components:
   - drivers, stakeholders, desired outcomes, and constraints;
   - material assumptions and unresolved questions;
   - boundaries and responsibilities.
2. Model only materially different alternatives. Use stable concepts and
   relationships; do not hide an alternative in free-form metadata.
3. Record the selected approach through explicit relationships and focused
   projections. Use architecture states when baseline, transition, or target
   presence matters; do not misuse lifecycle status as a decision verdict.
4. Add the principal services, components, information, responsibilities, and
   dependencies required to begin implementation. Partial detail is valid.
5. Create:
   - an alternatives projection for the decision;
   - a bounded target projection for implementation agents.
6. Run:

```sh
yarramate check .yarramate/workspace.yaml --json
yarramate context .yarramate/projections/<alternatives>.yaml .yarramate/workspace.yaml
yarramate context .yarramate/projections/<target>.yaml .yarramate/workspace.yaml
yarramate view .yarramate/projections/<target>.yaml .yarramate/workspace.yaml
yarramate compare <baseline-state> <target-state> .yarramate/workspace.yaml
```

7. Present alternatives, selected intent, unresolved decisions, and bounded
   implementation context. Do not generate code until the requested design
   decision is reviewable.

## Correctness and authority

- Treat `check` as deterministic correctness, never as architecture approval,
  completeness, or quality scoring.
- Keep adapter fields outside native documents.
- Use globally qualified identities at CLI and projection boundaries.
- Preserve source-located diagnostics verbatim when asking the author to fix
  input.
- Let Git provide authorship, review, history, and acceptance.
- Stop for user direction when a choice changes the solution boundary,
  selected alternative, authoritative constraint, or product contract.
- Do not introduce a database, server, approval workflow, or harness-specific
  canonical format.

## Handoff

Report:

- journey used and question answered;
- canonical files proposed or changed;
- observations and evidence results;
- projections produced;
- validation commands and outcomes;
- unresolved architectural decisions;
- whether changes are merely proposed or already accepted in Git.

If YarraMate itself produced confusing behaviour, blocked adoption, lacked a
needed capability, or required an awkward workaround, identify that separately
as product feedback and direct the user to:

`https://github.com/yarrasys/yarramate/issues/new`

Issues may contain incomplete ideas or early observations; a proposed fix is
not required. Do not create an external issue automatically unless the user
asks you to.
