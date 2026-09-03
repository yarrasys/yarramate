import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runCli } from '../src/cli.js'
import { compileWorkspaceWithProfileContext } from '../src/index.js'

// #448: `conceptFields` was closed and `parts` was not in it, so
// `YM201 Property "parts" is not allowed` and an agent could not instantiate a
// pattern over `apply` AT ALL. The whole pattern mechanism (ADR 0123) was
// reachable only from raw YAML, which is the one surface agents do not drive.
//
// The semantics under test are ADR 0062's, not new ones: a named slot rebinds,
// an unnamed slot is untouched, and retraction is coarse. The assertions that
// matter are the ones about what a write must NOT do — silently unbind a slot
// the operation never mentioned.

const profile = `format: yarramate/profile/v1
id: aperturex/mule
version: "1.0"
extends: yarramate/core@0.1
conceptKinds:
  - id: mule-http-api
    name: Mule HTTP API
    parent: yarramate/core@0.1#grouping
relationshipKinds: []
`

const pattern = `format: yarramate/pattern/v1
id: mule
version: "1.0"
patterns:
  - kind: aperturex/mule@1.0#mule-http-api
    parts:
      interface:
        kind: yarramate/core@0.1#applicationInterface
        required: true
      service:
        kind: yarramate/core@0.1#applicationService
      backend:
        kind: yarramate/core@0.1#applicationComponent
    wiring:
      - from: self
        kind: yarramate/core@0.1#aggregation
        to: interface
`

const document = `format: yarramate/v1
id: main
profile: aperturex/mule@1.0
concepts:
  - id: greeting-app
    kind: mule-http-api
    name: Greeting app
    parts:
      interface: patron-api
      service: greeting-service
  - id: patron-api
    kind: applicationInterface
    name: Patron API
  - id: greeting-service
    kind: applicationService
    name: Greeting service
  - id: other-service
    kind: applicationService
    name: Other service
  - id: greeting-backend
    kind: applicationComponent
    name: Greeting backend
relationships: []
`

describe('#448: parts over operations', () => {
  let workspace = ''
  const write = (relative: string, source: string) =>
    writeFileSync(join(workspace, relative), source, 'utf8')
  const read = (relative: string) =>
    readFileSync(join(workspace, relative), 'utf8')

  const apply = (operations: readonly unknown[]) => {
    // JSON is a YAML subset, so the batch is written as data rather than
    // hand-formatted text: these tests are about what the splice does, not
    // about parsing.
    write(
      'operations.yaml',
      JSON.stringify({ format: 'yarramate/operations/v1', operations }),
    )
    return runCli(['apply', 'operations.yaml', 'workspace.yaml'], workspace)
  }

  /** The parts mapping as it stands in the document, slot to subject. */
  const partsOf = (id: string): Record<string, string> => {
    const source = read('architecture/main.yaml')
    const lines = source.split('\n')
    const start = lines.findIndex((line) => line.includes(`- id: ${id}`))
    expect(start).toBeGreaterThanOrEqual(0)
    const parts: Record<string, string> = {}
    let inParts = false
    for (const line of lines.slice(start + 1)) {
      if (/^ {2}- /.test(line)) break
      if (/^ {4}parts:\s*$/.test(line)) {
        inParts = true
        continue
      }
      if (inParts) {
        const match = /^ {6}([a-z][a-z0-9-]*): (\S+)\s*$/.exec(line)
        if (match === null) break
        parts[match[1]!] = match[2]!
      }
    }
    return parts
  }

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'yarramate-parts-'))
    for (const directory of ['architecture', 'profiles', 'patterns']) {
      mkdirSync(join(workspace, directory), { recursive: true })
    }
    write(
      'workspace.yaml',
      'format: yarramate/workspace/v1\n' +
        'id: parts-probe\n' +
        'documents:\n  - architecture/main.yaml\n' +
        'profiles:\n  - profiles/mule.yaml\n' +
        'projections: []\n' +
        'adapterMappings: []\n' +
        'patterns:\n  - patterns/mule.yaml\n',
    )
    write('architecture/main.yaml', document)
    write('profiles/mule.yaml', profile)
    write('patterns/mule.yaml', pattern)
  })

  afterEach(() => rmSync(workspace, { recursive: true, force: true }))

  it('binds a slot the instance had not bound', () => {
    // The reported gap: this failed with YM201 before, so a pattern could not
    // be instantiated over the operations surface at all.
    const result = apply([
      {
        op: 'update-concept',
        document: 'architecture/main.yaml',
        concept: { id: 'greeting-app', parts: { backend: 'greeting-backend' } },
      },
    ])
    expect(result.exitCode).toBe(0)
    expect(partsOf('greeting-app')).toEqual({
      interface: 'patron-api',
      service: 'greeting-service',
      backend: 'greeting-backend',
    })
  })

  it('does NOT unbind the slots it did not mention', () => {
    // The assertion this whole file exists for. Replace-whole-map would leave
    // `interface` and `service` gone, which is the silent shrinking ADR 0062
    // forbids - and here it would also break the compile, since `interface` is
    // required.
    apply([
      {
        op: 'update-concept',
        document: 'architecture/main.yaml',
        concept: { id: 'greeting-app', parts: { backend: 'greeting-backend' } },
      },
    ])
    expect(Object.keys(partsOf('greeting-app')).sort()).toEqual([
      'backend',
      'interface',
      'service',
    ])
    expect(runCli(['check', 'workspace.yaml'], workspace).exitCode).toBe(0)
  })

  it('rebinds a slot that was already bound', () => {
    const result = apply([
      {
        op: 'update-concept',
        document: 'architecture/main.yaml',
        concept: { id: 'greeting-app', parts: { service: 'other-service' } },
      },
    ])
    expect(result.exitCode).toBe(0)
    expect(partsOf('greeting-app')).toEqual({
      interface: 'patron-api',
      service: 'other-service',
    })
  })

  it('creates the mapping on an instance that had no parts at all', () => {
    // The greenfield instance ADR 0140 made visible: an agent answering its
    // first vacancy question writes the `parts:` block that did not exist.
    write(
      'architecture/main.yaml',
      document.replace(
        '    parts:\n      interface: patron-api\n      service: greeting-service\n',
        '',
      ),
    )
    expect(partsOf('greeting-app')).toEqual({})
    const result = apply([
      {
        op: 'update-concept',
        document: 'architecture/main.yaml',
        concept: { id: 'greeting-app', parts: { interface: 'patron-api' } },
      },
    ])
    expect(result.exitCode).toBe(0)
    expect(partsOf('greeting-app')).toEqual({ interface: 'patron-api' })
  })

  it('adds an instance with its parts in one operation', () => {
    const result = apply([
      {
        op: 'add-concept',
        document: 'architecture/main.yaml',
        concept: {
          id: 'second-app',
          kind: 'mule-http-api',
          name: 'Second app',
          parts: { interface: 'patron-api' },
        },
      },
    ])
    expect(result.exitCode).toBe(0)
    expect(partsOf('second-app')).toEqual({ interface: 'patron-api' })
  })

  it('binds a part minted in the same batch', () => {
    // Cross-batch references resolve because the gate compiles the whole
    // candidate workspace atomically before a byte is written, so adding the
    // part and binding it is one batch rather than two.
    const result = apply([
      {
        op: 'add-concept',
        document: 'architecture/main.yaml',
        concept: {
          id: 'fresh-backend',
          kind: 'applicationComponent',
          name: 'Fresh backend',
        },
      },
      {
        op: 'update-concept',
        document: 'architecture/main.yaml',
        concept: { id: 'greeting-app', parts: { backend: 'fresh-backend' } },
      },
    ])
    expect(result.exitCode).toBe(0)
    expect(partsOf('greeting-app').backend).toBe('fresh-backend')
  })

  it('unbinds the whole mapping through remove, coarsely', () => {
    // The only retraction spelling. There is deliberately no
    // `remove: ["parts.service"]`: `parts` would become both the first
    // map-valued field and the first field with its own retraction grammar.
    const result = apply([
      {
        op: 'update-concept',
        document: 'architecture/main.yaml',
        concept: { id: 'greeting-app' },
        remove: ['parts'],
      },
    ])
    expect(result.exitCode).toBe(0)
    expect(partsOf('greeting-app')).toEqual({})
  })

  it('turns a full retraction into an interview question, not a compile error', () => {
    // The interaction between this and ADR 0140, which neither issue
    // anticipated and which is worth pinning because it is surprising in the
    // right direction.
    //
    // Removing the whole mapping leaves a concept with no `parts` key, which
    // is not a PatternInstance, so `YM416` CANNOT fire for the required
    // `interface` and the compile stays green. The requirement is not lost: as
    // a greenfield instance it now reports a vacancy per slot, with
    // `required: true` on the one that was retracted. The obligation moves
    // from the compile gate to the interview rather than disappearing.
    apply([
      {
        op: 'update-concept',
        document: 'architecture/main.yaml',
        concept: { id: 'greeting-app' },
        remove: ['parts'],
      },
    ])
    expect(runCli(['check', 'workspace.yaml'], workspace).exitCode).toBe(0)
    const compiled = compileWorkspaceWithProfileContext([
      { path: 'profiles/mule.yaml', source: profile },
      { path: 'patterns/mule.yaml', source: pattern },
      { path: 'architecture/main.yaml', source: read('architecture/main.yaml') },
    ])
    expect(compiled.ok).toBe(true)
    if (!compiled.ok) return
    expect(
      compiled.patternVacancies
        ?.filter(({ instance }) => instance === 'greeting-app')
        .map(({ slot, required }) => [slot, required]),
    ).toEqual([
      ['backend', false],
      ['interface', true],
      ['service', false],
    ])
  })

  it('unbinds the whole mapping where the pattern permits it', () => {
    // The same retraction against an instance whose parts are all optional:
    // expressible, applied, and the document loses the block.
    write(
      'patterns/mule.yaml',
      pattern.replace('        required: true\n', ''),
    )
    const result = apply([
      {
        op: 'update-concept',
        document: 'architecture/main.yaml',
        concept: { id: 'greeting-app' },
        remove: ['parts'],
      },
    ])
    expect(result.exitCode).toBe(0)
    expect(partsOf('greeting-app')).toEqual({})
  })

  it('refuses an operation that both sets and removes parts', () => {
    const result = apply([
      {
        op: 'update-concept',
        document: 'architecture/main.yaml',
        concept: { id: 'greeting-app', parts: { backend: 'greeting-backend' } },
        remove: ['parts'],
      },
    ])
    expect(result.exitCode).toBe(1)
    expect(result.stdout + result.stderr).toContain('both sets and removes')
  })

  it('refuses a slot the pattern does not declare, through the compile gate', () => {
    const result = apply([
      {
        op: 'update-concept',
        document: 'architecture/main.yaml',
        concept: { id: 'greeting-app', parts: { nonexistent: 'other-service' } },
      },
    ])
    expect(result.exitCode).toBe(1)
    expect(result.stdout + result.stderr).toContain('YM419')
    expect(partsOf('greeting-app')).toEqual({
      interface: 'patron-api',
      service: 'greeting-service',
    })
  })

  it('leaves the rest of the document byte-identical', () => {
    // An apply diff is exactly the answer it landed (#114): the splice touches
    // the parts mapping and nothing else.
    const before = read('architecture/main.yaml')
    apply([
      {
        op: 'update-concept',
        document: 'architecture/main.yaml',
        concept: { id: 'greeting-app', parts: { backend: 'greeting-backend' } },
      },
    ])
    const after = read('architecture/main.yaml')
    expect(after).toBe(
      before.replace(
        '      service: greeting-service\n',
        '      service: greeting-service\n      backend: greeting-backend\n',
      ),
    )
  })
})
