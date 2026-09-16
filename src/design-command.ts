import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseDocument } from 'yaml'
import {
  diagnosticJson,
  humanDiagnostics,
  usage,
  type CliResult,
} from './cli-support.js'
import { createFileSystemStore } from './source-store.js'
import { posixDirectoryOf } from './apply-command.js'
import { loadWorkspaceManifest } from './workspace.js'
import { designStepDetailed, type DesignStep } from './tools/design.js'
import type { ToolWorkspace } from './tools/workspace.js'

// The interview itself lives in `tools/design.ts` (ADR 0156): this command
// parses arguments, resolves the manifest against the filesystem, hands the
// same store-backed core the hosted server calls, and renders the human
// form. The JSON form is the core's result, printed.

const localKind = (qualified: string): string => {
  const hash = qualified.lastIndexOf('#')
  return hash === -1 ? qualified : qualified.slice(hash + 1)
}

/**
 * The `missing-claim` predicates that name a CONCEPT FIELD, and the field
 * each one is written through (#430).
 *
 * `missing-claim` matches a raw predicate, and a predicate is not an
 * authoring gesture: `yarramate/attestation/adequacy` is written by adding an
 * attestation, `yarramate/reference/refers-to` by adding a reference, and a
 * profile may mint predicates this engine has never heard of. So the
 * condition cannot map to one operation in general, which is why an adopter
 * wiring it up got a card with no affordance and filed #430.
 *
 * It maps for these three, and only these three, because each is a named
 * field on a concept that `update-concept` writes directly. They are Core's
 * own, closed, and they are every `missing-claim` the shipped catalogue uses
 * — `owner-missing`, `information-unowned`, `concept-undescribed` and
 * `status-missing`. Anything else returns no skeleton, which is ADR 0110's
 * rule holding: a wrong skeleton is never offered.
 *
 * This is the "one new mapping case" ADR 0110 anticipated, not a remedy DSL.
 * The engine still takes no position on which predicates a HOST should render
 * as editable; the trigger carries the predicate and the host decides. This
 * is the CLI rendering its own affordance, the same as the other two cases.
 */
const CONCEPT_FIELD_PREDICATES: Record<
  string,
  { readonly name: string; readonly placeholder: string }
> = {
  'yarramate/ownership/owner': {
    name: 'owner',
    placeholder: '<owning-subject-id>',
  },
  'yarramate/concept/description': {
    name: 'description',
    placeholder: '<one line>',
  },
  'yarramate/lifecycle/status': {
    name: 'status',
    placeholder: '<planned|current|retired>',
  },
}

const skeletonHeader = (
  documentAddress: string,
  op: string,
): readonly string[] => [
  '',
  'Prefilled skeleton (edit the <placeholders>, save as operations.yaml):',
  '  format: yarramate/operations/v1',
  '  operations:',
  `    - op: ${op}`,
  `      document: ${documentAddress}`,
]

// The skeleton is a rendering of the step's trigger (#289), printed only
// when a single condition maps unambiguously onto one operation, so a
// wrong skeleton is never offered; every other trigger leaves the output
// exactly as before. Kinds print as local names: that is the form a
// native document declares.
const renderSkeleton = (
  step: DesignStep,
  documentAddress: string | undefined,
): readonly string[] => {
  if (documentAddress === undefined || step.trigger.length !== 1) return []
  const condition = step.trigger[0]!
  if (condition.condition === 'no-subject-of-kind') {
    const kinds = condition.kinds.map(localKind)
    const alternatives =
      kinds.length > 1 ? `  # or: ${kinds.slice(1).join(', ')}` : ''
    return [
      ...skeletonHeader(documentAddress, 'add-concept'),
      '      concept:',
      '        id: <kebab-case-id>',
      `        kind: ${kinds[0]}${alternatives}`,
      '        name: <one line>',
    ]
  }
  if (
    condition.condition === 'missing-relationship' &&
    step.subject !== undefined
  ) {
    const kinds = condition.kinds.map(localKind)
    const alternatives =
      kinds.length > 1 ? `  # or: ${kinds.slice(1).join(', ')}` : ''
    const swap =
      condition.direction === 'any' ? '  # or swap the endpoints' : ''
    const from =
      condition.direction === 'incoming' ? '<counterpart-id>' : step.subject.id
    const to =
      condition.direction === 'incoming' ? step.subject.id : '<counterpart-id>'
    return [
      ...skeletonHeader(documentAddress, 'add-relationship'),
      '      relationship:',
      '        id: <kebab-case-id>',
      `        kind: ${kinds[0]}${alternatives}`,
      `        from: ${from}${swap}`,
      `        to: ${to}`,
    ]
  }
  if (condition.condition === 'missing-claim' && step.subject !== undefined) {
    const field = CONCEPT_FIELD_PREDICATES[condition.predicate]
    if (field === undefined) return []
    return [
      ...skeletonHeader(documentAddress, 'update-concept'),
      '      concept:',
      `        id: ${step.subject.id.split('#').pop()}`,
      `        ${field.name}: ${field.placeholder}`,
    ]
  }
  return []
}

export function runDesignCommand(
  options: readonly string[],
  cwd: string,
): CliResult {
  const json = options.includes('--json')
  // Facilitation is a rendering preference, not an interview mode: the
  // same step, slice, and envelope, with the plain phrasing preferred in
  // the human question line when the catalogue provides one.
  const facilitate = options.includes('--facilitate')
  let subjectFilter: string | undefined
  let cataloguePath: string | undefined
  const rest: string[] = []
  const withoutJson = options.filter(
    (option) => option !== '--json' && option !== '--facilitate',
  )
  for (let index = 0; index < withoutJson.length; index += 1) {
    const option = withoutJson[index]
    if (option === '--subject' || option === '--catalogue') {
      const value = withoutJson[index + 1]
      if (value === undefined || value.startsWith('-')) {
        return { exitCode: 2, stdout: '', stderr: usage }
      }
      if (option === '--subject') {
        if (subjectFilter !== undefined) {
          return { exitCode: 2, stdout: '', stderr: usage }
        }
        subjectFilter = value
      } else {
        if (cataloguePath !== undefined) {
          return { exitCode: 2, stdout: '', stderr: usage }
        }
        cataloguePath = value
      }
      index += 1
      continue
    }
    if (option === undefined || option.startsWith('-')) {
      return { exitCode: 2, stdout: '', stderr: usage }
    }
    rest.push(option)
  }
  const [workspacePath] = rest
  if (rest.length !== 1 || workspacePath === undefined) {
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
          'design requires an explicit workspace manifest (yarramate/workspace/v1)\n',
      }
    }
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
    const workspace = loadedWorkspace.workspace

    // The base is REPLACED by `--catalogue` and ADDED TO by `questions:`
    // (#345, ADR 0129); the core composes the two.
    const tool: ToolWorkspace = {
      store: createFileSystemStore(cwd),
      workspace,
      manifestDirectory: posixDirectoryOf(workspacePath),
      ...(cataloguePath === undefined
        ? {}
        : {
            catalogue: {
              path: cataloguePath,
              source: readFileSync(resolve(cwd, cataloguePath), 'utf8'),
            },
          }),
    }
    const stepped = designStepDetailed(
      tool,
      subjectFilter === undefined ? {} : { subject: subjectFilter },
    )
    if (!stepped.ok) {
      if (stepped.reason === 'refused') {
        return { exitCode: 1, stdout: '', stderr: `${stepped.message}\n` }
      }
      return {
        exitCode: 1,
        stdout: json
          ? diagnosticJson(stepped.diagnostics)
          : humanDiagnostics(stepped.diagnostics),
        stderr: '',
      }
    }
    const { result, report } = stepped.result
    const { step, slice } = result

    if (json) {
      return {
        exitCode: 0,
        stdout: `${JSON.stringify(result, null, 2)}\n`,
        stderr: '',
      }
    }

    // Read from the REPORT rather than from `progress`, because a wave that
    // has not opened and one with nothing outstanding both count zero (#334).
    // "implementation 0 open" about a gated wave is the same empty-set
    // flattery as the completion sentence below it - which was fixed while
    // this line, directly above it, was not. `progress` keeps its shape: a
    // consumer wanting wave state reads an interrogation report, and a third
    // required field on a published format for a convenience summary is not
    // worth the constructor break.
    const waveSummary = report.waves
      .map((wave) => {
        const open =
          result.progress.waves.find(({ id }) => id === wave.id)?.open ?? 0
        return wave.opened ? `${wave.id} ${open} open` : `${wave.id} not yet`
      })
      .join(' · ')
    const lines: string[] = [
      `Design interview — workspace ${workspace.id} · catalogue ${report.catalogue}`,
      `Waves: ${waveSummary}`,
      '',
    ]
    if (step === null) {
      // "No open questions" has two causes and only one of them is complete
      // (#334). Every wave gated shut asks NOTHING, so a blank model reaches
      // zero without a single question having been put - and claiming the
      // model answers everything the catalogue asks is then flatly false
      // about a catalogue that asked nothing. Completion inferred from an
      // empty set is the same fault the wave rail and the report renderer
      // each carried; this is the sentence an agent reads to decide it is
      // done, so it is the worst place for it.
      const asked = report.waves.some((wave) => wave.questions.length > 0)
      lines.push(
        !asked
          ? 'No wave has opened yet: this catalogue asks nothing until the model has substance. Declare a subject and run this again.'
          : subjectFilter === undefined
            ? 'Interview complete: no open questions. The model answers everything the catalogue asks.'
            : `Interview complete for ${subjectFilter}: no open questions touch it.`,
      )
    } else {
      // --facilitate prefers the workshop phrasing and falls back to the
      // standard one when a question has none; it never blocks.
      const asked =
        facilitate && step.askPlain !== undefined
          ? step.askPlain
          : step.question
      lines.push(
        `Q [${step.wave} · ${step.questionId}] (authority: ${step.authority})`,
        `  ${asked}`,
        `  Why it matters: ${step.materiality}`,
        `  How to answer: ${step.resolution}`,
      )
      if (step.remainingSubjects !== undefined) {
        lines.push(
          `  (${step.remainingSubjects} more subject${step.remainingSubjects === 1 ? '' : 's'} share${step.remainingSubjects === 1 ? 's' : ''} this question)`,
        )
      }
      if (slice !== undefined) {
        lines.push('', 'Subject slice:', '', slice.trimEnd())
      }
      // The skeleton's document address is the manifest-relative form
      // when the first document sits under the manifest directory - the
      // address an author naturally writes and apply accepts (#216) -
      // falling back to the workspace path, which apply also accepts.
      const manifestDirectory = workspacePath.includes('/')
        ? workspacePath.slice(0, workspacePath.lastIndexOf('/'))
        : ''
      const firstDocument = workspace.documents[0]
      const documentAddress =
        firstDocument === undefined
          ? undefined
          : manifestDirectory !== '' &&
              firstDocument.startsWith(`${manifestDirectory}/`)
            ? firstDocument.slice(manifestDirectory.length + 1)
            : firstDocument
      lines.push(
        '',
        'Answer by updating the model (one atomic batch):',
        `  yarramate apply <operations.yaml> ${workspacePath}`,
        ...renderSkeleton(step, documentAddress),
        `Then re-run: yarramate design ${workspacePath}`,
      )
    }
    return { exitCode: 0, stdout: `${lines.join('\n')}\n`, stderr: '' }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { exitCode: 2, stdout: '', stderr: `${message}\n` }
  }
}
