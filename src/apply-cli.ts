/**
 * The `apply` command, and the only part of applying a batch that touches a
 * filesystem.
 *
 * It lives apart from `./apply-command.js` for the reason `./nesting.js` and
 * `./kind-label.js` state for their own values: the engine half is reachable
 * from a browser now (#252), and a top-level `node:fs` import is a bundle
 * failure whether or not the function that uses it is ever called. Core reads
 * nothing (ADR 0100) - this is the caller that reads for it.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseDocument } from 'yaml'
import { landOperations, posixDirectoryOf } from './apply-command.js'
import { createFileSystemStore } from './source-store.js'
import { loadWorkspaceManifest } from './workspace.js'
import { diagnosticJson, humanDiagnostics, usage } from './cli-support.js'
import type { CliResult } from './cli-support.js'

export function runApplyCommand(
  options: readonly string[],
  cwd: string,
): CliResult {
  const json = options.includes('--json')
  const rest = options.filter((option) => option !== '--json')
  const [operationsPath, workspacePath] = rest
  if (
    rest.length !== 2 ||
    operationsPath === undefined ||
    workspacePath === undefined ||
    rest.some((option) => option.startsWith('-'))
  ) {
    return { exitCode: 2, stdout: '', stderr: usage }
  }

  try {
    const manifestSource = readFileSync(resolve(cwd, workspacePath), 'utf8')
    if (
      parseDocument(manifestSource).get('format') !== 'yarramate/workspace/v1'
    ) {
      return {
        exitCode: 2,
        stdout: '',
        stderr:
          'apply requires an explicit workspace manifest (yarramate/workspace/v1)\n',
      }
    }
    const operationsSource = readFileSync(
      resolve(cwd, operationsPath),
      'utf8',
    )
    const loadedWorkspace = loadWorkspaceManifest(
      { path: workspacePath, source: manifestSource },
      cwd,
    )
    if (!loadedWorkspace.ok) {
      return {
        exitCode: 1,
        stdout: json
          ? diagnosticJson(loadedWorkspace.diagnostics)
          : humanDiagnostics(loadedWorkspace.diagnostics),
        stderr: '',
      }
    }
    const outcome = landOperations(createFileSystemStore(cwd), {
      workspace: loadedWorkspace.workspace,
      operations: { path: operationsPath, source: operationsSource },
      manifestDirectory: posixDirectoryOf(workspacePath),
    })
    if (!outcome.ok) {
      return {
        exitCode: 1,
        stdout: json
          ? diagnosticJson(outcome.diagnostics)
          : humanDiagnostics(outcome.diagnostics),
        stderr: '',
      }
    }
    const { result } = outcome
    if (json) {
      return {
        exitCode: 0,
        stdout: `${JSON.stringify(result, null, 2)}\n`,
        stderr: '',
      }
    }
    // Every counter, summed by iteration rather than by hand, so a new
    // operation kind cannot silently report zero work.
    const applied = Object.values(result.applied).reduce(
      (total, count) => total + count,
      0,
    )
    return {
      exitCode: 0,
      stdout: `Applied ${applied} operation${applied === 1 ? '' : 's'} to ${result.documents.join(', ')}\n`,
      stderr: '',
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { exitCode: 2, stdout: '', stderr: `${message}\n` }
  }
}
