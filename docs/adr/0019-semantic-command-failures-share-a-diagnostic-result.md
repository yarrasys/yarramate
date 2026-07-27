# Semantic command failures share a diagnostic result

JSON-producing semantic commands keep command-specific success documents but
emit the closed `yarramate/diagnostic-result/v1` contract for correctness
failures. A shared normative schema gives agents and harnesses one failure
shape without conflating a failure report with a successful projection,
evidence report, or check result.

## Status

Accepted.
