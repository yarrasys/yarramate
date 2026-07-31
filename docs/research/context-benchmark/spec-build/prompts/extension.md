You are extending an existing Conduit backend implementation that you
did not write. The team that built it is gone; you have their design
handoff and their code.

In your working directory:

- `spec/` — the API specification, delta requirements, and conformance
  tests the implementation already passes (do not break them)
- `handoff/` — the design the original implementers received
- the implementation itself, started with `run.sh` (listens on `$PORT`,
  default 3000)

New requirement — **tag subscription**:

- `POST /api/tags/:tag/subscribe` (auth required) subscribes the caller
  to a tag; `DELETE /api/tags/:tag/subscribe` unsubscribes. Both return
  `{ "tag": "<tag>", "subscribed": true|false }` with HTTP 200.
- `GET /api/tags/subscriptions` (auth required) returns
  `{ "tags": [ ... ] }` — the caller's subscribed tags, alphabetical.
- `GET /api/articles/feed` additionally includes articles carrying any
  tag the caller subscribes to, merged with the existing followed-author
  articles, still newest first, still deduplicated and paginated.
- Tag subscriptions are per user. Subscribing twice is idempotent.
- These mutations count toward the D1 rate limit and are audited (D2)
  with action `subscribe`/`unsubscribe`, resourceType `tag`,
  resourceId the tag name.

Extend the implementation to satisfy this. Follow the existing design's
boundaries and the handoff's intent; record any deviation in
`DEVIATIONS.md` (append, do not rewrite). All existing conformance tests
must still pass. Your final message: what you changed, where, and why
there — and whether the original design made this extension easy or
hard, concretely.
