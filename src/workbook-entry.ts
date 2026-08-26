/**
 * `yarramate/workbook` — the workbook writer, for a host that has no Node.
 *
 * ApertureX generates these inside a Cloudflare Worker (#355), so this entry
 * carries the same guarantee `./interrogation` does and is held to it by
 * `test/export-purity.test.ts`: no Node builtins, no `ws`, no session server,
 * and no RUNTIME import of the compiler, whose Ajv and YAML weight would
 * otherwise land in a Durable Object that only wants to write a spreadsheet.
 * The compiler is reached for types alone.
 *
 * A caller hands over an already-evaluated `ProjectionResult` — plain data —
 * and gets bytes back. Evaluating the projection is the caller's business,
 * which is what keeps schema validation out of this import graph.
 */
export {
  workbookFrom,
  buildWorkbookSheets,
  WORKBOOK_FORMAT,
  type WorkbookProvenance,
} from './workbook.js'
export {
  writeXlsx,
  columnName,
  escapeXml,
  sheetNameIsLegal,
  type WorkbookSheet,
  type SheetState,
} from './workbook-xlsx.js'
