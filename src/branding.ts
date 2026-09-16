/**
 * White-labelling (#546, ADR 0158): one value, set once by a host, that
 * names the product on every surface a consumer's users see - the editor
 * shell, the tool list an agent reads, the workbook's cover sheet and the
 * LikeC4 banner. Nothing else changes: record formats, diagnostic codes and
 * the wire protocol are contracts, not branding, and stay `yarramate/...`
 * and `YM...`. Absent, every surface reads exactly as it always has.
 *
 * Pure: no imports, so it sits under every entry (`yarramate/tools`,
 * `yarramate/workbook`, `yarramate/visual-app`) without weight.
 */

export type BrandingLogo =
  /** Inline markup the host wrote; rendered as the host's own SVG. */
  | { readonly svg: string }
  /** An address the page fetches; rendered as an image. */
  | { readonly url: string }

export interface Branding {
  /** "ApertureX", "Halcyon Architecture". Required: a brand without a name is not one. */
  readonly productName: string
  /** For tight chrome, beside the logo. Defaults to `productName`. */
  readonly shortName?: string
  /** Beside the title in the editor shell. Nothing is drawn without one. */
  readonly logo?: BrandingLogo
  /**
   * One CSS colour for the chrome - the authority mark, the notices, the
   * changeset controls - never the notation: what a node or an edge looks
   * like is the style preset's, and a comparison's added/removed marks keep
   * their own tokens.
   */
  readonly accent?: string
  /** Where the brand mark links. Without it the mark is text, not a link. */
  readonly docsUrl?: string
  /**
   * The line under the product name, on the editor strip, the workbook's
   * cover sheet and the LikeC4 banner. Unset: "Powered by yarramate". A
   * string replaces it; `null` removes it, and with it every other mention
   * of the engine those surfaces make.
   */
  readonly vendorLine?: string | null
  /**
   * The prefix of the tool names an agent reads: `acme` publishes
   * `acme_design`, `acme_apply`, ... Default `yarramate`. An instruction
   * written for `yarramate_design` will not find `acme_design`, so a host
   * that re-prefixes owns its own agent instructions.
   */
  readonly toolPrefix?: string
}

/** `Branding` with every default applied, which is what the surfaces read. */
export interface ResolvedBranding {
  readonly productName: string
  readonly shortName: string
  readonly logo?: BrandingLogo
  readonly accent?: string
  readonly docsUrl?: string
  /** `null` when there is none to show. */
  readonly vendorLine: string | null
  readonly toolPrefix: string
  /** False is the unbranded product: every surface as it was before #546. */
  readonly branded: boolean
}

export const YARRAMATE_PRODUCT_NAME = 'YarraMate'
export const YARRAMATE_TOOL_PREFIX = 'yarramate'
export const DEFAULT_VENDOR_LINE = 'Powered by yarramate'

/** What an MCP client accepts in a tool name, applied to the prefix alone. */
const TOOL_PREFIX = /^[A-Za-z0-9][A-Za-z0-9-]*$/

const UNBRANDED: ResolvedBranding = {
  productName: YARRAMATE_PRODUCT_NAME,
  shortName: YARRAMATE_PRODUCT_NAME,
  vendorLine: null,
  toolPrefix: YARRAMATE_TOOL_PREFIX,
  branded: false,
}

/**
 * Applies the defaults. `undefined` is the unbranded product. A value with
 * a blank `productName` or a `toolPrefix` no MCP client could publish is a
 * host's configuration error and throws, at mount or serve time, rather
 * than reaching a person as a blank name or an agent as a broken tool list.
 */
export const resolveBranding = (branding?: Branding): ResolvedBranding => {
  if (branding === undefined) return UNBRANDED
  const productName = branding.productName.trim()
  if (productName === '') {
    throw new TypeError('branding.productName must not be blank')
  }
  const toolPrefix = branding.toolPrefix ?? YARRAMATE_TOOL_PREFIX
  if (!TOOL_PREFIX.test(toolPrefix)) {
    throw new TypeError(
      `branding.toolPrefix "${toolPrefix}" must be letters, digits and hyphens, starting with a letter or digit`,
    )
  }
  const shortName = branding.shortName?.trim()
  const vendorLine =
    branding.vendorLine === undefined
      ? DEFAULT_VENDOR_LINE
      : branding.vendorLine === null || branding.vendorLine.trim() === ''
        ? null
        : branding.vendorLine.trim()
  return {
    productName,
    shortName: shortName === undefined || shortName === '' ? productName : shortName,
    ...(branding.logo === undefined ? {} : { logo: branding.logo }),
    ...(branding.accent === undefined ? {} : { accent: branding.accent }),
    ...(branding.docsUrl === undefined ? {} : { docsUrl: branding.docsUrl }),
    vendorLine,
    toolPrefix,
    branded: true,
  }
}

/**
 * The product name as an identifier segment: the LikeC4 project name is
 * `<slug>-<project id>`, `yarramate-…` unbranded. Lower-case letters,
 * digits and single hyphens; a name with nothing usable in it falls back
 * to the engine's own slug rather than producing an empty segment.
 */
export const brandSlug = (branding: ResolvedBranding): string => {
  if (!branding.branded) return YARRAMATE_TOOL_PREFIX
  const slug = branding.shortName
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-+|-+$/g, '')
  return slug === '' ? YARRAMATE_TOOL_PREFIX : slug
}
