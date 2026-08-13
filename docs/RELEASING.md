# Releasing YarraMate

This checklist is for maintainers. Creating the public repository and
publishing packages are explicit external actions; validation does not perform
either action.

## One-time setup

1. Create the public repository at `github.com/yarrasys/yarramate`.
2. Enable GitHub Issues and private vulnerability reporting.
3. Protect `main` so repository changes arrive through pull requests.
4. Confirm the `yarramate` package name remains available on npm.
5. Configure npm authentication with two-factor protection for publication.

## Release preparation

1. Select the version and update `package.json`. Set the first non-comment
   line of `assets/taglines.txt` to the same version (`vX.Y.Z`); the lines
   after it are the rotating hero taglines on [yarramate.dev](https://yarramate.dev),
   fetched from `main` at page load — refresh them when the release changes
   the story.
2. Update public documentation for any stable-interface change.
3. Run:

   ```sh
   corepack enable
   pnpm install --frozen-lockfile
   pnpm run verify
   npm pack --dry-run
   ```

4. Inspect the tarball listing. It should contain the runtime, normative
   schemas, consumer guide, canonical agent skill, README, and MIT licence—not
   repository source, tests, fixtures, dogfooding inputs, or generated output.
5. Commit through a pull request and merge only after CI passes.
6. Create an annotated Git tag matching the package version.

## Publication

From the tagged, clean checkout — `git checkout vX.Y.Z` in a fresh clone, never
a branch tip. npm stamps the current `HEAD` into the package's `gitHead`, so a
publish from `main` claims provenance the tag does not carry, even when the
tarball bytes are identical:

```sh
npm publish --access public
```

Then create a GitHub release from the same tag and verify:

```sh
npm view yarramate version
npm view yarramate@X.Y.Z gitHead   # must equal `git rev-parse vX.Y.Z^{commit}`
npx --yes yarramate --help
```

Publication is complete only when the npm package and GitHub release identify
the same source version, and the published `gitHead` is the tagged commit.
