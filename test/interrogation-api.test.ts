import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import Ajv2020Module from 'ajv/dist/2020.js'
import { describe, expect, it } from 'vitest'
import {
  compileWorkspaceWithProfileContext,
  evaluateCatalogue,
  loadQuestionCatalogue,
  renderInterrogationReport,
  renderQuestion,
  type InterrogationReport,
} from '../src/index.js'

// The engine is reached the way a package consumer reaches it, through the
// barrel, and driven entirely from strings: nothing here hands it a path to
// read. The only file this test opens is the published schema it asserts
// against, which is the contract, not an input to the engine.
const Ajv2020 = Ajv2020Module.default

const repositoryRoot = resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '..',
)

const reportSchema = JSON.parse(
  readFileSync(
    join(repositoryRoot, 'schema/yarramate-interrogation-report.schema.json'),
    'utf8',
  ),
) as object

const validateReport = new Ajv2020({ allErrors: true }).compile(reportSchema)

const document =
  'format: yarramate/v1\n' +
  'id: main\n' +
  'profile: yarramate/core@0.1\n' +
  'concepts:\n' +
  '  - id: architect\n' +
  '    kind: businessActor\n' +
  '    name: Lead architect\n' +
  '  - id: checkout\n' +
  '    kind: applicationComponent\n' +
  '    name: Checkout\n' +
  '    attestations:\n' +
  '      - topic: adequacy\n' +
  '        by: architect\n' +
  '        on: "2026-01-01"\n' +
  '  - id: billing\n' +
  '    kind: applicationComponent\n' +
  '    name: Billing\n' +
  'relationships:\n' +
  '  - id: checkout-serves-billing\n' +
  '    kind: serving\n' +
  '    from: checkout\n' +
  '    to: billing\n'

// Two questions, one per required condition, each written so exactly one of
// the two components triggers it: an assertion that only counts openings
// cannot tell a working condition from one that fires on everything.
const catalogue =
  'format: yarramate/question-catalogue/v1\n' +
  'id: aperturex-fixture\n' +
  'version: "1.0"\n' +
  'profile: yarramate/core@0.1\n' +
  'waves:\n' +
  '  - id: structure\n' +
  '    name: Structure\n' +
  '  - id: assurance\n' +
  '    name: Assurance\n' +
  'questions:\n' +
  '  - id: component-serves-nothing\n' +
  '    wave: structure\n' +
  '    scope: subject\n' +
  '    subjects:\n' +
  '      kinds: ["yarramate/core@0.1#applicationComponent"]\n' +
  '    trigger:\n' +
  '      - condition: missing-relationship\n' +
  '        kinds: ["yarramate/core@0.1#serving"]\n' +
  '        direction: outgoing\n' +
  '    question: What does {subject.name} serve?\n' +
  '    materiality: A component serving nothing has no stated consumer.\n' +
  '    authority: agent\n' +
  '    resolution: Add a serving relationship.\n' +
  '  - id: component-unattested\n' +
  '    wave: assurance\n' +
  '    scope: subject\n' +
  '    subjects:\n' +
  '      kinds: ["yarramate/core@0.1#applicationComponent"]\n' +
  '    trigger:\n' +
  '      - condition: missing-attestation\n' +
  '        topic: adequacy\n' +
  '    question: Who signed off {subject.name}?\n' +
  '    materiality: An unattested component carries nobody judgment.\n' +
  '    authority: human\n' +
  '    resolution: Record an adequacy attestation.\n'

const evaluate = (): InterrogationReport => {
  const compilation = compileWorkspaceWithProfileContext([
    { path: 'architecture/main.yaml', source: document },
  ])
  if (!compilation.ok) {
    throw new Error(
      `fixture did not compile: ${compilation.diagnostics.map(({ message }) => message).join('; ')}`,
    )
  }
  const loaded = loadQuestionCatalogue({
    path: 'catalogue.yaml',
    source: catalogue,
  })
  if (!loaded.ok) {
    throw new Error(
      `fixture catalogue did not load: ${loaded.diagnostics.map(({ message }) => message).join('; ')}`,
    )
  }
  return {
    workspace: 'aperturex-fixture',
    ...evaluateCatalogue(
      loaded.catalogue,
      compilation.graph,
      compilation.profileContext,
    ),
  }
}

const questionById = (report: InterrogationReport, id: string) => {
  const found = report.waves
    .flatMap(({ questions }) => questions)
    .find((question) => question.id === id)
  if (found === undefined) throw new Error(`no question ${id} in report`)
  return found
}

describe('interrogation engine as public API', () => {
  it('evaluates an in-memory workspace with no filesystem access', () => {
    const report = evaluate()
    expect(report.catalogue).toBe('aperturex-fixture@1.0')
    expect(report.summary.questions).toBe(2)
    expect(report.summary.openQuestions).toBe(2)
  })

  it('produces a report that validates against the published schema', () => {
    const report = evaluate()
    const valid = validateReport(report)
    expect(validateReport.errors ?? []).toEqual([])
    expect(valid).toBe(true)
  })

  it('triggers missing-relationship on the component that serves nothing', () => {
    const question = questionById(evaluate(), 'component-serves-nothing')
    expect(question.open).toBe(true)
    // checkout serves billing, so only billing is left without an outgoing
    // serving edge.
    expect(question.subjects?.map(({ id }) => id)).toEqual(['billing'])
    expect(question.subjects?.[0]?.question).toBe('What does Billing serve?')
  })

  it('triggers missing-attestation on the component nobody signed off', () => {
    const question = questionById(evaluate(), 'component-unattested')
    expect(question.open).toBe(true)
    expect(question.subjects?.map(({ id }) => id)).toEqual(['billing'])
  })

  it('round-trips authority from the catalogue into the report', () => {
    const report = evaluate()
    expect(questionById(report, 'component-serves-nothing').authority).toBe(
      'agent',
    )
    expect(questionById(report, 'component-unattested').authority).toBe('human')
  })

  it('renders the report and a single question through the exported renderers', () => {
    expect(renderInterrogationReport(evaluate())).toContain('== Structure ==')
    expect(renderQuestion('Who owns {subject.name}?', 'billing', 'Billing')).toBe(
      'Who owns Billing?',
    )
  })
})
