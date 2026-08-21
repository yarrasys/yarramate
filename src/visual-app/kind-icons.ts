// Thin wrapper around the shared `src/notation/archimate.ts` glyph catalogue:
// resolves a graph node's kind label to its `data:image/svg+xml` icon URI.
// All 62 core-vocabulary glyphs and their SVG rendering live in the notation
// module now (the single source of truth for both this canvas and any future
// standalone consumer); this file only adds the two local profile aliases
// that inherit their parent's glyph verbatim.
import { ICON_SIZE, kindGlyphDataUriOf as coreKindGlyphDataUriOf } from '../notation/archimate.js'

export { ICON_SIZE }

// `compiler-module` and `repository-file` are the two kinds
// `.yarramate/profiles/yarramate-development.yaml` adds beyond
// `yarramate/core@0.1`'s 17. Both inherit their parent's glyph verbatim, so
// each aliases to the parent kind's id rather than duplicating its glyph
// body - this alias map is local because the notation module has no notion
// of profile-specific kinds, only the core vocabulary.
const PROFILE_ALIAS_GLYPH: Record<string, string> = {
  'compiler-module': 'applicationComponent',
  'repository-file': 'artifact',
}

// `kindLabel` is a kind's local id (`kindLabelOf` in `src/kind-label.ts`),
// not the qualified `<profile>#<id>` identity. Unknown label -> no icon, no
// crash: the top-right slot simply stays empty.
export function kindIconUriOf(kindLabel: string): string | null {
  const aliased = PROFILE_ALIAS_GLYPH[kindLabel]
  if (aliased !== undefined) return coreKindGlyphDataUriOf(aliased)
  return coreKindGlyphDataUriOf(kindLabel)
}
