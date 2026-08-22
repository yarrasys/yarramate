# Vendored from Archi

`relationships.xml` is Archi's machine-readable encoding of the ArchiMate 3.2
relationship table (specification Appendix B, including derived relationships).
It is the ground truth `yarramate check` validates relationship endpoints
against (ADR 0097).

- Source: https://github.com/archimatetool/archi
- Path: `com.archimatetool.model/model/relationships.xml`
- Commit: `069a862fc69f`
- Licence: MIT, see `LICENSE` beside this file.

Never edit the XML by hand. `pnpm generate:archimate` regenerates
`src/archimate-relationships.generated.ts` from it, and
`test/archimate-relationships.test.ts` fails if the two disagree.

ArchiMate is a registered trademark of The Open Group. YarraMate is not
affiliated with or certified by The Open Group.
