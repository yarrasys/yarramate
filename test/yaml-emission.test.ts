import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { emitYaml } from '../src/yaml-emission.js'

// A YAML 1.1 loader is what PyYAML's default is, and what most non-JS
// loaders are. Reading the emitted text back under both versions is the
// whole claim this module makes, so the tests read it back under both.
const bothVersions = (source: string) => ({
  under11: parse(source, { version: '1.1' }) as unknown,
  under12: parse(source, { version: '1.2' }) as unknown,
})

describe('emitYaml', () => {
  it('quotes the attestation `on` key, which YAML 1.1 reads as the boolean true', () => {
    const attestation = {
      topic: 'adequacy',
      by: 'reviewer',
      recordedBy: 'agent',
      on: '2026-08-27',
    }
    const source = emitYaml([attestation], { lineWidth: 0 })
    expect(source).toContain('"on": "2026-08-27"')
    const { under11, under12 } = bothVersions(source)
    expect(under11).toEqual([attestation])
    expect(under12).toEqual([attestation])
  })

  it('quotes every YAML 1.1 boolean alias an author can write as a value', () => {
    // `y|yes|n|no|on|off|true|false` in any case: the alias set is 1.1's, and
    // a concept named "No" is an ordinary thing for an author to write.
    const aliases = ['y', 'Y', 'yes', 'Yes', 'n', 'N', 'no', 'No', 'on', 'On', 'off', 'OFF']
    const source = emitYaml({ aka: aliases }, { lineWidth: 0 })
    const { under11, under12 } = bothVersions(source)
    expect(under11).toEqual({ aka: aliases })
    expect(under12).toEqual({ aka: aliases })
  })

  it('quotes what only YAML 1.2 resolves, so emitting under 1.1 alone is not the fix', () => {
    // `0o17` is a plain string to 1.1 and the integer 15 to 1.2 - and 1.2 is
    // what YarraMate's own reader is. The disagreement runs both ways, which
    // is why the rule asks both emitters rather than picking one.
    const source = emitYaml({ id: '0o17' }, { lineWidth: 0 })
    expect(source).toContain('"0o17"')
    expect(bothVersions(source).under12).toEqual({ id: '0o17' })
  })

  it('quotes a sexagesimal, which 1.1 reads as a number of seconds', () => {
    const source = emitYaml({ name: '1:30' }, { lineWidth: 0 })
    expect(bothVersions(source).under11).toEqual({ name: '1:30' })
  })

  it('leaves an unambiguous string plain, so a fix for `on` is not churn for everything', () => {
    const fields = {
      id: 'todo-service',
      kind: 'applicationService',
      name: 'Todo service',
      status: 'planned',
    }
    expect(emitYaml(fields, { lineWidth: 0 })).toBe(
      'id: todo-service\nkind: applicationService\nname: Todo service\nstatus: planned\n',
    )
  })

  it('leaves a multi-line string a block scalar rather than escaping it', () => {
    // Both versions write a block scalar the same way, so the rule finds no
    // disagreement and the value keeps its readable shape.
    const source = emitYaml({ description: 'line one\nline two\n' }, { lineWidth: 0 })
    expect(source).toBe('description: |\n  line one\n  line two\n')
  })

  it("honours the stringify options the caller passes", () => {
    const source = emitYaml([{ id: 'a', on: '2026-08-27' }], {
      collectionStyle: 'flow',
      lineWidth: 0,
    })
    expect(source.trimEnd()).toBe('[ { id: a, "on": "2026-08-27" } ]')
  })

  it('reads back identically under both versions for every shape a document carries', () => {
    const document = {
      format: 'yarramate/v1',
      id: 'main',
      concepts: [
        {
          id: 'user',
          kind: 'businessActor',
          name: 'No',
          description: 'A person.\nOn two lines.\n',
          aka: ['off', '0o17', '2026-08-27', '1:30', '~', '0755'],
          attestations: [
            { topic: 'adequacy', by: 'reviewer', recordedBy: 'agent', on: '2026-08-27' },
          ],
        },
      ],
    }
    const { under11, under12 } = bothVersions(emitYaml(document, { lineWidth: 0 }))
    expect(under11).toEqual(document)
    expect(under12).toEqual(document)
  })
})

describe('the writers', () => {
  // The reported defect was one emitter's output, but every emitter fails the
  // same way, and the next one written would fail it again. The guard is on
  // the import rather than on eight outputs: nothing under src/ may reach for
  // the raw `stringify`, so a new writer inherits the rule by construction.
  const sourceFiles = (directory: string): readonly string[] =>
    readdirSync(directory).flatMap((entry) => {
      const full = join(directory, entry)
      if (statSync(full).isDirectory()) return sourceFiles(full)
      return /\.tsx?$/.test(entry) ? [full] : []
    })

  it('emit YAML through emitYaml, never through the raw stringify', () => {
    const offenders = sourceFiles(join(process.cwd(), 'src'))
      .filter((file) => !file.endsWith('yaml-emission.ts'))
      .filter((file) => {
        const text = readFileSync(file, 'utf8')
        return /import\s*\{[^}]*\bstringify\b[^}]*\}\s*from\s*['"]yaml['"]/.test(text)
      })
      .map((file) => file.slice(process.cwd().length + 1))
    expect(offenders).toEqual([])
  })
})
