# Facilitation is a rendering, not a second interview

Status: accepted

The catalogue's questions are phrased for agents and modelers:
"Nothing realizes X. What will fulfil it, or is it out of scope?" A
business analyst running the interview live in a stakeholder workshop
needs the same question in room language: "Who or what is going to
make this happen, or should we agree to drop it?" (#152). Two
phrasings of one question, never two questions.

Decided: an optional `askPlain` field per catalogue question, and a
`design --facilitate` flag that prefers it in the human question line.
Everything else is deliberately unchanged: the same top-step
selection, the same subject slice, the same materiality and resolution
guidance, the same answer path through `apply`. Answers given in the
room land as ordinary reviewed operations batches, so the model
becomes the meeting minutes. Attribution stays a git concern: no `by:`
field was added to apply batches, because commits already carry the
author and the review.

The boundaries:

- **Fallback, never blocking.** A question without `askPlain` renders
  its standard phrasing under `--facilitate`. Authoring plain copy is
  catalogue work, not an engine requirement.
- **The envelope is flag-independent.** The design step carries
  `askPlain` additively whenever the selected question provides one,
  with the same `{subject.id}` and `{subject.name}` interpolation as
  the standard phrasing. `--facilitate --json` is accepted and
  identical to `--json`: facilitation is presentation, and a harness
  building its own workshop surface reads the field without the flag.
  The interrogation report (`ask --open`) is untouched; design looks
  the phrasing up from the catalogue it already loaded.
- **Additive, so a minor bump.** Per ADR 0063 the catalogue moves 0.5
  to 0.6: a new optional field on existing questions, no new
  questions, no trigger changes, no new `since` values. A complete
  interview stays complete.
- **Only the waves a workshop reaches.** Motivation and business carry
  `askPlain`; application, technology, implementation, and hygiene
  stay standard, because those questions are answered at the keyboard
  and the fallback covers them. The slice rendering is also unchanged
  first pass: the brief's prose is already close to room-appropriate.
- **No authority filter.** The top-open-question selection is
  identical under the flag. The workshop agenda emerges from wave
  order, since the early waves are `human` and `either` authority, not
  from a new interview mode.
- The MCP design tool is unchanged: it always requests `--json`, and
  the envelope already carries the phrasing.
