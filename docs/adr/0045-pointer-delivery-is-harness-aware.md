# Pointer delivery is harness-aware

Status: accepted

ADR 0040 bet that `AGENTS.md` alone would carry the pointer because it is
the cross-harness convention. The context benchmark falsified the "is read
by the major coding agents" premise empirically: across ~120 benchmark
sessions where a committed model and the pointer were present, Claude Code
headless agents read `AGENTS.md` zero times — that harness auto-loads
`CLAUDE.md` and nothing else. A pointer the harness never loads is
decoration, and the capability-flattening bet depends on weak-tier agents
reaching the verifier without instruction.

`yarramate init` therefore delivers the same pointer section to both
`AGENTS.md` (the cross-harness convention) and `CLAUDE.md` (auto-loaded by
Claude Code). Each file follows the ADR 0040 safety rules independently:
created when missing, extended exactly once (keyed on the section heading),
left untouched when it already declares the section. The section content is
identical in both files and remains harness-neutral prose.

Two files is a delivery list, not a policy change: if a harness convention
consolidates, entries can be removed; if another de facto location emerges,
it can be added under the same rules.

`init --no-pointer` skips both files. Discovery workflows that analyze
third-party clones need a workspace without mutating the target repository's
agent configuration; forcing the pointer there was reported as a defect
(issue #49).
