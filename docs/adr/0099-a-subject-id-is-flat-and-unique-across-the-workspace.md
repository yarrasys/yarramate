# A subject id is flat and unique across the workspace

Status: accepted

Until 1.0 a compiled subject id was `<document-id>#<local-id>`, and an authored
id only had to be unique within its own document
([ADR 0005](0005-qualified-cross-document-references.md)). Two documents could
each declare `contact-record` and mean different things. This ADR removes the
prefix: an id names one subject anywhere in the workspace, and `check` refuses a
workspace that declares one twice.

## Why

The document prefix was doing two jobs, and only one of them was wanted.

It **namespaced** ids, which nobody needed. Across the nineteen workspaces
reachable from this machine - this repository, all six gallery showcases, and
aperture-x - **zero ids collided**. The namespace was paying rent on a problem
no model had.

It also **bound identity to file layout**, which everybody paid for. Moving a
subject from one document to another changed its identity, so a file
reorganisation was a rename that had to be chased through every projection,
adapter mapping, evidence pointer, `distinctFrom`, and rendered brief. The
practical effect was that documents stopped being a reviewing decision and
became a semantic commitment, which is exactly backwards: a document is storage
and governance, not meaning.

Flattening ends that. File layout is now free to change, and the id a human
reads in a brief is the id they type into `ask`.

## Decided

- A subject id is the authored id. There is no prefix, and a reference resolves
  as written wherever it appears.
- **Workspace-wide uniqueness is enforced.** Two documents declaring one id is
  `YM314`, anchored at the second declaration and naming the first. This check
  is not a nicety attached to the change; it is what makes the change safe,
  because without it flattening silently merges two distinct subjects.
  Within one document a repeat stays `YM301`, because a file repeating itself
  reads differently to whoever has to fix it than a file colliding with one
  they may not have open.
- A document whose own id is a duplicate (`YM303`) is not walked for subject
  collisions. Every id inside it would collide, burying the one fault worth
  acting on under a diagnostic per concept.
- Document ids remain, and remain unique. They identify the document for
  provenance, for the `documents` projection selector, and for diagnostics.

## Consequences

**Provenance stops being derivable from the id.** The `documents` selector used
to slice the prefix off a subject id; it now reads the document recorded on the
claim that declares a concept's kind. That claim is the one every concept has,
and it is recorded in the document that authored it. Relationships were never
filtered by document - they enter a view through `between` or `connected` - so
nothing there changed.

**The LikeC4 adapter names elements from the whole id.** Its default external
name used to be the local id, with the document prefix as a tie-breaker when two
documents supplied the same one. That tie cannot happen now; the numeric suffix
that always sat behind it still separates two ids that collapse onto one
camel-case name.

**Migration is textual and refuses rather than guesses.**
`scripts/flatten-subject-ids.mjs` strips a prefix only where it names a document
of the workspace being migrated, so a kind identity like
`yarramate/core@0.1#goal` is left alone. If two documents declare the same id it
reports every collision and writes nothing, because that is the one case where
the rewrite would change meaning rather than spelling. It is a script rather than
an eighth verb: a one-time migration does not belong in the CLI's steady-state
surface ([ADR 0061](0061-the-clean-break-to-seven-verbs.md)).

The script rewrites what the manifest reaches, and a workspace usually has files
that reference subjects without being listed there - an adapter's project
definition is the common one - so extra paths can be named on the command line.

## Rejected

**Accepting the qualified form and stripping it silently.** It would have made
migration invisible, and left two spellings of one identity alive indefinitely.
A reference that still carries a prefix now fails to resolve and says so, which
is a worse first minute and a better second one.

**Recording the declaring document on every subject in graph v2.** It was
briefly implemented, on the theory that provenance should not vanish. It turned
out not to vanish: a relationship's defining claim already carries the document
that authored it, and every concept has a kind claim that does the same. The
field was additive but bought nothing, and it broke thirty-nine tests that
legitimately assert exact graph output. Reverted.
