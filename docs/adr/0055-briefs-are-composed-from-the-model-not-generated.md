# Briefs are composed from the model, not generated

Status: accepted

ADR 0054 promised task agents prose rendered from the checked model, but
the only prose surface was the budgeted digest — id lists and arrows that
recorded zero use in real agent work. The outbound half of the thesis had
no implementation.

`context --brief` renders a projection (or ad-hoc neighbourhood) as a
prose brief. Composition is deterministic: sentence templates over each
kind's declared intent, using the same core readings that order work in
ADR 0048 — the source of `serving` "serves", `access` "reads" or "writes"
by mode, `realization` "realizes", `flow` "sends its content to" — with
custom kinds resolved to their nearest core ancestor through profile
lineage. No LLM is involved; the same model and projection produce a
byte-identical brief.

The brief opens with the motivation concepts, quoting requirement and
constraint bodies verbatim rather than paraphrasing, because the
interview's waves establish that "why" precedes "what". Lifecycle status
chooses the sentence frame: planned subjects read "you are building",
current ones "already exists". Under `--budget`, whole paragraphs compete
for the budget in priority order — motivation, then planned work, then
existing context — and every omission is announced, per ADR 0042; a
truncated sentence would be prose that lies about its own completeness.

The digest and JSON modes are unchanged; the brief is a third output mode
of the same seam, not a new command, because the projection already
answers the only scoping question a brief has.
