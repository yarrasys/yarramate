You are implementing a backend for the Conduit specification from a
design handed to you by a designer you have never met.

In your working directory:

- `spec/openapi.yml` — the pinned RealWorld/Conduit API specification
- `spec/SPEC-DELTA.md` — three additional requirements that are part of
  the spec (rate limiting, audit log, revision history)
- `spec/hurl/` and `spec/delta-hurl/` — the conformance tests your
  implementation must pass
- `handoff/` — the design you received. Read it before writing any code.

Build the backend in this directory. Requirements:

1. **Pass the conformance tests.** Your server must pass both
   `spec/hurl/` and `spec/delta-hurl/` run with
   `hurl --test --jobs 1 --variable host=http://localhost:$PORT
   --variable uid=<any>`.
2. **Provide `run.sh`** in the working directory root: a script that
   starts your server listening on `$PORT` (default 3000), with no
   prior manual steps. In-memory or file-backed storage is fine;
   persistence across restarts is not required.
3. **Honour the design you received.** Use its component names and
   respect its boundaries and data-ownership rules in your code
   structure. Where you must deviate, record each deviation in
   `DEVIATIONS.md` (component, what you did instead, why). An empty or
   absent `DEVIATIONS.md` asserts you followed the design as given.
4. Keep the implementation self-contained: standard toolchains are
   available, but the server must not depend on external services or
   network resources at runtime.

Verify against the conformance tests yourself before finishing. Your
final message: what you built, which tests pass, and any deviations.
