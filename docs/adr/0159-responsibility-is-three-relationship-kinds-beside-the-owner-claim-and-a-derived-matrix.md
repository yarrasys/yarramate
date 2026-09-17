# Responsibility is three relationship kinds beside the owner claim, and a derived matrix

Status: accepted

ApertureX is adding a RACI matrix (Responsible, Accountable, Consulted,
Informed) for the project-manager role its forward deployed engineers take
on an engagement (#557, yarrasys/apx#63). The engine already held the
people and most of the edges; what it could not hold was the letter. On
their reference project eight people carry 105 edges, every one an untyped
`association` to a requirement, a constraint, a goal or a policy, and the
RACI facts live in prose: "Business owner. Accepts UAT into production;
receives the daily attendance digest." A sentence is invisible to the
interrogation, the RTM, the workbook and every export.

What the model could say before this decision: Accountable, as the
`yarramate/ownership/owner` claim. Consulted, only as the `by` of an
attestation, which is a judgement on a topic on a date rather than a
standing role. Responsible and Informed, nothing.

## Decision

**Three relationship kinds, `responsible`, `consulted` and `informed`, each
a subkind of core `association` from a person to the subject they answer
for.** Source aspects are `active-structure` and `motivation`, so an actor,
a role, a collaboration or a stakeholder may hold a letter and the
ArchiMate table bounds the target as it bounds any association. Ids are
bare words like every other kind (`serving`, `assignment`, `implements`);
the preposition lives in the reading phrase the canvas and the brief speak:
"is responsible for", "is consulted on", "is informed of".

**Accountable is not a fourth kind.** It is the existing `owner` claim:
single-valued, so "exactly one A per subject" holds by construction, and
already what projections filter and draw by and what the workbook's Owner
column writes back.

**The kinds live in the shipped policy profile, as a new version
`yarramate/policy@0.2` that extends `yarramate/policy@0.1`.** A profile's
`extends` is one identity, and every adopter profile already extends
policy; a separate responsibility profile could only reach them by re-basing
away from policy or by chaining responsibility over policy, which is the
wrong is-a. Policy is the shipped optional profile for governance
vocabulary: what must hold (the constraint kinds, ADR 0095) and now who
answers for it. A vocabulary version is a contract that a consumer's own
profile-binding guard reads, so the kinds go in a new version rather than
into 0.1 in place; 0.2 adds only the three kinds, every 0.1 identity keeps
resolving, and 0.1 stays shipped so nobody is moved. The compiler injects a
shipped profile's own parent behind it, so `extends: yarramate/policy@0.2`
is the whole adoption.

**A derived matrix, `yarramate/responsibility/v1`, built the way the RTM is
built (ADR 0071) and never authored.** Rows are the subjects the caller
selects, usually a projection's; columns are every person the model holds;
a cell is the letters one person carries on one row, each letter with the
authored line that put it there. `gaps` lists rows with no A and rows with
no R; `idle` lists people with no letter on any row, each flagged `served`
so a renderer can leave a consumer out. `yarramate export responsibility
<projection> <workspace> --out <dir>` writes `RESPONSIBILITY.md` and
`responsibility.json`; `yarramate_export` takes `kind: responsibility`; the
schema is registered in the Core contract.

**Consulted also derives from attestation authorities.** An attestation's
`by` compiles to a subject reference, so the derivation is grounded. A
recorded judgement is not a standing role, so the cell carries provenance:
`{ kind: 'attestation', topic, on }` beside `{ kind: 'relationship', … }`,
the markdown marks an attestation-only C with an asterisk, nothing is
written back as an edge, and a derived C never fills a gap.

**Two questions in the shipped catalogue, guarded by a new condition.**
`responsible-missing` asks who is responsible for a service, component or
capability with no incoming `responsible` edge from a person, beside
`owner-missing`. `role-idle` asks what a business actor, role or
collaboration answers for when nobody's owner claim names them, they hold
no responsibility edge, and nothing serves them: a served actor is a
consumer, not a responsibility holder, and is not asked. Both open with
`profile-loaded: yarramate/policy@0.2`, a new workspace-scope condition,
because a `missing-*` trigger that names an optional profile's kinds would
otherwise hold on every workspace that never adopted the vocabulary, the
self-model included. The condition is the general answer to that trap, not
a special case for these two.

**On the canvas, responsibility edges are hidden by default.** A role
responsible for eight applications is eight lines out of one box. The
projection gains a `showResponsibility` presentation flag, off when absent,
with a toggle beside the badges; whatever the flag says, the subject's
properties read the letters, "Responsible: Guest Services Manager", and a
person's read what they are responsible for, consulted on and informed of.

## Consequences

Nothing on the wire changes shape: a canvas edge carries two optional
fields, `readingKind` and `responsibility`, and the visual-graph schema
admits them. Nothing in the workbook changes: `02 Relationships` already
round-trips any relationship kind and the Owner column already exists.

An adopter that specialises a kind (`delivery-lead` with parent
`yarramate/policy@0.2#responsible`) gets the letter, the reading and the
question for free, through the lineage, as every selector in the catalogue
already matches descendants.

A requirement or constraint row takes no A from a signing association: the
matrix is owner-based, and an adopter that reads sign-off as accountability
adds those rows on its side. A per-kind "accountable via" option is a small
later extension if that proves out; it is not built here.

The interrogation semantics version stays at 1: a condition was added and no
existing question answers differently for an unchanged model, which is the
distinction the fingerprint test draws.
