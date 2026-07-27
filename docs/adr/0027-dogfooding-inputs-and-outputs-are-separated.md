# Dogfooding inputs and outputs are separated

YarraMate's repository self-model keeps canonical, reviewable inputs under
`.yarramate/`. Architecture documents, profiles, projections, evidence, Core
contracts, and optional integration configuration remain explicit inputs to
the workspace and adapter CLIs.

Reproducible artifacts are written under `.yarramate-out/`, which is ignored
by Git. The LikeC4 adapter currently owns `.yarramate-out/likec4/`; future
compiled graphs, reports, and contexts may receive separate children without
changing their semantic formats.

The directory names are repository conventions, not semantic identity.
Documents and compiled subjects retain their declared globally qualified
identities when moved. `.yarramate/` must not be treated as a discovery or
governance mechanism, and `.yarramate-out/` must not become canonical input.

Because the project has no external consumers at this stage, `init` establishes
the same `.yarramate/architecture/main.yaml` and `.yarramate/workspace.yaml`
layout directly rather than retaining an obsolete root-level convention.
Integration scenarios remain test fixtures; curated examples will live in a
separate project when the public authoring experience is stable.
