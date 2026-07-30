# The repository is its own plugin marketplace

Status: accepted

Distributing the canonical agent skill to Claude Code was tracked as work
blocked on creating a separate organisation registry repository. That premise
was wrong: a marketplace manifest may live in the repository that owns the
plugin, so no second repository, account, or publication step is required.

`.claude-plugin/marketplace.json` therefore ships here, and its single plugin
entry points at `skills/yarramate-architecture` — the same directory the npm
package ships and the same one the repository edits. A consumer installs the
canonical skill, never a fork or a copy, and the existing `npx skills add`
path for other harnesses is unchanged.

The marketplace is named `yarramate` rather than something organisation-wide.
A user may register only one marketplace per name, so claiming a broader name
from inside one product's repository would collide with any future registry
that legitimately wanted it.

The entry declares no `version`, so the marketplace versions it by commit.
A hand-maintained version here would be a second source of truth for
something `package.json` already states, and this repository has already
shipped one stale duplicated version constant. Consumers who need a fixed
version install from a tag.
