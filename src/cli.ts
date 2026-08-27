#!/usr/bin/env node

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, relative, resolve } from 'node:path'
import { compileWorkspace } from './compiler.js'
import {
  diagnosticJson,
  isMainModule,
  usage,
  versionResult,
  type CliResult,
} from './cli-support.js'
import { runAskCommand } from './ask-command.js'
import { runCheckCommand } from './check-command.js'
import { runImportCommand } from './import-command.js'
import { runExportCommand } from './export-command.js'
import { runApplyCommand } from './apply-cli.js'
import { runDesignCommand } from './design-command.js'
import {
  evaluateEvidenceWorkspace,
  loadEvidence,
} from './evidence.js'
import { deriveArtifactCoverage } from './artifact-coverage.js'
import { deriveAttestationStaleness } from './attestation-staleness.js'
import { reconcileEvidenceReports } from './reconciliation.js'
import { loadWorkspaceManifest } from './workspace.js'

export type { CliResult } from './cli-support.js'

const runReconciliation = (
  options: readonly string[],
  cwd: string,
): CliResult => {
  // Bare reconcile already emits JSON, so --json changes nothing — but a
  // harness scripting "add --json to every verb" must not hit exit 2 on
  // the one verb that treats it as unknown (#275). Accepted as a no-op.
  const positional = options.filter((option) => option !== '--json')
  const [workspacePath] = positional
  if (
    positional.length !== 1 ||
    workspacePath === undefined ||
    workspacePath.startsWith('-')
  ) {
    return { exitCode: 2, stdout: '', stderr: usage }
  }
  try {
    const loadedWorkspace = loadWorkspaceManifest(
      {
        path: workspacePath,
        source: readFileSync(resolve(cwd, workspacePath), 'utf8'),
      },
      cwd,
    )
    if (!loadedWorkspace.ok) {
      return {
        exitCode: 1,
        stdout: diagnosticJson(loadedWorkspace.diagnostics),
        stderr: '',
      }
    }
    const sourcePaths = [
      ...loadedWorkspace.workspace.profiles,
      ...loadedWorkspace.workspace.patterns,
      ...loadedWorkspace.workspace.documents,
    ]
    const compilation = compileWorkspace(
      sourcePaths.map((path) => ({
        path,
        source: readFileSync(resolve(cwd, path), 'utf8'),
      })),
    )
    if (!compilation.ok) {
      return {
        exitCode: 1,
        stdout: diagnosticJson(compilation.diagnostics),
        stderr: '',
      }
    }
    const evidenceDocuments = []
    for (const path of loadedWorkspace.workspace.evidence) {
      const loaded = loadEvidence({
        path,
        source: readFileSync(resolve(cwd, path), 'utf8'),
      })
      if (!loaded.ok) {
        return {
          exitCode: 1,
          stdout: diagnosticJson(loaded.diagnostics),
          stderr: '',
        }
      }
      evidenceDocuments.push(loaded.evidence)
    }
    const evaluation = evaluateEvidenceWorkspace(
      compilation.graph,
      evidenceDocuments,
    )
    if (!evaluation.ok) {
      return {
        exitCode: 1,
        stdout: diagnosticJson(evaluation.diagnostics),
        stderr: '',
      }
    }
    // Attestation staleness derives from git (ADR 0074), so it belongs
    // to reconcile, the verb that reports observed reality; the design
    // evaluator and the check gate stay git-free.
    const documentIdByPath = new Map(
      compilation.graph.documents.map(({ id, source }) => [source, id]),
    )
    const staleness = deriveAttestationStaleness(
      cwd,
      loadedWorkspace.workspace.documents.map((path) => ({
        path,
        source: readFileSync(resolve(cwd, path), 'utf8'),
        documentId: documentIdByPath.get(path) ?? path,
      })),
    )
    // Coverage anchors on the manifest's own directory, not the process
    // cwd, so the same command reports the same coverage wherever it was
    // invoked (ADR 0130).
    const coverage = deriveArtifactCoverage(
      dirname(resolve(cwd, workspacePath)),
      loadedWorkspace.manifest.coverage,
    )
    return {
      exitCode: 0,
      stdout: `${JSON.stringify(
        reconcileEvidenceReports(
          loadedWorkspace.workspace.id,
          evaluation.reports,
          compilation.graph,
          staleness,
          coverage,
        ),
        null,
        2,
      )}\n`,
      stderr: '',
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { exitCode: 2, stdout: '', stderr: `${message}\n` }
  }
}

// The id grammar the document and workspace schemas share: a lowercase
// letter first, then lowercase alphanumerics in single-hyphen segments.
const initIdPattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/

// The first check output should say the project's own name, not `main`
// (#275, ADR 0112): the default id is the target directory's basename,
// slugified to the shared id grammar. `init .` resolves before deriving,
// so the cwd's basename is what gets named. `main` remains the fallback
// when the basename yields nothing the schemas accept ('.', '..',
// all-symbols, a leading digit).
export const deriveInitId = (directory: string): string => {
  const slug = basename(directory)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return initIdPattern.test(slug) ? slug : 'main'
}

const runInit = (options: readonly string[], cwd: string): CliResult => {
  const positional = options.filter((option) => option !== '--no-pointer')
  const writePointer = positional.length === options.length
  const target = positional[0]
  if (
    positional.length !== 1 ||
    target === undefined ||
    target.startsWith('-')
  ) {
    return { exitCode: 2, stdout: '', stderr: usage }
  }
  const workspaceRoot = resolve(cwd, target)
  const documentPath = resolve(
    workspaceRoot,
    '.yarramate/architecture/main.yaml',
  )
  const manifestPath = resolve(workspaceRoot, '.yarramate/workspace.yaml')
  const displayPath = relative(cwd, documentPath)
  const displayManifestPath = relative(cwd, manifestPath)
  const existing = [
    ...(existsSync(documentPath) ? [displayPath] : []),
    ...(existsSync(manifestPath) ? [displayManifestPath] : []),
  ]
  if (existing.length > 0) {
    return {
      exitCode: 2,
      stdout: '',
      stderr: `${existing.join(' and ')} ${existing.length === 1 ? 'already exists' : 'already exist'}; nothing was changed\n`,
    }
  }
  const workspaceId = deriveInitId(workspaceRoot)
  mkdirSync(dirname(documentPath), { recursive: true })
  writeFileSync(
    documentPath,
    'format: yarramate/v1\n' +
      `id: ${workspaceId}\n` +
      'profile: yarramate/core@0.1\n' +
      'concepts: []\n' +
      'relationships: []\n',
    'utf8',
  )
  writeFileSync(
    manifestPath,
    'format: yarramate/workspace/v1\n' +
      `id: ${workspaceId}\n` +
      'documents:\n' +
      '  - architecture/*.yaml\n' +
      'profiles: []\n' +
      'projections: []\n' +
      'adapterMappings: []\n' +
      'evidence: []\n',
    'utf8',
  )
  const pointerMarker = '## YarraMate architecture'
  const pointerBlock =
    `${pointerMarker}\n` +
    '\n' +
    'This repository declares its architecture as canonical, versioned\n' +
    'YarraMate documents in `.yarramate/`. When prose documentation and the\n' +
    'model disagree, the model is authoritative.\n' +
    '\n' +
    '- Orient first: `yarramate ask .yarramate/workspace.yaml`\n' +
    '- Continue the design interview: `yarramate design .yarramate/workspace.yaml`\n' +
    '- Validate changes: `yarramate check .yarramate/workspace.yaml --json`\n' +
    '\n' +
    'Author native documents only; never edit generated output.\n'
  // Harnesses look in different files: AGENTS.md is the cross-harness
  // convention, while Claude Code auto-loads CLAUDE.md only. Delivering to
  // both is what makes the pointer reach an agent without instruction.
  const pointerNotes: string[] = []
  if (writePointer) {
    for (const pointerFile of ['AGENTS.md', 'CLAUDE.md']) {
      const pointerPath = resolve(workspaceRoot, pointerFile)
      const displayPointerPath = relative(cwd, pointerPath)
      if (!existsSync(pointerPath)) {
        writeFileSync(pointerPath, pointerBlock, 'utf8')
        pointerNotes.push(
          `Created ${displayPointerPath} with the YarraMate pointer\n`,
        )
      } else {
        const existingPointer = readFileSync(pointerPath, 'utf8')
        if (existingPointer.includes(pointerMarker)) {
          pointerNotes.push(
            `${displayPointerPath} already declares the YarraMate pointer\n`,
          )
        } else {
          writeFileSync(
            pointerPath,
            `${existingPointer.replace(/\n*$/, '\n\n')}${pointerBlock}`,
            'utf8',
          )
          pointerNotes.push(
            `Extended ${displayPointerPath} with the YarraMate pointer\n`,
          )
        }
      }
    }
  }
  return {
    exitCode: 0,
    stdout:
      `Created ${displayPath} and ${displayManifestPath}\n` +
      pointerNotes.join(''),
    stderr: '',
  }
}

// The seven-verb contract (docs/AGENT-INTERFACE.md): one verb per
// lifecycle stage — init creates, design fills, apply writes, ask reads,
// check gates, reconcile reports drift, export derives artifacts.
export function runCli(
  args: readonly string[],
  cwd: string = process.cwd(),
): CliResult {
  const [command, ...options] = args
  if (command === '--help' || command === '-h' || command === 'help') {
    return { exitCode: 0, stdout: usage, stderr: '' }
  }
  if (command === '--version' || command === '-v') {
    return versionResult('yarramate')
  }
  if (command === 'init') {
    return runInit(options, cwd)
  }
  if (command === 'design') {
    return runDesignCommand(options, cwd)
  }
  if (command === 'apply') {
    return runApplyCommand(options, cwd)
  }
  if (command === 'ask') {
    return runAskCommand(options, cwd)
  }
  if (command === 'check') {
    return runCheckCommand(options, cwd)
  }
  if (command === 'reconcile') {
    return runReconciliation(options, cwd)
  }
  if (command === 'export') {
    return runExportCommand(options, cwd)
  }
  return { exitCode: 2, stdout: '', stderr: usage }
}

/**
 * Every verb, including the one that cannot be synchronous.
 *
 * `import xlsx` has to inflate a workbook, and the only inflater available
 * everywhere this runs is `DecompressionStream`, which is async. Widening
 * `runCli` to return a promise would change the type every one of its callers
 * reads - the readers half of the rule in CONTRIBUTING.md - so the async verb
 * gets its own entry and `runCli` keeps its signature.
 */
export async function runCliAsync(
  args: readonly string[],
  cwd: string = process.cwd(),
): Promise<CliResult> {
  const [command, ...options] = args
  if (command === 'import') return runImportCommand(options, cwd)
  return runCli(args, cwd)
}

if (isMainModule(import.meta.url, process.argv[1])) {
  const result = await runCliAsync(process.argv.slice(2))
  process.stdout.write(result.stdout)
  process.stderr.write(result.stderr)
  process.exitCode = result.exitCode
}
