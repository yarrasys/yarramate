# A mechanical edit lands through apply, not through the agent

Status: accepted

ADR 0081 shipped the visual adapter with one mutation path: the delegated
chat agent re-authored the whole model and the runtime replaced it. That
made the browser a reader — every structural change, down to fixing a typo
in a description, cost a conversational turn, a model provider call, and a
whole-model candidate for the runtime to validate. The clause that made it
a boundary rather than an omission is
[ADR 0081](0081-a-visual-conversation-is-an-adapter-with-a-published-protocol.md):

> Every rendered model is either `canonical` … or explicitly `ad-hoc`, and
> the browser says which. The cost is that a diagram drawn during a
> conversation can never quietly become declared intent; promoting it means
> authoring it through the normal write surface.

That clause is right about what it was protecting and wrong about what it
excluded, and this ADR records the distinction it missed.

## What the browser can and cannot know

Two things a browser could send are not the same kind of thing:

- **A drawing.** The user rearranged boxes, sketched a component, or
  confirmed a suggestion. What that *means* — which kind, whose ownership,
  what it supersedes — is inferred from a picture. ADR 0081 refuses this,
  and this ADR does not reopen it.
- **A field.** The user opened `Checkout Service`, picked
  `applicationComponent` from the kinds the workspace's own profile
  resolves, and typed a description. There is nothing to infer: the
  before value, the after value, the subject id, and the document that
  owns it are all known exactly.

The second is a transcription, not an interpretation. Routing it through a
model provider does not make it safer; it inserts a paraphrase between a
user's keystroke and the file, which is the one thing a write surface must
not do. ADR 0062 already made the same argument for the CLI: an apply diff
is exactly the answer it landed, never an optimistic guess.

## The write surface already existed

`yarramate apply <operations.yaml> <workspace.yaml>` has been the
repository's write verb since [ADR 0057](0057-writes-land-as-one-validated-batch.md):
six operations (`add`/`update`/`delete` × concept/relationship), one atomic
batch, whole-candidate compile before a byte is written, and `remove` for
explicit retraction so nothing shrinks silently. The visual adapter needed
no new semantics — only a second caller. Task 4 of this change extracted
`applyOperations` out of the CLI wrapper (`src/apply-command.ts`), so the
browser's commit and `yarramate apply` are the same code path, the same
validator, and the same diagnostics.

Constraining the input is what keeps the transcription honest. Every field
the inspector offers is either free text the model already treats as prose
(`name`, `description`, `content`) or a `<select>` over a set the model
itself published: `kind` from the session's resolved
`vocabulary.conceptKinds`/`relationshipKinds`, `status` from
`planned|current|retired`, `mode` from `read|write|read-write|unspecified`,
and a relationship's `from`/`to` from the ids in the rendered graph. The
browser cannot name a kind the profile does not resolve, because the list
came from the profile.

## Rejected: package the changeset as a chat turn

The cheapest option — "apply these 7 edits" as a `chat.message` — needs no
new wire event. It was rejected on three counts:

- It only works when the harness can delegate a child. Editing would be
  unavailable in exactly the sessions that are diagram-only, which is the
  common case for a reviewer.
- A rename would cost provider latency and tokens, and could come back
  subtly different. A field edit that round-trips through a paraphrase is
  no longer the user's edit.
- The failure mode is unattributable: when the resulting model does not
  compile, nothing distinguishes a user mistake from a model
  hallucination.

## Rejected: let the browser send a candidate model

Symmetrical with the old `model.replace`, and it would have reused the
existing validation. But a whole-model payload from an untrusted client
makes every commit a diff of the entire workspace, so the runtime cannot
tell an intended one-field change from an accidental wholesale rewrite,
and ADR 0062's guarantee — the diff is exactly what was asked for — is
unavailable. Operations carry their own scope; a model does not.

## Decided

The browser sends `changeset.commit` carrying a `yarramate/operations/v1`
document it assembled from typed field edits. The runtime validates and
lands it through `applyOperations` against the workspace manifest the
session already resolved, then answers `apply-result`: on success the
written-file list and counts, on failure the diagnostics verbatim with
their `/operations/<i>/…` pointers, and nothing written. A commit is
synchronous and never wakes the agent — the same treatment as
`filter.query`, because no judgment is being asked for.

Chat loses mutation entirely. `model.replace` is deleted, not deprecated:
the agent explains, filters, and focuses, and the only path from a browser
to a file is a batch of operations the user chose field by field.

**The runtime never runs `git commit`.** A commit lands in the working
tree, and that is where review happens — `git diff` shows exactly the
one-file change, `git log` is unchanged, and revert is `git revert` or
`git checkout` on the ordinary working-tree diff. This preserves what ADR
0081's clause was actually protecting: the boundary between a file being
edited and a change being *accepted* is still Git review, not a button in
a browser. What changed is only who may hold the pen — a user editing
constrained fields may, an inferred picture still may not.

## What this costs

- **A browser tab can dirty the working tree.** A single-writer working
  tree is assumed; concurrent tabs editing the same subject are out of
  scope, and the last commit wins with no merge.
- **No undo in the app.** The runtime writes files; taking a change back
  is a Git operation, deliberately, so there is exactly one history.
- **`authority: 'ad-hoc'` is gone.** With editing pointed at a real
  workspace, a scratch model with no file to write to is a mode where the
  Commit button would be a button over nothing. A session with no
  resolvable workspace manifest now refuses to start (`YMVS132`) instead
  of degrading into a read-only sketchpad. Every rendered model is
  `canonical`; the label survives on the wire because a future non-canonical
  authority would have to declare itself.
