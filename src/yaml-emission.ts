/**
 * Emission of YAML that reads the same under every YAML version.
 *
 * YarraMate reads its own documents with a YAML 1.2 loader, so the `yaml`
 * package's default emission is correct for the toolchain. The surprise lands
 * outside it. YAML 1.1 - still the default of PyYAML and of most non-JS
 * loaders - resolves a plain `on` to the boolean `true` and a plain
 * `2026-08-27` to a date, so an attestation this toolchain wrote as
 * `on: 2026-08-27` reads back as `{True: date(2026, 8, 27)}` in anyone's
 * migration script, audit pipeline, or client tooling (#378). The asymmetry
 * is the point: YarraMate writes the document and someone else eats the
 * version difference.
 *
 * Quoting only `on` would fix the reported case and leave its siblings - `y`,
 * `no`, `off`, every bare date, every sexagesimal `1:30` - to be found one
 * report at a time. So the check is derived from the mechanism instead: a
 * string is emitted plain only where the 1.1 and the 1.2 emitters agree on
 * how to write it. Where they disagree, the string is version-dependent by
 * construction and gets double quotes, which both versions read back as the
 * string that was authored.
 *
 * The disagreement runs both ways, which is why simply emitting under 1.1 is
 * not the fix: `0o17` is a plain string to 1.1 and the integer 15 to 1.2, so
 * a 1.1 emitter would hand YarraMate's own reader a number. Asking both and
 * quoting on disagreement is the only form that closes each direction.
 */

import { Document, Scalar, stringify as stringifyYaml, visit } from 'yaml'
import type { ToStringOptions } from 'yaml'

// True when the two versions would write this string differently, which means
// the plain form of at least one of them resolves to something other than the
// string. Each emitter guarantees a round trip under its own version, so
// agreement is agreement that the shared text is safe under both.
const versionDependent = (value: string): boolean =>
  stringifyYaml(value, { version: '1.1' }) !==
  stringifyYaml(value, { version: '1.2' })

/**
 * `stringify` from the `yaml` package, with every version-dependent string -
 * key or value - forced to double quotes. Multi-line strings are untouched:
 * a block scalar is a string to both versions, so the two emitters agree and
 * the value keeps its shape.
 */
export const emitYaml = (
  value: unknown,
  options: ToStringOptions = {},
): string => {
  const document = new Document(value)
  visit(document, {
    Scalar(_key, node) {
      if (typeof node.value === 'string' && versionDependent(node.value)) {
        node.type = Scalar.QUOTE_DOUBLE
      }
    },
  })
  return document.toString(options)
}
