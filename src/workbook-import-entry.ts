/**
 * `yarramate/workbook/import` — reading an edited workbook back, for a host
 * that has no Node.
 *
 * A SEPARATE subpath from `yarramate/workbook` rather than more exports on it,
 * because the package declares no `sideEffects` field and a bundler must
 * therefore assume every module might have one. A Worker that only GENERATES
 * workbooks would otherwise carry the reader, the merge and the operations
 * emitter it never calls, and small bundles are the reason the xlsx container
 * is hand-written in the first place (#355).
 *
 * Held to the same bar as `./workbook` and `./interrogation` by
 * `test/export-purity.test.ts`: no Node builtins, no `ws`, no session server,
 * no runtime import of the compiler. `workbook-read.ts` imports nothing at
 * all; inflation uses `DecompressionStream('deflate-raw')`, which Workers,
 * browsers and Node 18+ all have.
 *
 * The reader is ASYNC and the writer is not, deliberately. A workbook this
 * package wrote has stored entries and inline strings, but one a person saved
 * from Excel comes back deflated and shared-stringed, and inflation is only
 * offered as a stream.
 *
 * What a host still owns: reading the bytes, evaluating the projection that
 * says what the workbook SHOULD hold now, and applying the operations. This
 * entry turns bytes into sheets, sheets into a merge report, and a merge
 * report into `yarramate/operations/v1`.
 */
export {
  readWorkbook,
  unzipEntries,
  columnIndexOf,
  decodeXmlText,
  type WorkbookRead,
  type ZipReadFailure,
} from './workbook-read.js'
export {
  mergeWorkbook,
  mergeSheet,
  keySheet,
  baselineSheets,
  isDerivedColumn,
  type KeyedSheet,
  type CellChange,
  type Conflict,
  type MergeReport,
} from './workbook-merge.js'
export {
  operationsFrom,
  operationsDocument,
  type OperationsResult,
} from './workbook-operations.js'
