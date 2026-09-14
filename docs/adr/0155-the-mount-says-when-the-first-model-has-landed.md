# The mount says when the first model has landed

Status: accepted

The handle a mount returns points at the canvas (ADR 0118): `select`,
`startConnection`, `showView`. Each answers `false` before the first model
frame has landed, because there is nothing yet to point at, and the editor
renders before its host's first frame does. That left a host with no way to
know the moment it could act: yarramate.dev's editor route polled
`select()` every 120 ms until it answered true (#532). The `view` option
(ADR 0152) covers the one case of "open on this view", not the general one.

## Decision

`MountOptions.onFirstModel` is called once, when the first model has landed,
after the opening view has been applied. Nothing else changes: the handle's
methods still answer `false` before it, and a host that never passes the
callback loses nothing.

## Consequences

- The site drops its poll: mount with `onFirstModel`, then `select`,
  `startConnection` or `showView` in the callback.
- One optional mount option; `mountEditorWith` gains a trailing optional
  parameter; every existing call stands.

## Excluded

- Queueing `showView` and `select` calls made before the model arrives and
  applying them when it does. A queued call would have to answer true
  before it knows whether the id names anything, which breaks the rule that
  every method answers with whether it acted. The callback keeps the
  contract and moves the waiting to the one place that knows when to stop.
- A promise on the handle. A callback on the options is where the other
  host-side hooks live (`onDelegateQuestion`, `workerFactory`), and it
  fires exactly once, which a promise says less plainly.
