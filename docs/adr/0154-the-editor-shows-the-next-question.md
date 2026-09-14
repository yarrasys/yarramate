# The editor shows the next question

Status: accepted

The interview has always had a first question. `design` serves it: the
first open question in wave order, then catalogue order within the wave,
a subject-scoped question serving its first open subject. The editor never
showed it. The Open questions section lists every open row for the
selected subject, or every whole-model row when nothing is selected, and
the canvas counts them per subject (#292); a reader who wanted to know
where the interview goes next had to read the whole list and know the
rule. The yarramate.dev editor route put a "next question" card above the
editor for exactly that reason, and Nabeel took it down again: the
question belongs inside the instrument, in the bottom panel or on the
canvas (#534).

## Decision

The overlay names the next question, and the pane draws it in three
places, by default, with no new mount option.

- **`VisualInterrogationOverlay.next`** is the row `design` would serve
  first: a question entry plus its wave and, for a subject-scoped
  question, the subject's id and name. It is computed in
  `interrogationOverlayOf`, beside the lists, by the same walk that fills
  them: the first row kept is the next question, so the rule is written
  once and both hosts and the browser agree on which row it is. Absent
  when nothing is open, and readers treat absence as "no next question".
- **A "Next question" tab in the bottom panel**, first in the strip and
  the panel's default tab. The panel stays shut at rest (#248's rule
  stands: the canvas keeps the room), but the strip's status line says the
  question while it is shut, so the first paint of a record says where
  the interview goes. Opened, the tab says the question, where it is open
  ("about Water billing" or "the whole record"), why it matters and what
  would close it, and offers three doors: go there (select the subject as
  a tap would, or clear the selection for a whole-record question, and
  open the Open questions section), the row's verb (ADR 0150), and the
  assistant door (ADR 0151). A viewer keeps only the way there. A
  remembered tab the model cannot show falls back to the query tab, so the
  panel never opens on nothing.
- **A ringed count chip on the canvas** for the subject the next question
  is open for, behind the existing Open-question badges toggle; a folded
  box wears it for a member the way it carries the member's count. Quiet
  ink, never a fault colour, and still a count: the ring marks, it does
  not shout. A whole-record question marks no node; the strip carries it.
- **A "next" tag on the row** in the Open questions section, in the scope
  it is open for, so the list and the panel cannot disagree.

Beside this, the strip's status line and collapse control leave the
`tablist` (#529, the tablist half): only tabs are its children.

## Consequences

- yarramate.dev's editor route passes nothing and gets the card back
  inside the editor. ApertureX gets the same for free; its Open items
  queue keeps its own order, and if the two "next"s disagree in the field
  the answer is a mount option to hand `next` in or to hide the tab, which
  is a later decision with a consumer.
- The bottom panel's default tab id changes from `view-query` to
  `next-question`. Nothing on the wire names it; a host test that pinned
  the default would move.
- The wire grows one optional field; protocol version unchanged (readers
  optional, constructors may omit).

## Excluded

- Opening the panel by default when a next question exists. The site just
  fought for canvas height and ApertureX's consultants read the map first;
  the strip line is the compromise that says the question without taking
  the room.
- A canvas mark for a whole-record question. There is no node to mark and
  the corner chips of #292 were never built; the strip carries it.
- Ranking beyond `design`'s rule. One rule, one place; a host with a
  different queue asks for an override, it does not get a second rule.
