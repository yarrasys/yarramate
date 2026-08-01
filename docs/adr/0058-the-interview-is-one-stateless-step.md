# The interview is one stateless step

Status: accepted

The interrogation engine could compute every open question, but nothing
drove the loop the product promises: agents batched whole models in one
pass, harnesses had to pass catalogue file paths — an implementation
detail leaked into the contract — and the one-question-at-a-time
discipline lived only as prose in a skill file, where it was ignored.

`yarramate design <workspace>` is the loop's ask-half: each invocation
recomputes the interview from model plus catalogue (ADR 0053) and emits
exactly the top open question — first open in wave order, then
catalogue order, a subject-scoped question serving its first subject
and reporting how many more share it — together with the subject's
one-hop brief slice (ADR 0055), the question's materiality and
resolution, per-wave progress, and the answer path (`apply`, then
re-run). "Which wave am I in" is an output of every step, never harness
state; a fresh agent resuming tomorrow gets the same answer from the
same model with no handover.

The catalogue is internal: the shipped design path resolves from the
installed package and never crosses the harness boundary;
`--catalogue` exists only for teams authoring their own. `--subject`
narrows the interview to one thing's open questions for focused
maintenance or parallel agents. There is deliberately no wave
override — jumping the path is the freehand failure the command exists
to prevent; anyone who wants the whole agenda reads it, they do not
skip it.

The machine form is `yarramate/design-step/v1`; a completed interview
returns a null step and exit 0, because an agenda is never a gate.
