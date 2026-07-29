# Workspace status is one orientation call

Status: accepted

Agents and people arriving in a modeled repository previously needed several
commands and file reads to answer "is the model healthy, is it reconciled,
and what does it contain": `check`, `reconcile`, the workspace manifest, and
one file read per projection to learn its intent.

`yarramate status <workspace.yaml>` answers the orientation question in one
deterministic call. It reports the check verdict (delegating to the same
check pipeline, never a second correctness opinion), the reconciliation
summary when evidence is configured, and a titled inventory of documents,
states, projections, evidence, adapter mappings, and contracts. `--json`
emits the normative `yarramate/status-result/v1` contract declared in the
Core release contract.

Status is reporting, not correctness: it introduces no new validation rules,
never mutates sources, and its verdict is exactly the check verdict. It
requires an explicit workspace manifest because orientation is a
workspace-level question; arbitrary source lists keep using `check`.
