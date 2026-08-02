---
name: yarramate-architecture
description: Discover, design, or maintain repository architecture using native YarraMate documents and the stable CLI. Use when an agent needs to map a codebase, propose an evidence-backed architecture model, brainstorm solution alternatives, evolve a model that already validates, rename or replace semantic subjects safely, define current/transition/target architecture, reconcile intent with evidence, or provide bounded architecture context to implementation work.
---

# YarraMate architecture

Use one repository-native lifecycle for discovery, design, and maintenance:

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

When a workspace already exists, orient first with one call before choosing:

```sh
yarramate ask <workspace.yaml>
```

It reports the check verdict, the reconciliation summary, the open
design questions, and the backlog — planned subjects in dependency
order. `ask <workspace.yaml> --subjects` lists every concept;
`ask <workspace.yaml> --kinds` lists the declarable vocabulary;
`ask <workspace.yaml> "<free text>"` returns the model slice matching
your words; `ask <workspace.yaml> --where "<free text>"` returns the
evidence-verified code locations of matching subjects — prefer those
over searching when the subject is modeled, and use your own search
tools beyond the coverage boundary the output states.

- Existing implementation is the starting point: follow **Discover an
  existing project**.
- Intent and a not-yet-built solution are the starting point: follow **Design
  a new solution**.
- A validating native model must change: follow **Maintain an existing
  model**.
- Declared architecture and implementation both exist but no model change is
  requested: begin with discovery,
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
5. Land additions as one atomic `yarramate apply` batch
   (`yarramate/operations/v1`): any invalid operation rejects the whole
   batch, so the model never holds a partial edit. Edit YAML directly
   when states or several related declarations make that clearer.
6. Add an evidence overlay only for existing subjects or stable claim IDs.
   Evidence supports or challenges the proposal; it is not a second model.
7. Add the focused projections needed to answer the
   repository-orientation question. Add a separate projection for every
   ordered flow that needs a dynamic view, then include each intended view in
   `.yarramate/likec4-project.yaml`.
8. Unless the user requested semantic-only output, create the optional LikeC4
   mapping and project described in the authoring reference. Synchronize the
   project mapping before every export, then run:

```sh
yarramate check .yarramate/workspace.yaml --json
yarramate export graph .yarramate/workspace.yaml
yarramate reconcile .yarramate/workspace.yaml
yarramate ask .yarramate/workspace.yaml .yarramate/projections/<projection>.yaml
yarramate export markdown .yarramate/projections/<projection>.yaml .yarramate/workspace.yaml
yarramate-likec4 check .yarramate/likec4-project.yaml --json .yarramate/workspace.yaml
yarramate-likec4 map --sync .yarramate/integrations/likec4/subject-mapping.yaml .yarramate/workspace.yaml
yarramate-likec4 export-project .yarramate/likec4-project.yaml .yarramate-out/likec4 .yarramate/workspace.yaml
```

9. Audit rendering coverage before handoff. Answer these as reporting
   questions, not Core correctness rules:
   - Which concepts appear in no projection?
   - Which ordered relationship chains have no dynamic view?
   - Which projections are absent from the LikeC4 project?
   Inspect compiled subjects, projection results, and the project definition;
   state intentional omissions explicitly. A green check does not answer
   these questions.
10. Present observations, reconciliation findings, interpretive proposals,
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
   After structuring what is stated, run the interview loop for what is not:

```sh
yarramate design .yarramate/workspace.yaml
```

   Each invocation serves exactly the top open question with its subject
   slice, materiality, and progress — the catalogue is internal; never pass
   or read catalogue files. Answer one question at a time: questions the
   model or evidence can answer, answer from your authority; questions
   marked `human`, relay verbatim with their materiality. Land each answer
   as one atomic batch (`yarramate apply <operations.yaml>
   .yarramate/workspace.yaml`), then re-run `design` — the next question is
   recomputed from the model, so the loop is resumable across sessions and
   agents with no handover. Use `--subject <id>` to focus the interview on
   one element. When a step reports many `openSubjects` sharing one
   question (ownership is the classic case), do not interview N times:
   collect the policy answer once — "who owns what, by area" — and land it
   across every listed subject as one apply batch. The interview is
   complete when `design` says so.
5. Create:
   - an alternatives projection for the decision;
   - a bounded target projection for implementation agents.
   - one focused projection per ordered flow that needs a dynamic view.
   Include every intended view in
   `.yarramate/likec4-project.yaml`.
6. Synchronize the project mapping before every export, then run:

```sh
yarramate check .yarramate/workspace.yaml --json
yarramate export graph .yarramate/workspace.yaml
yarramate ask .yarramate/workspace.yaml .yarramate/projections/<alternatives>.yaml
yarramate ask .yarramate/workspace.yaml .yarramate/projections/<target>.yaml
yarramate export markdown .yarramate/projections/<target>.yaml .yarramate/workspace.yaml
yarramate export markdown .yarramate/projections/<flow>.yaml .yarramate/workspace.yaml
yarramate export briefs .yarramate/projections/<target>.yaml .yarramate/workspace.yaml --out <handoff-dir>
yarramate ask .yarramate/workspace.yaml --compare <document-id>#<baseline-state> <document-id>#<target-state>
yarramate-likec4 check .yarramate/likec4-project.yaml --json .yarramate/workspace.yaml
yarramate-likec4 map --sync .yarramate/integrations/likec4/subject-mapping.yaml .yarramate/workspace.yaml
yarramate-likec4 export-project .yarramate/likec4-project.yaml .yarramate-out/likec4 .yarramate/workspace.yaml
```

   Skip the two adapter commands only when the user requested semantic-only
   output, and report that no visual project was produced.
7. Audit rendering coverage using the same three reporting questions from
   discovery. State which omissions are intentional; do not convert partial
   coverage into a validation failure.
8. Present alternatives, selected intent, unresolved decisions, and bounded
   implementation context. Hand implementation work the brief rendering of
   its target slice (`yarramate ask <workspace.yaml> <projection.yaml>`,
   or the `export briefs` bundle for several implementers) — deterministic
   prose composed from the checked model — rather than raw YAML. Do not
   generate code until the requested design decision is reviewable.

## Maintain an existing model

Use this journey for a deliberate change to a model that already passes its
checks, including a renamed subject, resolved gap, changed relationship, or
retired concept.

1. Discover the authored layout before assuming paths:
   - read the workspace `documents`, `projections`, `adapterMappings`, and
     `evidence` entries;
   - locate any `yarramate/likec4-project/v1` document and follow its `mapping`
     field;
   - treat paths shown below as examples, not required repository layout.
   Discover the repository’s authored paths instead of assuming these examples.
2. Establish a passing baseline with Core and every configured read-only
   adapter check. If the baseline already fails, separate those pre-existing
   diagnostics from the requested maintenance change.
3. Before changing an identity, search its local and globally qualified forms
   across every workspace input. Account for:
   - `references[].ref` citations;
   - relationship `from` and `to` endpoints;
   - evidence `subject` entries and stable claim targets;
   - adapter mapping `native` entries;
   - projection selectors, architecture states, ownership, and constraints.
4. Make the smallest coherent edit and update all referring authored inputs.
   Do not rewrite unrelated architectural intent.
5. Run the read-only checks before any repair command so drift remains
   observable:

```sh
yarramate check .yarramate/workspace.yaml --json
yarramate-likec4 check .yarramate/likec4-project.yaml --json .yarramate/workspace.yaml
```

6. If the adapter check reports intended mapping drift, repair it locally,
   inspect the tracked diff, then verify again. Use `--prune` only after
   confirming that stale native subjects were intentionally renamed or
   removed:

```sh
yarramate-likec4 map --sync --prune .yarramate/integrations/likec4/subject-mapping.yaml .yarramate/workspace.yaml
git diff -- .yarramate
yarramate check .yarramate/workspace.yaml --json
yarramate-likec4 check .yarramate/likec4-project.yaml --json .yarramate/workspace.yaml
yarramate-likec4 export-project .yarramate/likec4-project.yaml .yarramate-out/likec4 .yarramate/workspace.yaml
```

7. Require both configured read-only checks to exit successfully after the
   edit. The maintained model must pass before handoff. Report changed
   identities, updated dependants, mapping repairs, generated output, and any
   intentionally deferred architecture work.

## Correctness and authority

- Treat `check` as deterministic correctness, never as architecture approval,
  completeness, or quality scoring.
- A repair command cannot serve as verification. Run read-only adapter checks
  before `map --sync`, use sync only while authoring, and never put sync in a
  CI verification gate.
- Keep LikeC4 optional. Default to visual output for these guided journeys,
  but respect an explicit request for tool-neutral semantic output only.
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
- projections and views produced, including the LikeC4 project and generated
  output path;
- rendering coverage gaps and whether the generated output is current;
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
