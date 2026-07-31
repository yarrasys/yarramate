# Spec delta (pre-registered 2026-07-31)

Status: **frozen before any run.** This file, and the Hurl acceptance
tests beside it, must be on `main` before the first design-phase agent
starts. Editing either after runs begin invalidates the affected runs.

## Why a delta exists

The base spec is RealWorld/Conduit, pinned:

- repository: `https://github.com/gothinkster/realworld`
- commit: `98f29fb3f8bcb1dd614b91f2851371bf22c34775`
- spec: `specs/api/openapi.yml`
- conformance suite: `specs/api/hurl/*.hurl` (Hurl files are upstream's
  source of truth)

Hundreds of public Conduit implementations exist, so an agent may recall
one wholesale. Recall bites hardest on the standard surface and cannot
reach requirements that did not exist when those implementations were
written. The three requirements below are therefore where
promise-keeping is scored with extra weight (DESIGN-HANDOFF-FAMILY.md,
decision 1): they force real architectural choices — a cross-cutting
middleware concern, an append-only store fed by every mutation, and
versioned data on the update path — that no recalled codebase provides.

Every arm receives this delta together with the base spec. The delta is
part of the spec, not an extension task.

## D1 — Per-user rate limiting on mutations

A signed-in user may perform at most **60 mutating requests (POST, PUT,
DELETE) within any rolling 60-second window**. The request that exceeds
the limit receives **HTTP 429** with the standard error envelope:

```json
{ "errors": { "rate-limit": ["too many mutating requests"] } }
```

Rules:

- The window is per authenticated user, not per connection or IP.
- GET requests never count toward or against the limit.
- Unauthenticated mutating requests (register, login) are exempt — they
  have no user to attribute.
- After the window slides past, mutations succeed again. (The acceptance
  test does not wait out the window; it only asserts the 429 boundary.)

The limit of 60 is chosen so the upstream conformance suite — well under
60 mutations per test user — passes untouched; only a deliberate burst
trips it.

## D2 — Audit log

Every **successful** mutating request must append one audit record:
actor (the authenticated user), action, resource type, resource id, and
timestamp. Failed and unauthenticated requests are not recorded.

Exposed at **`GET /api/audit`** (authentication required):

```json
{
  "audit": [
    { "action": "favorite", "resourceType": "article",
      "resourceId": "<slug>", "createdAt": "<ISO 8601>" }
  ],
  "auditCount": 1
}
```

Rules:

- A caller sees **only their own** audit records, newest first.
- `limit`/`offset` query parameters paginate, defaults 20/0.
- Action names are fixed by this table (scored literally):

| Endpoint | action | resourceType | resourceId |
| --- | --- | --- | --- |
| POST /api/articles | `create` | `article` | slug |
| PUT /api/articles/:slug | `update` | `article` | slug |
| DELETE /api/articles/:slug | `delete` | `article` | slug |
| POST /api/articles/:slug/favorite | `favorite` | `article` | slug |
| DELETE /api/articles/:slug/favorite | `unfavorite` | `article` | slug |
| POST /api/articles/:slug/comments | `create` | `comment` | comment id |
| DELETE /api/articles/:slug/comments/:id | `delete` | `comment` | comment id |
| POST /api/profiles/:username/follow | `follow` | `profile` | username |
| DELETE /api/profiles/:username/follow | `unfollow` | `profile` | username |
| PUT /api/user | `update` | `user` | username |

## D3 — Article revision history

**`PUT /api/articles/:slug` must preserve the replaced version** as a
revision. Revisions are exposed at **`GET /api/articles/:slug/revisions`**
(authentication required, **author only** — anyone else receives 403):

```json
{
  "revisions": [
    { "title": "...", "description": "...", "body": "...",
      "revisedAt": "<ISO 8601>" }
  ],
  "revisionCount": 1
}
```

Rules:

- Each revision is the article state that an update **replaced**; an
  article updated twice has two revisions.
- Newest first: `revisions[0]` is the most recently replaced state.
- An article never updated has `revisionCount: 0` and an empty list.
- Deleting the article deletes its revisions.

## Acceptance tests

`delta-hurl/*.hurl`, written in the upstream suite's conventions and run
by the same command:

```sh
hurl --test --jobs 1 \
  --variable host=$HOST --variable uid=$UID_VAL \
  docs/research/context-benchmark/spec-build/delta-hurl/*.hurl
```

The conformance gate for every build run is: **upstream suite passes AND
delta suite passes**. A gate, never a ranking (DESIGN-HANDOFF-FAMILY.md).

## What the delta deliberately avoids

- Nothing here contradicts the base spec; every base test passes on a
  delta-compliant implementation.
- No requirement dictates architecture (no "use middleware", no storage
  choice) — the architecture is the experiment's free variable.
- Numbers (60/60s, pagination defaults) are exact so conformance is
  mechanical, not judged.
