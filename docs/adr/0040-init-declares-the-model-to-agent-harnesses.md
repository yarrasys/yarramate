# Init declares the model to agent harnesses

Status: accepted

A canonical model that harnesses never discover is never consulted, and the
difference between a model used every session and one used never is usually
a single missing pointer.

`yarramate init` therefore writes an `AGENTS.md` section at the workspace
root declaring that `.yarramate/` holds the canonical architecture, that
the model is authoritative over prose when they disagree, and which
commands orient, validate, and provide bounded context. `AGENTS.md` is the
emerging cross-harness convention and is read by the major coding agents;
YarraMate does not write harness-specific files.

The write follows the same safety rules as the rest of init: a missing
`AGENTS.md` is created containing only the section, an existing file is
appended to exactly once (keyed on the section heading), and a file that
already declares the section is left untouched. Init still refuses to touch
an existing `.yarramate/`.
