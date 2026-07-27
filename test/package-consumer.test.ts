import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))

describe('consumer package contract', () => {
  it('declares a narrow runtime, schema, skill, and consumer-document surface', () => {
    const packageJson = JSON.parse(
      readFileSync(join(repositoryRoot, 'package.json'), 'utf8'),
    )

    expect(packageJson.files).toEqual([
      'dist',
      'schema',
      'skills/yarramate-architecture',
      'docs/CONSUMING-YARRAMATE.md',
    ])
    expect(packageJson.scripts.prepack).toBe('pnpm build')
    expect(
      packageJson.exports['./skill/yarramate-architecture'],
    ).toBe('./skills/yarramate-architecture/SKILL.md')
  })

  it('packs only a self-contained consumer surface', () => {
    const parent = mkdtempSync(join(tmpdir(), 'yarramate-package-'))
    try {
      const packed = JSON.parse(
        execFileSync(
          'npm',
          ['pack', '--json', '--pack-destination', parent],
          {
            cwd: repositoryRoot,
            encoding: 'utf8',
            env: {
              ...process.env,
              npm_config_cache: join(parent, 'npm-cache'),
            },
          },
        ),
      )
      const archive = join(parent, packed[0].filename)
      const files = execFileSync('tar', ['-tzf', archive], {
        encoding: 'utf8',
      }).trim().split('\n')

      expect(files).toContain('package/dist/cli.js')
      expect(files).toContain('package/schema/yarramate-document.schema.json')
      expect(files).toContain(
        'package/skills/yarramate-architecture/SKILL.md',
      )
      expect(files).toContain(
        'package/skills/yarramate-architecture/references/native-authoring.md',
      )
      expect(files).toContain('package/docs/CONSUMING-YARRAMATE.md')
      expect(
        files.some((file) =>
          [
            'package/src/',
            'package/test/',
            'package/.yarramate/',
          ].some((prefix) => file.startsWith(prefix)),
        ),
      ).toBe(false)
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('runs both journey primitives from the packed CLI in a clean consumer project', () => {
    const consumer = mkdtempSync(
      join(repositoryRoot, 'node_modules/.yarramate-consumer-'),
    )
    try {
      const packed = JSON.parse(
        execFileSync(
          'npm',
          ['pack', '--json', '--pack-destination', consumer],
          {
            cwd: repositoryRoot,
            encoding: 'utf8',
            env: {
              ...process.env,
              npm_config_cache: join(consumer, 'npm-cache'),
            },
          },
        ),
      )
      const packagePath = join(consumer, 'node_modules/yarramate')
      mkdirSync(packagePath, { recursive: true })
      execFileSync(
        'tar',
        [
          '-xzf',
          join(consumer, packed[0].filename),
          '-C',
          packagePath,
          '--strip-components=1',
        ],
      )
      const binDirectory = join(consumer, 'node_modules/.bin')
      mkdirSync(binDirectory, { recursive: true })
      const cli = join(binDirectory, 'yarramate')
      chmodSync(join(packagePath, 'dist/cli.js'), 0o755)
      symlinkSync('../yarramate/dist/cli.js', cli)
      const likec4Cli = join(binDirectory, 'yarramate-likec4')
      chmodSync(join(packagePath, 'dist/adapters/likec4-cli.js'), 0o755)
      symlinkSync('../yarramate/dist/adapters/likec4-cli.js', likec4Cli)
      const run = (args: readonly string[]) =>
        execFileSync(cli, args, {
          cwd: consumer,
          encoding: 'utf8',
        })

      expect(run(['init', '.'])).toBe(
        'Created .yarramate/architecture/main.yaml and .yarramate/workspace.yaml\n',
      )
      writeFileSync(
        join(consumer, '.yarramate/architecture/main.yaml'),
        `format: yarramate/v1
id: consumer
profile: yarramate/core@0.1
states:
  - id: baseline
    kind: baseline
    name: Before implementation
  - id: target
    kind: target
    name: Target solution
    after: baseline
concepts:
  - id: australia-only
    kind: constraint
    name: Australian data residency
  - id: delivery-api
    kind: applicationComponent
    name: Delivery API
    status: planned
    presentIn: [target]
  - id: delivery-data
    kind: dataObject
    name: Delivery data
    status: planned
    constraints:
      - id: residency
        ref: australia-only
    presentIn: [target]
relationships:
  - id: api-accesses-data
    kind: access
    from: delivery-api
    to: delivery-data
    mode: read-write
    presentIn: [target]
`,
      )
      mkdirSync(join(consumer, '.yarramate/projections'))
      mkdirSync(join(consumer, '.yarramate/evidence'))
      writeFileSync(
        join(consumer, '.yarramate/projections/target.yaml'),
        `format: yarramate/projection/v1
id: consumer-target
version: "1.0"
query:
  subjects:
    - consumer#delivery-api
    - consumer#delivery-data
  states:
    - consumer#target
  relationships: between
`,
      )
      writeFileSync(
        join(consumer, 'implementation.ts'),
        'export const deliveryApi = true\n',
      )
      writeFileSync(
        join(consumer, '.yarramate/evidence/repository.yaml'),
        `format: yarramate/evidence/v1
id: consumer-repository
version: "1.0"
provider: repository-inspection
observations:
  - subject: consumer#delivery-api
    result: confirmed
    evidence:
      uri: repo:implementation.ts
`,
      )
      writeFileSync(
        join(consumer, '.yarramate/workspace.yaml'),
        `format: yarramate/workspace/v1
id: consumer
documents:
  - architecture/*.yaml
profiles: []
projections:
  - projections/*.yaml
adapterMappings: []
evidence:
  - evidence/*.yaml
`,
      )

      expect(
        JSON.parse(run(['check', '.yarramate/workspace.yaml', '--json'])),
      ).toEqual({
        format: 'yarramate/check-result/v1',
        ok: true,
        diagnostics: [],
      })
      expect(
        JSON.parse(
          run([
            'context',
            '.yarramate/projections/target.yaml',
            '.yarramate/workspace.yaml',
          ]),
        ).subjects,
      ).toEqual([
        { id: 'consumer#api-accesses-data', type: 'relationship' },
        { id: 'consumer#delivery-api', type: 'concept' },
        { id: 'consumer#delivery-data', type: 'concept' },
      ])
      expect(
        JSON.parse(
          run([
            'evidence',
            '.yarramate/evidence/repository.yaml',
            '.yarramate/workspace.yaml',
          ]),
        ).summary.confirmed,
      ).toBe(1)
      expect(
        JSON.parse(
          run([
            'compare',
            'consumer#baseline',
            'consumer#target',
            '.yarramate/workspace.yaml',
          ]),
        ).added,
      ).toHaveLength(3)
      const likec4Invocation = spawnSync(likec4Cli, [], {
        cwd: consumer,
        encoding: 'utf8',
      })
      expect(likec4Invocation.status).toBe(2)
      expect(likec4Invocation.stderr).toContain('yarramate-likec4 check')

      const requireFromConsumer = createRequire(
        join(consumer, 'consumer.js'),
      )
      expect(
        requireFromConsumer.resolve(
          'yarramate/skill/yarramate-architecture',
        ),
      ).toBe(join(packagePath, 'skills/yarramate-architecture/SKILL.md'))

      for (const harness of ['.agents', '.claude']) {
        const skillDirectory = join(consumer, harness, 'skills')
        mkdirSync(skillDirectory, { recursive: true })
        const linkedSkill = join(skillDirectory, 'yarramate-architecture')
        symlinkSync(
          '../../node_modules/yarramate/skills/yarramate-architecture',
          linkedSkill,
        )
        expect(realpathSync(linkedSkill)).toBe(
          realpathSync(join(packagePath, 'skills/yarramate-architecture')),
        )
      }
    } finally {
      rmSync(consumer, { recursive: true, force: true })
    }
  })
})
