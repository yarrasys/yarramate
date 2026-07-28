# Security policy

YarraMate is pre-release software. No version currently carries a security
support guarantee.

Please do not report suspected vulnerabilities in a public issue. Use
[GitHub's private vulnerability reporting](https://github.com/yarrasys/yarramate/security/advisories/new).

Reports should include the affected version or commit, reproduction steps,
impact, and any known mitigations. Do not include credentials, private
repository content, or other sensitive material.

YarraMate processes repository-controlled YAML and JSON. Consumers should
treat profiles, adapter mappings, evidence documents, and generated artifacts
from untrusted sources as untrusted input. Automatic profile registries and
remote resolution are intentionally outside the current Core contract.
