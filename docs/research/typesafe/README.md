# Typed judgments beside the engine: the study

Research only. Nothing under this directory ships in the package (`docs/` is
outside the npm `files` list) and nothing here is imported by `src/`.

- `PROTOCOL.md`: the pre-registration. Read it before running anything.
- `harness/`: the runner (`run.mjs`), the vendor client with the replay cache
  (`typesafe.mjs`), the dataset loader (`datasets.mjs`), and every question and
  threshold (`arms.mjs`).
- `datasets/`: Halcyon, copied read-only (see its `SOURCE.md`); ask queries as
  `ask-queries.<dataset>.json`.
- `cache/`: every request and response, keyed by request hash. Committed, so a
  finished arm replays without a call and a reader can check any answer.
- `results/`: scored output per arm and dataset, plus the labelling sheets.

## The key

The harness reads `TYPESAFE_API_KEY` from the environment and nothing else. It
never prints it, never writes it, and refuses a live run without it. Keep it
out of the shell history and out of this repository:

```
umask 077
mkdir -p ~/.config/yarramate-dev
printf 'TYPESAFE_API_KEY=%s\n' '<paste the key here>' > ~/.config/yarramate-dev/typesafe.env
```

Then, in the shell that runs the harness:

```
set -a; . ~/.config/yarramate-dev/typesafe.env; set +a
```

Never paste the key into a chat, a command line that a transcript records, or
a file under this repository.

## Running

The engine build in `../../../dist` must exist (`pnpm build` at the repo root).

```
cd docs/research/typesafe/harness
node run.mjs plan                                  # counts and cost, no calls
node run.mjs labels --arm duplicates --dataset self  # the labelling sheet for arm 2
node run.mjs run --arm kind-fit --dataset self --repeat 3 --live
node run.mjs run --arm duplicates --dataset self --repeat 3 --live
node run.mjs run --arm drift --dataset self --repeat 3 --live
node run.mjs run --arm drift --dataset self --probe --live
node run.mjs run --arm ask --dataset self --repeat 3 --live   # once queries exist
```

Without `--live` a `run` writes the planned requests to `results/*.planned.json`
for review and calls nothing. The ApertureX reference runs with
`--dataset apx --manifest /path/to/.yarramate/workspace.yaml` only after its
owner has agreed that the record may be sent to the vendor.

## Labelling

`results/duplicates.self.to-label.json` is the sheet for arm 2. Fill each
`label` with `same`, `related` or `different` before looking at any model
answer, then save the labels as `results/duplicates.self.labels.json` in the
shape `{ "<pair>": "<label>" }`. The scorer picks them up on the next run.
