# The rail shows staged intent beside landed truth

Status: accepted

The view tree rendered `state.views`, the landed list: it learned about a
view when a commit landed it, and not before. A staged `write-view` sat in
`pendingChangeset.viewOperations`, appeared as "1 staged" in the Changes
tray, and was invisible in the rail until Commit. The pipeline underneath
is sound — a committed view carrying `presentation.folder` flows through
and renders — so what a reviewer hit was pure visibility timing: "New
folder…" names a folder, the save dialog stages the first view into it,
and the rail shows nothing. The folder looks swallowed (#299).

The rule producing this was deliberate — the rail shows what the
workspace holds — but it collided with an inconsistency the editor
already carries: a staged subject edit appears on the canvas immediately
through the draft model, while a staged view appeared nowhere. One
changeset, two visibility rules.

The same flow held a second trap. Plain **Save** (overwrite) carries the
active view's own declared folder by design — the carry rule, which keeps
an ordinary overwrite from moving a view because of whatever the folder
control happened to be holding. Opened by "New folder…", that same rule
means the one button nearest the reviewer's finger silently drops the
folder they just named, and no commit will ever show it.

## Decision

The tree's input merges `pendingChangeset.viewOperations` over
`state.views`, in the pure model (`buildViewTree`) where a test can hold
it. A staged `write-view` at a path nothing landed renders as a row —
title and folder read from its own projection document — so the folder
just named is visible the moment its first view is staged. A staged
`write-view` at a landed path marks that row rather than duplicating it,
and the row shows what WILL land: the staged title, the staged folder. A
staged `delete-view` marks its row rather than hiding it. Every staged
row is visibly distinguished — an italic title and a quiet `staged` chip,
never the failure palette, because staging is ordinary work. The rail
becomes landed truth plus the reviewer's own uncommitted intent, visibly
told apart.

Nothing is stored. The merge derives from the changeset on every render,
so discarding the operation IS the revert and committing converts staged
rows to ordinary ones by the paths that already existed. A staged NEW row
is not navigable: opening a view resolves its id in the landed list,
where a staged one does not exist yet, so the row takes no click and no
menu — acting on staged intent belongs to the tray.

In the save dialog, a folder preset (the "New folder…" and "New view in
this folder…" openers) disables plain Save. The carry rule stands
untouched — an ordinary overwrite still carries the view's own folder —
but under a preset the overwrite is the one action that would silently
drop the named folder, so Save As New, which adopts it, is the action
left standing, and the disabled button says why.

## Excluded options

- **Keep the rail landed-only and say so** — a dialog notice reading
  "staged — appears in the rail when committed". Cheaper, and it keeps
  the rail's landed-truth semantics pure; but the folder still cannot be
  found until commit, and the canvas already shows staged subject edits,
  so the notice would be documenting the inconsistency rather than
  removing it.
- **Save adopts the preset folder on overwrite**: it closes the trap by
  breaking the rule that prevents a worse one — an overwrite that moves
  the active view into a folder as a side effect of how the dialog was
  opened is exactly what the carry rule exists to refuse.
- **Staged rows held in workspace state**: a marker the state remembers
  is a marker that can disagree with the changeset it describes. Deriving
  from `pendingChangeset` makes discard-reverts-the-tree a property of
  construction rather than a behaviour to maintain.

## Consequences

`ViewTreeRow` says how a row relates to the changeset (`staged`), and its
`subjectCount` admits `null`: a staged new view has no landed document to
measure and resolving its query needs the semantic graph the browser does
not hold, so the row shows its chip where a count would go rather than a
made-up zero. A staged overwrite keeps the landed count, the same
staleness story the summary already tells. The filter matches staged rows
by the words they display — the staged title and folder — and `matched`
counts them like any other row.
