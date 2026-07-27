# Machine-readable check results are versioned

`yarramate check --json` emits the closed
`yarramate/check-result/v1` contract for both successful and failed correctness
checks. The versioned envelope and normative JSON Schema let humans, CI,
skills, and agent harnesses depend on one deterministic interface without
turning human-readable output into an API.

## Status

Accepted.
