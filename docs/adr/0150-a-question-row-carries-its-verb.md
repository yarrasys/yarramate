# A question row carries its verb

Status: accepted

## Context

ADR 0111 put the interview on the canvas: a count chip per subject and an
Open questions section that scopes to the selection. ADR 0110 put the answer
shape on the design step: the catalogue conditions that opened a question,
verbatim, so a host could build the answering affordance instead of
re-deriving it from its own catalogue copy. The two never met. The row the
editor received carried the phrasing, the authority and a version, so the
section could show a question and could not act on one, and neither could a
menu or a chip.

On 2026-09-13 the try-it page prototype made the cost visible twice. First
the section was measured at 3 px of body with one question open, because
the stack gave the palette a third of the column and an empty Changes tray a
fixed fifth, and the questions had no rule at all; Nabeel read it as missing
and asked whether it was an ApertureX-only feature. Then, once it had room,
the only way to answer the question it showed was to leave it, find the
subject, press Connect, and know which kind the question had meant. Issue
#515, with #516 for the menu.

## Decision

1. **The row carries its answer shape.** `VisualQuestionEntry` gains
   `scope`, `materiality`, `resolution` and `trigger`, copied from the report
   question by every host that builds the overlay. All four are optional in
   the type, so a host that constructs rows by hand (rule: readers and
   constructors are not the same consumer) is not broken by fields only the
   pane reads.
2. **One verb per question, from a table, not from the phrasing.**
   `verbFor(entry)` in `question-verbs.ts` maps the first condition the table
   knows to a gesture the surface already has: `missing-relationship` and
   `missing-linkage` arm the connection tool with the trigger's kinds and
   direction; `isolated` arms it with everything; `no-subject-of-kind` opens
   the Add-subject form with the first kind preselected; `missing-claim`,
   `missing-reference`, `missing-constraint`, `missing-attestation` and
   `missing-part` put the properties panel in front. A condition the table
   does not know yields no verb, and the row stays a question a person reads.
   Nothing here is a second write path: every verb dispatches what its
   on-screen twin dispatches, and whatever it stages lands through the
   changeset.
3. **The connection tool learns a direction and a narrowing.** A question
   that asks what realizes, influences or serves a subject wants a
   relationship that ends at the subject, and the tool only ever drew from
   one. `ConnectionDraft` gains optional `kinds` and `direction`; with
   `incoming` the panel consults the relationship table from the target to
   the subject and drafts the edge that way round. The kinds the question
   named are offered first; the rest of what the table permits stays
   reachable under "Other relationships the table permits", because the
   question is one reading of the gap and the reviewer may know better. When
   the asked kinds are not permitted between the two, the panel says so and
   offers what is.
4. **The section gets room, and an empty section yields it.** The questions
   section shares the slack with properties, capped at half the column; a
   section with nothing open, a shut section, and a Changes tray with
   nothing staged size to their content instead of holding space.
5. **A viewer keeps reading.** Under `readOnly` (ADR 0117) rows carry no
   verb; a host that mounts the pane without the gestures passes no `onVerb`
   and gets the same.

## Consequences

- The overlay grows by three strings and a small array per open question.
  Measured on the repository's own model it is well under the graph it
  travels beside.
- The materiality is on the row as the question's tooltip, not as a second
  line: rows are read far more often than answered, and the section is
  shared with three others.
- "Not applicable here" (a dismissal, ADR 0077) is not on the row yet. A
  dismissal is a stored judgment the host owns; the local host has a
  `dismissed` option but no store to write one to, so the verb waits for a
  host that can keep it.
- "Answer via agent" is the next part of #515 and builds on the same row.
- #516 puts the same verbs in the subject context menu and behind the chip.

## Verification

- `question-verbs.test.ts`: one real trigger per condition from the shipped
  catalogue, each mapped to its verb, direction and kinds; the unknown ones
  to none; a workspace-scoped describe to none.
- `open-questions.test.ts`: a row with a trigger renders its verb button and
  its materiality title; `readOnly` and a missing `onVerb` render none.
- `visual-workspace-model.test.ts`: the overlay rows carry scope, materiality,
  resolution and trigger from the report.
- `visual-workspace-state.test.ts`: `connection.started` keeps kinds and
  direction on the draft, and a plain start keeps neither.
- `connection-panel.test.ts`: an incoming draft consults the table the other
  way round and drafts the edge that way round; asked kinds come first with
  the rest under a rule; asked kinds the table refuses produce the note.
- In a browser, on the Halcyon seed with four sections mounted and the
  palette open: before, the questions body measured 3 px against 132 px of
  content beside a 167 px tray holding nothing; after, 95 px of body (the
  section at its 128 px floor, properties at 256 px) and the empty tray at
  its 33 px header. The director's row offered "Connect what it influences
  or is associated with…"; the tool armed from the director, the target
  search found the driver, exactly `association` and `influence` were
  offered, `influence` staged, Commit landed it in the record, and the
  director's section read "nothing open" on the next frame while the goal's
  row offered "Fill it in under properties…".
- Five mutations, each red: the overlay dropping the trigger; the panel
  ignoring the direction; the panel never narrowing; viewers getting verbs;
  every question arming outgoing.
