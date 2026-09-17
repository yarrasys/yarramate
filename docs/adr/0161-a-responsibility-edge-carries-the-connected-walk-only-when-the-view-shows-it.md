# A responsibility edge carries the connected walk only when the view shows it

Status: accepted

ADR 0159 made responsibility three relationship kinds and hid their edges on
the canvas unless a view says `showResponsibility: true`: a role responsible
for eight applications is eight lines out of one box. It said nothing about
`relationships: connected`, which walks every relationship touching a
selected subject and takes the far end with it. The ApertureX reference found
the gap on the day of adoption (#563): its Landscape view selects application
and platform kinds with `connected`, and after eight people were seeded with
`responsible`, `consulted` and `informed` edges the view grew from 157
subjects to 161. The walk took the edges, the canvas hid them, and four people
stood in an application landscape with no line to anything. The engine and the
editor agreed on 161, so the picture was wrong by construction rather than by
a renderer's slip.

What the query could say about it: `relationshipKinds` is an allow-list, so
"every kind but these" is the whole core table written out; `kindMatching:
descendants` on `association` includes the responsibility kinds, which descend
from it; `exclude` names the people one by one, which is the workaround the
adopter is on (ADR 0122). Nothing said what a reader means, that a
responsibility edge is a fact about people and not about what stands between
applications.

## Decision

**Under `relationships: connected`, a relationship whose kind carries a
responsibility letter does not extend the selection unless the projection's
`presentation.showResponsibility` is `true`.** The letter is read through the
lineage (`responsibilityLetterOf`, the lookup the canvas uses), so an
adopter's subkind of `responsible` is held back exactly as the shipped kinds
are. Between two subjects the query selected on their own merits, the edge is
selected whatever the flag says, under both modes.

**The walk, not selection.** The first draft dropped the edges at selection
whenever the flag was off, so that the result equalled the drawing. It would
have made every whole-workspace evaluation read a picture instead of the
record: `import xlsx` merges the workbook against `query: {}`, `ask` orients
on it, the responsibility matrix and the governance log are derived from it,
the workbook's `02 Relationships` round-trips every kind (a consequence ADR
0159 promised), and the properties panel reads the letters off the model's
edges whatever the flag says. A hidden edge between two subjects that are in
the picture anyway changes nothing about who is in the picture; a hidden edge
that the walk follows does. So the walk is the only place the flag is read.

**Prose walks them.** `ask`'s slice, the brief export and the design step set
`showResponsibility: true` on their ad-hoc projections: a brief speaks every
relationship, and "is responsible for" stays in it. The LikeC4 `--changed`
review slice is a picture and takes the default.

**The editor sends the flag.** The `filter.query` payload gains an optional
`showResponsibility` beside `nesting`, for the same reason `nesting` is there
(ADR 0144): an evaluation that dropped it would answer a different question
than the canvas draws. The rail counts each saved view under the view's own
flag. Flipping the toggle re-asks the standing filter under the new value, so
switching the edges on brings in the people they lead to and switching them
off takes those people out with them; the re-ask after a model frame carries
what the last ask carried, nesting and flag alike. An older browser, and every
filter that does not send the flag, evaluates as a view with the flag off,
which is what the canvas draws by default.

Rejected: a query-side `excludeRelationshipKinds`. General, and it leaves the
default in place: every landscape view that adopts the vocabulary grows on
its own, and the author learns why from a person with no lines. It can still
come if a second kind with this character shows up. Also rejected: moving the
flag into the query. It would change a field shipped in 1.33.0 for no gain;
the flag already says whether these edges are part of the picture.

## Consequences

A presentation field now affects what a query selects, in one place, as
`nesting` already does for `instances`. A view that wants people through
their responsibilities says `showResponsibility: true` and gets both the edges
and the people. The wire change is additive. A projection evaluated without
profile context reads the two shipped kinds by exact identity, since there is
no lineage to read through. On the ApertureX reference the Landscape view
returns to 157 and the adopter's pins move back.
