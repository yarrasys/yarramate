# Prose is the interface, structure is the guarantee

Status: accepted

Two observations forced a decision about what the model is for. First, the
engine verifies wiring, never words: a requirement whose description asserts
the opposite of the truth still passes `check`, while a single dangling
reference fails with a file and line. The guarantees stop exactly where prose
meaning begins. Second, real usage showed agents neither authored nor read
the model willingly — bulk YAML beat the validated writes, rendered context
went unused during implementation, and when the vocabulary resisted, agents
smuggled meaning through free-text descriptions. Structured YAML is the form
language models handle worst; prose is the form they handle best.

The decision: the model is the substrate, not the surface. People and agents
interact in prose — design conversations in, interview questions and
implementation briefs out — and every rendered sentence stands on a checked
graph, so names are real, references resolve, drift is detected, and the
same truth reaches every consumer. What structure alone can hold — identity,
referential integrity, reconciliation against code, bounded slicing,
deterministic gap detection — is the guarantee. What prose alone can hold —
meaning, nuance, rules, taste — is the interface. Neither is asked to do
the other's job.

Both directions of the interface follow. Inbound, `interrogate` (ADR 0053)
drives the design conversation: deterministic detection of what the model
has not answered, rendered as prose questions with their materiality, with
answers structured back through validated writes and Git review. Outbound,
projections must render as genuine briefs — prose a task agent reads as a
colleague's handover, not an id digest. The budgeted context rendering is
the seam; its quality is now core product surface rather than an
afterthought, precisely because it was the half nobody used.

This retires the implication that agents should live inside the YAML. The
authoring surface remains for the structuring step and for humans at the Git
boundary, but the product is judged by the prose it emits and the guarantees
behind it — and its experiments must therefore hold format constant and vary
only whether a verified structure stands behind the words.
