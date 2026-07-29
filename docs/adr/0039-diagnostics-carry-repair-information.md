# Diagnostics carry repair information

Status: accepted

Source-located diagnostics already say where input is wrong. They now also
say what would make it right, because the dominant consumer loop — an agent
or person editing until `check` passes — pays one full round-trip for every
fact a message withholds.

Schema violations name the expected value: a `const` mismatch states the
constant, and an `enum` mismatch lists the allowed values (capped at eight).
Unknown concept and relationship kinds suggest the closest declared kind in
the selected profile by edit distance, with a deterministic tie-break so
diagnostic output stays reproducible. Endpoint-aspect violations carry the
violated policy's remedy: each constrained core relationship kind states the
shapes that stay legal, such as `flow` between active-structure elements or
a behavior concept joined by `assignment`; extension kinds declare
constraints without remedies and keep the plain violation message. No new
diagnostic codes are introduced, severities and locations are unchanged, and
messages remain plain text within the existing check-result and
diagnostic-result contracts.

Suggestions are repair hints, never corrections: the compiler still rejects
the input, and nothing is auto-fixed.
