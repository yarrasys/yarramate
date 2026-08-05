# The traceability matrix is a derived bundle

Status: accepted

Regulated contexts (IEC 62304, ISO 26262, DO-178C) maintain a
Requirements Traceability Matrix by hand, usually in a spreadsheet
that decays the day after review. The model already holds every column
of that artifact: drivers and goals influence requirements,
realization claims name what fulfils them, evidence observations
attach verdicts to the realizers, attestations record judgment, and
every one of those claims carries its authored file and line. An RTM
is therefore one more derived reading of the graph, not a new store.

Decided: `export rtm <workspace.yaml> --out <directory>` emits a
two-file bundle, `RTM.md` and `rtm.json`, the JSON versioned as
`yarramate/rtm/v1` with a schema registered in the core contract and
the package exports like every other machine format. Output is
byte-identical for identical inputs; rows sort by document then
subject id, and every nested list has a declared order. There is no
timestamp in the bundle: freshness is the caller's regeneration, not
a recorded clock.

Row scope is requirements and constraints. A constraint is the
requirement's stricter sibling in the profile's motivation layer, and
the audiences that ask for an RTM trace both. Other motivation
subjects (drivers, goals, principles, outcomes) are context, not
rows: they appear inside each row's lineage column and in a
"Motivation context" section, so the matrix stays a matrix instead of
becoming a second graph serialization.

Coverage is honest in both directions. A row with no realizer, or
whose only realizers are retired, is an explicit gap: marked in the
matrix, listed in a "Gaps" section, and counted in the summary, never
omitted. Retired rows move to a "Descoped (retired)" section and leave
the gap arithmetic; a closed question (ADR 0064) is neither covered
nor uncovered. Retired realization links are dropped from rows
entirely because listing them would overstate coverage.

Which kind of closure a descoped row records comes from the non-goal
predicate ADR 0073 already established, not a second copy of the rule.
A retired requirement is a declared non-goal: scope deliberately
declined, with the rationale in its description. A retired constraint
is deliberately outside that set, because retiring one lifts a rule
rather than declining scope. The RTM descopes both, since a lifted
rule is no longer an obligation to report against, and labels each so
a compliance reader sees which happened instead of inferring it.

Evidence verdicts come from the workspace's evidence overlay exactly
as `reconcile` reads it: observations that target a realizer subject
or its realization claim surface on that realizer, with provider and
locator. Attestation cells report presence only: topic, by, on, and
the authored line. Whether an attestation is stale is a separate
question with its own machinery; this export does not depend on it.

The command is named `rtm` because the audience for this artifact
searches for "RTM"; whether `traceability` deserves an alias is left
open deliberately. Per-state matrices (baseline, transition, target)
are also left open: the single matrix reads lifecycle status as a
column, and state-scoped rendering can layer on later without
changing the format.

Consequences: the buyer-facing claim becomes checkable ("your RTM is
generated, current, and every cell cites its source"), CI can diff
the JSON like any other result format, and the spreadsheet the model
replaces has nowhere left to drift.
