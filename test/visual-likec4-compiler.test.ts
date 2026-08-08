import { existsSync, watch } from 'node:fs'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  VISUAL_COMPILER_DOCUMENT,
  VISUAL_COMPILER_EXPORT_FILE,
  compileVisualModel,
} from '../src/adapters/visual/likec4-compiler.js'
import type {
  VisualCompilerCommand,
  VisualModel,
  VisualSessionRequest,
} from '../src/adapters/visual/protocol.js'
import {
  createVisualSession,
  readActiveVisualModel,
  type VisualSessionPaths,
} from '../src/adapters/visual/session-store.js'

const fakeLikeC4 = fileURLToPath(
  new URL('./fixtures/visual/fake-likec4.mjs', import.meta.url),
)

const compiler: VisualCompilerCommand = {
  command: process.execPath,
  args: [fakeLikeC4],
}

/**
 * The fixture compiler reads its behaviour from a marker comment in a staged
 * source file, so every failure mode is driven by the model under compilation
 * rather than by mocking the adapter's own process handling.
 */
const marked = (marker?: string): VisualModel => ({
  format: 'yarramate/visual-model/v1',
  authority: 'ad-hoc',
  initialView: 'choices',
  sourceDigests: {},
  files: {
    'likec4.config.json': '{"name":"visual"}',
    'model.likec4': `model {\n  system = system "System"\n}\n${
      marker === undefined ? '' : `// fake:${marker}\n`
    }`,
    'views/choices.likec4': 'views { view choices { include * } }',
  },
})

const model = marked()

const request: VisualSessionRequest = {
  format: 'yarramate/visual-session-request/v1',
  authority: 'ad-hoc',
  title: 'Choose a delivery design',
  description: 'Temporary non-canonical comparison',
  chatEnabled: true,
  compiler,
  initialModel: model,
}

const sessionId = '07'.repeat(16)

const compile = (
  paths: VisualSessionPaths,
  overrides: Partial<Parameters<typeof compileVisualModel>[0]> = {},
) =>
  compileVisualModel({
    model,
    command: compiler,
    paths,
    now: () => new Date('2026-08-08T00:00:05.000Z'),
    ...overrides,
  })

describe('trusted LikeC4 compiler adapter', () => {
  let parent = ''
  let invocations = ''

  beforeEach(async () => {
    parent = await mkdtemp(join(tmpdir(), 'yarramate-visual-compiler-'))
    invocations = join(parent, 'invocations.jsonl')
    process.env.YARRAMATE_FAKE_LIKEC4_LOG = invocations
  })

  afterEach(async () => {
    delete process.env.YARRAMATE_FAKE_LIKEC4_LOG
    await rm(parent, { recursive: true, force: true })
  })

  const startSession = async () =>
    createVisualSession(request, {
      baseDir: parent,
      now: () => new Date('2026-08-08T00:00:00.000Z'),
      randomBytes: () => Buffer.alloc(32, 7),
    })

  const argVectors = async () =>
    (await readFile(invocations, 'utf8'))
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as readonly string[])

  describe('successful compilation', () => {
    it('validates, exports, and promotes one complete visual model', async () => {
      const session = await startSession()

      const result = await compile(session.paths)

      expect(result).toMatchObject({
        ok: true,
        compiled: {
          initialView: 'choices',
          authority: 'ad-hoc',
          candidate: '000001',
          views: ['choices'],
        },
      })
      expect(
        JSON.parse(await readFile(session.paths.activeModel, 'utf8')),
      ).toMatchObject({
        candidate: '000001',
        initialView: 'choices',
        authority: 'ad-hoc',
        promotedAt: '2026-08-08T00:00:05.000Z',
      })
    })

    it('runs validate before export with a deterministic argument vector', async () => {
      const session = await startSession()
      const candidateDir = join(session.paths.candidates, '000001')

      await compile(session.paths)

      expect(await argVectors()).toEqual([
        [
          'validate',
          '--json',
          '--no-layout',
          '--file',
          'model.likec4',
          '--file',
          'views/choices.likec4',
          candidateDir,
        ],
        [
          'export',
          'json',
          '--pretty',
          '-o',
          join(candidateDir, VISUAL_COMPILER_EXPORT_FILE),
          candidateDir,
        ],
      ])
    })

    it('keeps every written artefact inside the allocated candidate root', async () => {
      const session = await startSession()

      const result = await compile(session.paths)

      if (!result.ok) throw new Error('expected a compiled model')
      expect(result.compiled.exportPath).toBe(
        join(result.compiled.candidateDir, VISUAL_COMPILER_EXPORT_FILE),
      )
      expect((await readdir(result.compiled.candidateDir)).sort()).toEqual([
        VISUAL_COMPILER_EXPORT_FILE,
        'likec4.config.json',
        'model.likec4',
        'views',
      ])
      expect((await readdir(session.paths.root)).sort()).toEqual([
        'active-model.json',
        'candidates',
        'journal.jsonl',
        'session.json',
      ])
      expect((await readdir(parent)).sort()).toEqual([
        sessionId,
        'invocations.jsonl',
      ])
    })
  })

  describe('compiler rejection', () => {
    it('reports LikeC4 validation errors as source-located diagnostics', async () => {
      const session = await startSession()

      const result = await compile(session.paths, { model: marked('invalid') })

      expect(result).toEqual({
        ok: false,
        diagnostics: [
          {
            severity: 'error',
            code: 'YMVS201',
            message: 'Unresolved reference "ghost"',
            path: 'model.likec4',
            pointer: '/files/model.likec4',
            line: 2,
            column: 5,
          },
        ],
      })
    })

    it('never exports a model that failed validation', async () => {
      const session = await startSession()

      await compile(session.paths, { model: marked('invalid') })

      expect((await argVectors()).map((argv) => argv[0])).toEqual(['validate'])
    })

    it('reports a compiler that exits without a validation report', async () => {
      const session = await startSession()

      const result = await compile(session.paths, { model: marked('crash') })

      expect(result.diagnostics).toEqual([
        {
          severity: 'error',
          code: 'YMVS203',
          message:
            'LikeC4 validate exited with status 3: fake-likec4: project not found',
          path: VISUAL_COMPILER_DOCUMENT,
          pointer: '/files',
          line: 1,
          column: 1,
        },
      ])
    })

    it('reports validation output that is not a JSON report', async () => {
      const session = await startSession()

      const result = await compile(session.paths, { model: marked('garbage') })

      expect(result.diagnostics).toMatchObject([
        { code: 'YMVS206', path: VISUAL_COMPILER_DOCUMENT, pointer: '/files' },
      ])
    })

    it('rejects an export document that is not JSON', async () => {
      const session = await startSession()

      const result = await compile(session.paths, {
        model: marked('malformed-export'),
      })

      expect(result.diagnostics).toMatchObject([{ code: 'YMVS207' }])
    })

    it('rejects an export that carries no views', async () => {
      const session = await startSession()

      const result = await compile(session.paths, {
        model: marked('no-views'),
      })

      expect(result.diagnostics).toMatchObject([{ code: 'YMVS208' }])
    })

    it('rejects an export that omits the requested initial view', async () => {
      const session = await startSession()

      const result = await compile(session.paths, {
        model: { ...model, initialView: 'detail' },
      })

      expect(result.diagnostics).toMatchObject([
        { code: 'YMVS209', message: expect.stringContaining('detail') },
      ])
    })
  })

  describe('process bounds', () => {
    // The fixture compiler never exits, so the budget can only be observed
    // against the platform clock; a fake timer cannot bound a real child.
    it('abandons a compiler that outruns its time budget', async () => {
      const session = await startSession()

      const result = await compile(session.paths, {
        model: marked('hang'),
        timeoutMs: 100,
      })

      expect(result.diagnostics).toMatchObject([
        { code: 'YMVS204', message: expect.stringContaining('100ms') },
      ])
    })

    it('abandons a compiler when the caller cancels the compilation', async () => {
      const session = await startSession()
      const controller = new AbortController()
      // Cancel only once the fixture compiler has recorded its invocation, so
      // this exercises killing a live child rather than a pre-aborted spawn.
      const started = new Promise<void>((resolve) => {
        const watcher = watch(parent, () => {
          if (!existsSync(invocations)) return
          watcher.close()
          resolve()
        })
      })

      const running = compile(session.paths, {
        model: marked('hang'),
        signal: controller.signal,
      })
      await started
      controller.abort()

      expect((await running).diagnostics).toMatchObject([
        { code: 'YMVS204', message: expect.stringContaining('cancelled') },
      ])
    })

    it('stops a compiler that floods its output budget', async () => {
      const session = await startSession()

      const result = await compile(session.paths, {
        model: marked('flood'),
        maxOutputBytes: 4096,
      })

      expect(result.diagnostics).toMatchObject([
        { code: 'YMVS205', message: expect.stringContaining('4096') },
      ])
    })

    it('rejects an export document larger than its budget', async () => {
      const session = await startSession()

      const result = await compile(session.paths, {
        model: marked('huge-export'),
        maxExportBytes: 4096,
      })

      expect(result.diagnostics).toMatchObject([
        { code: 'YMVS205', message: expect.stringContaining('4096') },
      ])
      expect(existsSync(session.paths.activeModel)).toBe(false)
    })
  })

  describe('trusted command vector', () => {
    it('refuses a compiler command that is not an absolute path', async () => {
      const session = await startSession()

      const result = await compile(session.paths, {
        command: { command: 'node', args: [fakeLikeC4] },
      })

      expect(result).toEqual({
        ok: false,
        diagnostics: [
          {
            severity: 'error',
            code: 'YMVS202',
            message:
              'LikeC4 compiler command "node" must be an absolute executable path',
            path: VISUAL_COMPILER_DOCUMENT,
            pointer: '/files',
            line: 1,
            column: 1,
          },
        ],
      })
      expect(existsSync(join(session.paths.candidates, '000001'))).toBe(false)
      expect(existsSync(session.paths.activeModel)).toBe(false)
    })

    it('refuses a relative command before spawning anything', async () => {
      const session = await startSession()

      // A bare 'node' would resolve and run the fixture compiler if the guard
      // were dropped, so an empty invocation log proves nothing was executed.
      await compile(session.paths, {
        command: { command: 'node', args: [fakeLikeC4] },
      })

      expect(existsSync(invocations)).toBe(false)
    })
  })

  describe('last-good preservation', () => {
    it('leaves the active model unchanged after validation failure', async () => {
      const session = await startSession()
      await compile(session.paths)
      const before = await readFile(session.paths.activeModel, 'utf8')

      const failed = await compile(session.paths, {
        model: { ...marked('invalid'), initialView: 'detail' },
        now: () => new Date('2026-08-08T00:00:09.000Z'),
      })

      expect(failed.ok).toBe(false)
      expect(await readFile(session.paths.activeModel, 'utf8')).toBe(before)
      expect(await readActiveVisualModel(session.paths)).toMatchObject({
        candidate: '000001',
        initialView: 'choices',
      })
    })

    it('keeps the last good export readable after a failed candidate', async () => {
      const session = await startSession()
      const first = await compile(session.paths)
      if (!first.ok) throw new Error('expected a compiled model')
      const exported = await readFile(first.compiled.exportPath, 'utf8')

      await compile(session.paths, {
        model: marked('malformed-export'),
        now: () => new Date('2026-08-08T00:00:09.000Z'),
      })

      expect(await readFile(first.compiled.exportPath, 'utf8')).toBe(exported)
      expect(existsSync(join(session.paths.candidates, '000002'))).toBe(true)
    })
  })
})
