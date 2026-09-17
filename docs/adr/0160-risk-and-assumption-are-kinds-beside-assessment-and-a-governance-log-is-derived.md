# Risk and assumption are kinds beside assessment, and a governance log is derived

Status: accepted

A project manager keeps a RAID log: risks, assumptions, issues,
dependencies and, in practice, decisions. The delivery template ApertureX
mirrors carries it as a sheet with six types (#560, yarrasys/apx#64). Two
of the six are this engine's core already: a constraint is a subject, and
an open question is the interrogation report. Issues are records of the
engagement and live in the adopter's control plane; dependencies are the
graph. Three had no home in the vocabulary: risk, assumption, decision.

What the model could say before this decision: a risk is an `assessment`
the catalogue asks about (`assessment-unlinked`, `gap-unaddressed`) with no
kind, so no reading, no mitigation link and no review; an assumption is an
attestation nobody with authority has confirmed, with no subject to hang it
on; a decision is a `courseOfAction` with `supersedes` and nothing else.

## Decision

**Two concept kinds, `risk` and `assumption`, each a subkind of core
`assessment`, in `yarramate/policy@0.3`, which extends 0.2 the way 0.2
extends 0.1 (ADR 0159).** Additive: every earlier identity keeps resolving,
the compiler brings the chain in behind one `extends` line, and the
relationship table needs nothing, since `assessment` already carries
`influence` and `association` to and from the kinds a RAID log names.
Lifecycle is `status` and nothing new: `planned` is identified or
unconfirmed, `current` is live or confirmed, `retired` is closed, accepted
or invalidated.

**Decision is not shipped yet.** Nabeel's decision was a model for the
first two and a trial for the third, and a profile is the place to run a
trial: the adopter's own `decision` with parent `courseOfAction` compiles
today, gets `supersedes`, `status` and the catalogue's `isolated` for free,
and promotes to a shipped kind with a parent swap once the trial says what
the context, alternatives and consequences of an ADR need.

**Readings the endpoints decide.** Before this decision a reading was
keyed by the relationship kind alone (`RELATIONSHIP_READING`, and since ADR
0159 `EXTENSION_READING` by extension identity). A risk *threatens* the
goal it influences, where anything else *influences* it; a work package,
deliverable, constraint or decision *mitigates* the risk it influences; an
assumption *bears on* what it associates. So `contextualReading` consults
two small tables, keyed by the source kind's identity and then the
target's, each by the relationship's core kind, and resolves through the
endpoint lineages so a profile's subkind of `risk` threatens too. The
canvas edge carries the resolved phrase as `reading`, the label mapper
speaks it before any kind reading, and the brief says the same sentence.
Whether a profile may declare its own readings is a later question; a
trial kind reads as `humanizeKind` does until then.

**Review dates are attestations**, Nabeel's decision and the same shape
`stale-attestation` already reads: `risk-reviewed` on a risk by its owner
or the client role, `assumption-confirmed` on an assumption by whoever can
confirm it. The engine reports the latest one; how old is too old is the
adopter's threshold.

**A derived log, `yarramate/governance/v1`, built like the responsibility
matrix and never authored.** One row per risk or assumption with its
owner, status, description, what it threatens (a risk's outgoing
influence) or bears on (an assumption's outgoing association), what
mitigates it (incoming influence or association), the latest review, what
it supersedes, and `groupedBy`: the groupings that aggregate it, which is
how an adopter's severity and likelihood classes ride the report without
the engine learning a scale. `gaps` lists the unowned, the current risks
nothing mitigates, the unconfirmed assumptions and the unreviewed risks.
`yarramate export governance <workspace> --out <dir>` writes `GOVERNANCE.md`
and `governance.json`; `yarramate_export` takes `kind: governance`;
`buildGovernanceLog` and `exportGovernance` are on `yarramate/tools`; the
schema is registered in the Core contract. Whole-workspace, like the RTM.

**Five questions in the shipped catalogue**, dormant on any workspace that
has not adopted policy@0.3, by the applicability rule ADR 0159 records:
`risk-threatens-nothing`, `risk-unmitigated` (current risks only),
`risk-unowned`, `assumption-unconfirmed` (authority human) and
`assumption-bears-on-nothing`, each on planned and current subjects. The
decision question waits for the kind.

## Consequences

Nothing on the wire changes shape: a canvas edge gains one optional field,
`reading`, and the visual-graph schema admits it. Nothing in the workbook
changes.

A trial `decision` kind reads its edges as "influences" and "is associated
with" until it is shipped with its readings ("applies to", "addresses");
the adopter's sheet names the type from the kind, not from the phrase, so
the trial loses nothing it needs.

The self-model gains the log's function, data object and schema artifact.
The interrogation semantics version stays at 1: no condition was added and
no existing question answers differently for an unchanged model.
