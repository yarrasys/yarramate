# Retired is a closed question

Status: accepted

Found by a cross-harness dogfood (a Codex session resuming the design
loop, 2026-08-01): a human explicitly descoped two requirements by
retiring them, and `requirement-unrealized` stayed open. The agent was
left with three bad options — a permanently open question, a false
realization, or bypassing `apply` to hand-edit YAML.

The evaluator now excludes `status: retired` subjects from the
enrichment target set entirely, alongside architecture states:
retirement is the recorded decision that a subject left the design
conversation, so no subject-scoped question stays open against it.
This is engine semantics, not per-question selector configuration —
a catalogue author cannot reintroduce interrogation of the past by
forgetting a status filter. Retired concepts still participate as
counterparts (a service realizing a retired requirement keeps its
linkage answered) and still appear in reads; they are simply no longer
asked to improve.

The catalogue (0.5) names the motion: the prescribed resolution for
unrealized requirements and goals now says to retire for descoping —
preserving the decision on record — and to delete only when the
history itself is noise. Deletion through `apply` (atomic
`delete-concept`/`delete-relationship` with reference validation)
remains unbuilt: with field retraction (ADR 0062) and status
retirement covering the honest cases, deletion stays a reviewed Git
edit until real usage demands otherwise.
