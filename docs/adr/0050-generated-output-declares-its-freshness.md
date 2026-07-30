# Generated output declares its freshness

Status: accepted

`export-project` treated its ownership marker as an identity lock: any drift
between the recorded project, mapping, views, or comparison and the requested
export was refused with the same message as an unmarked directory. Adding a
projection to a valid project therefore made safe regeneration
indistinguishable from drift recovery, and nothing anywhere reported that an
existing generated directory no longer matched the inputs it was generated
from.

A directory is now safely updatable exactly when its marker validates as a
YarraMate generated-project marker of either format version and its recorded
output digests are intact. That pair proves the directory is entirely
machine-generated, so overwriting it loses nothing; how far its recorded
ownership has drifted is irrelevant, because ownership drift is the normal
regeneration-after-change case. The ownership fields remain in the marker to
document provenance, refusals distinguish a foreign directory from a
hand-edited generated file, and only a non-directory output path keeps the
bare already-exists error.

The marker additionally records `inputDigests`: the SHA-256 of every resolved
input that fed the export, keyed by the path used to reference it.
`export-project --check` recomputes the would-be export in memory and
compares digests — the recorded inputs against the current ones and the
recorded model digest against the would-be model source — reporting fresh,
stale with one reason per differing input, modified for hand edits, or
absent, without writing anything. Freshness is a pure digest comparison and
never a semantic judgement; markers from releases before input digests are
reported stale rather than guessed at.
