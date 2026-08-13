# Visual descriptor and chat hardening

**Date:** 2026-08-09
**Status:** Approved

## Problem

A visual client opens its private session descriptor with `O_RDONLY` and
`O_NOFOLLOW`. A FIFO planted at that path is not a symlink, so opening it for
reading blocks until a writer appears. Every one-shot visual client command can
therefore hang before it validates that the descriptor is a regular file.

A manual browser smoke also enabled embedded chat while attaching a scripted,
canned responder rather than the delegated visual LLM required by the approved
conversation design. The browser transport worked, but the setup presented the
script as conversational capability and could answer only its hard-coded
LikeC4 phrases.

## Decision

Harden the existing boundaries without changing the visual protocol.

1. Open session descriptors with `O_RDONLY | O_NONBLOCK | O_NOFOLLOW` where
   `O_NOFOLLOW` is available. Continue validating the opened handle with
   `stat()` before reading it. Regular descriptor files behave as before; a
   FIFO opens without waiting and is rejected as a non-regular file with the
   existing `YMVS401` diagnostic.
2. State explicitly in the canonical visual-conversation journey that
   `chatEnabled: true` requires the parent to attach a real delegated visual
   LLM agent implementing the documented `wait`/`respond` loop. A canned,
   scripted, or transport-only responder does not satisfy capability
   detection. Such smoke tests must not be presented as embedded chat.

## Boundaries

- No schema, protocol, browser UI, session lifecycle, or authority change.
- The runtime remains model-provider-neutral and cannot determine whether an
  authenticated protocol consumer is an LLM.
- Diagram-only fallback remains the correct mode when the harness cannot attach
  and supervise the delegated agent.
- Repeated-stop semantics, generic symlink diagnostics, and the existing
  `O_NOFOLLOW` portability tradeoff remain unchanged.

## Verification

- Add a subprocess regression test that creates a FIFO descriptor, invokes a
  visual client command, and proves it exits promptly with `YMVS401`. The
  subprocess boundary ensures a regression is killed and reported rather than
  hanging the test worker.
- Run the focused visual CLI tests.
- Exercise a real browser chat turn with a delegated visual agent, verifying
  that arbitrary in-scope text reaches the LLM and receives a generated
  response.
- Run `pnpm verify` before merge.

## Acceptance criteria

1. No visual client command blocks when its descriptor path names a FIFO.
2. FIFO descriptors remain fail-closed and expose no capability.
3. Regular descriptor behavior and diagnostics remain compatible.
4. The canonical skill forbids advertising embedded chat through a canned or
   transport-only responder.
5. The PR's complete verification remains green.
