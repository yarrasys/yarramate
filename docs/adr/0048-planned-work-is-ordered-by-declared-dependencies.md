# Planned work is ordered by declared dependencies

Status: accepted

Once a designed model first passes check, implementation planning left
YarraMate: with every seam modelled as a planned concept, "which seam comes
first" had no deterministic answer, `compare` returned platform-wide scope,
and `status` did not surface planned subjects at all. The model stopped
leading during the longest, most decision-heavy part of the work.

`yarramate next <projection.yaml> <workspace.yaml>` reports the planned
subjects of one projection in dependency order with per-subject evidence
coverage. It is a report, not an opinion: every ingredient is already
declared. Ordering derives from the projection's relationships between
planned subjects, oriented by which endpoint each core kind's declared
intent makes prerequisite — the source of `realization`, `serving`,
`triggering`, and `flow` exists before its counterpart; the target of
`composition`, `aggregation`, `access`, and `specialization` does. Kinds
with no build-order reading (`association`, `assignment`, `influence`)
contribute no edge rather than a guessed one, and custom kinds inherit the
orientation of their nearest core ancestor through profile lineage.

The order itself is Kahn's algorithm with lexicographic tie-breaks;
dependency cycles cannot be ordered, so their members are appended sorted
and marked rather than silently arranged. Evidence coverage counts every
observation touching the subject or a relationship at its endpoints,
graph-wide, so "no evidence" is visible next to each planned item. The
machine result is `yarramate/next-result/v1`; exit status stays `0`
whatever the report contains, because what to build next is a reading of
declared intent, never a gate.
