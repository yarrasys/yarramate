# reconcile speaks to a person behind a flag

Status: accepted

`yarramate reconcile` is the verb that reports observed reality against
the record: what the evidence confirmed, what it contradicted, which
sign-offs have gone stale, which files nobody claims. It printed that
report as `yarramate/reconciliation-report/v1` JSON and nothing else.
That is the right default: the CI drift Action parses it, harnesses
parse it, EVIDENCE.md names it normative, and `--json` was accepted as
a no-op so a harness adding the flag to every verb never hits exit 2
(#275). It is also the wrong thing to put in front of a person. The
yarramate.dev home page shows this repository's own drift check
(#526), and the honest rendering of what the tool prints is a JSON
block on a page written for consultants.

## Decision

`--text` prints the same report for a person. The JSON stays the
default and the contract; the flag adds a second shape of the one
report, nothing more.

- **Same report, same order.** The text carries every count the
  summary carries, then every finding in the order the JSON lists
  them, then the lists the JSON carries (subjects without evidence,
  expectations without observation, unclaimed artifacts, coverage
  scope) and the notes. Nothing is added, nothing is judged, nothing
  is summarised away: a reader of the text and a parser of the JSON
  learn the same facts.
- **One line per finding.** The result kind, the target, who observed
  it and where, then the message the provider left beneath it. An
  attestation finding says who signed, when, and for a stale one when
  the wording moved; an unconfirmed one names the recorder and the
  declared line.
- **Lists appear only when they hold something.** A report with no
  unclaimed artifacts has no "Unclaimed artifacts" heading, so the
  page a person reads is as long as what there is to say.
- **`--json` and `--text` together are refused** with the usage, like
  any call that names no single output. `--json` alone stays the
  no-op it was.

## Consequences

- The site prints `reconcile --text`; anything that parsed the JSON
  keeps parsing it unchanged.
- Failures before a report exists (a manifest that does not load, a
  compile that fails, evidence that does not load) still print JSON
  diagnostics with `--text`. The report has a text form; diagnostics
  keep the one form every verb prints them in.

## Excluded

- Flipping the default to text with `--json` for machines, the shape
  every other verb has. That would break every parser of bare
  `reconcile` output for the sake of symmetry. A second flag costs
  nobody anything.
- Colour, alignment beyond the label column, or a table. The text is
  for a terminal and a page alike, and it is meant to be quoted.
