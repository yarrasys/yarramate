# A folder is declared, not derived

Status: accepted

Supersedes the folder half of the decision recorded in #245: view folders came
from the directories their projections sat in. They come from a label the
author writes now, and concepts gain the same label so the model can be
organised by something other than the layer its kinds resolve to.

## Why

**A folder is an organising concept, not a location.** The reframe, in the
words that prompted it: *a folder not as in filesystem folder, but as an
organisation of views and model elements*. Deriving it from a path made the
filesystem the author of the organisation - a workspace could not name a folder
without moving files, and it could not name one at all if its manifest patterns
reached no subdirectory.

**Deriving it made the editor reach for the manifest.** Writing a view into a
new directory can produce a projection the workspace never loads, which #259
had to refuse outright (`YMVS315`). "New folder" therefore meant either
refusing the ordinary case or editing the author's manifest, which ADR 0043
says the tool does not do. With a label, every projection stays in one
directory the manifest already reaches, and the question never has to be
answered. `YMVS315` remains, as a guard for someone genuinely naming a
subdirectory rather than as something the editor walks into.

**The word already means this here.** `yarramate/likec4-project/v1` carries
exactly this field for exactly this purpose (ADR 0067): a declared string,
nested with `/`, independent of where anything sits. Two surfaces meaning two
different things by `folder` would be worse than either meaning.

## What

`presentation.folder` on a projection, and `folder` on a concept. Both are
strings matching `^[^/]+(?:/[^/]+)*$`; both are optional; neither is resolved
against anything.

**A folder is a VALUE, not a reference.** The claim a concept's folder compiles
to is `yarramate/organisation/folder` with a `value` object. A ref would demand
a subject to point at, and minting one turns an organising word into a thing in
the model that can be related, owned and reported on. Two documents writing the
same label mean the same folder without either naming the other, and a folder
with nothing in it does not exist - which is exactly what a label should do and
exactly what a subject should not.

**Layer stays the default grouping in the Model tree; a declared folder
overrides it.** A subject's ArchiMate layer is derived from its kind and is
always correct, so a model nobody has organised is grouped as it always was. A
subject that declares a folder appears under that folder and nowhere else: a
subject in two groups is one the reviewer finds twice and edits once. The rail
says which of the two grouped a row, because one is derived and one is not.

**One level, and the separator is reserved.** The rail draws a folder, not a
folder tree, so `Current/Engine` is one folder with that name. The separator is
specified now so nesting can be drawn later without the label meaning something
different in the meantime - the same reading LikeC4 gives it.

**Path derivation is gone rather than kept as a fallback.** Two sources for one
name is two answers to "why is this view here", and the one that answers
"because of where the file is" is the one this ADR rejects. A workspace that
sorts projections into directories keeps working - the files load, the views
open - and its folders flatten until it declares them. That flattening is
visible, reversible and one field per view; a rule that quietly preferred a
directory would not be.

## Consequences

- `yarramate/v1` and `yarramate/projection/v1` each gain one optional field.
  Both are conservative extensions: a document that declares no folder compiles
  to exactly the claims it did before, and a reader that ignores the field
  reads the same model.
- `CanvasNode` gains `folder`, which the visual graph schema states. The
  browser and the runtime ship together, so this is not a protocol version
  (the same reading #234 took when a node gained `coreKindLabel`).
- A new view is written beside every other projection. `projectionPathFor` no
  longer takes a directory, and duplicating a view no longer copies one.
- "New folder" is a real menu item: name the folder, then save the first view
  into it. A folder no document declares is not a folder, so naming one and
  putting something in it are one motion rather than two.
