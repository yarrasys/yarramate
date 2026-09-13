# The MCP adapter serves the whole loop

Status: accepted

Amends ADR 0044, whose last paragraph kept writes out of `yarramate-mcp`
"until read-only usage proves itself". It has: the adapter has run in every
harness the project supports since 0.4.0, and the one thing it could not do
became the one thing a class of users needed.

## Context

yarramate.dev launches filesystem-only (decided 2026-09-13): the supported
platforms are the command-line agents and the two vendors' desktop apps, all
of which have a filesystem, so the record lives in the visitor's repository
and nothing is hosted. A command-line agent runs the CLI itself, so a
read-only MCP server was never a limit for it: it asked through
`yarramate_design` and landed through `yarramate apply` in the shell. A
desktop app cannot run a shell command. It can only call tools. With four
read tools it could be interviewed and could not answer, on exactly the
platforms the launch names. Issue #514.

Two smaller facts pointed the same way. Every tool required a `workspace`
path, which a terminal agent could give as `.yarramate/workspace.yaml`
because it stood in the repository, and a desktop app could not, because it
starts the server from wherever it likes. And the tool descriptions assumed
the reader had seen the skill file, which a desktop-app agent connecting for
the first time has not.

## Decision

`yarramate-mcp` serves the loop, not a reading of it:

- `yarramate_apply` takes one `yarramate/operations/v1` document, as YAML or
  JSON text or as an object, writes it to a scratch file for the length of
  the call, and runs `yarramate apply` on it. It is the same atomic batch a
  person lands: any invalid operation refuses the whole batch, nothing is
  written, and the diagnostics come back with their source locations. The
  adapter adds no semantics (ADR 0044 still holds on that point); it lends
  the CLI a file.
- `yarramate_export` runs `yarramate export`. The text kinds (markdown, rtm,
  graph, briefs) come back as text, written to a scratch directory when the
  CLI insists on one; the binary and multi-file kinds (xlsx, likec4) need an
  `out` and return what the CLI printed about the write.
- `workspace` is optional on every tool. It resolves, in order, to the call's
  own argument, the server's `--workspace`, then `.yarramate/workspace.yaml`
  under the working directory. When neither exists the server says so in one
  sentence that names both remedies.
- A workspace named by path is run the way a person runs it: the CLI's
  working directory is the repository root, the directory that holds
  `.yarramate`, and the manifest path is made relative to it. A record's
  contracts, coverage and evidence name files by their repository-root path,
  so running from anywhere else fails on the first contract check. This was
  found by the test that starts the server from a scratch directory, not by
  reading the code.
- Every tool description ends with the loop in two sentences, and the
  initialize instructions carry the same two, so the first tool list a new
  agent reads tells it that design asks, apply lands, and design asks again.

## Consequences

- The server's safety class changes from "always safe to connect" to "writes
  what the CLI would write". A harness that wants the old class disables the
  one write tool; every client in scope lets a person allow tools one by one.
- `yarramate_design`'s description no longer says answers land "through the
  CLI apply command, not through this server". It names the tool.
- README, `docs/CONSUMING-YARRAMATE.md` and `docs/AGENT-INTERFACE.md` stop
  saying "four read-only tools". The self-model's MCP adapter rows say what
  the adapter now does.
- The hosted sandbox design (`docs/research/sandbox/SPEC.md`, shelved) asked
  for the same tool surface on a remote endpoint. This ADR is the local half
  of that surface; should the remote half ever be built, it serves these six
  tools and no others.

## Verification

`test/mcp-cli.test.ts` drives the built server over stdio: the tool list
carries six tools with `workspace` optional and the loop in every
description; orientation works with no argument from the repository root;
`--workspace` works from a scratch directory and the same call without it is
refused with the sentence above; `apply` lands YAML text, refuses a mixed
batch whole with the document unchanged, lands an object, and `design` then
reads the landed record; `export rtm` returns the matrix as text and the
binary kinds name what they need. Four mutations were run and each turned a
test red: dropping the conventional fallback, running the CLI in the server's
directory instead of the repository root, never writing the operations file,
and letting xlsx run without `out`.
