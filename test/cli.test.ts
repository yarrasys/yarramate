import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { runCli } from '../src/cli.js'

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))

describe('yarramate check', () => {
  it('emits deterministic machine-readable diagnostics and a failing exit code', () => {
    const result = runCli(
      [
        'check',
        'test/fixtures/invalid/unknown-concept-kind.yaml',
        '--json',
      ],
      repositoryRoot,
    )

    expect(result).toEqual({
      exitCode: 1,
      stdout:
        '{\n' +
        '  "ok": false,\n' +
        '  "diagnostics": [\n' +
        '    {\n' +
        '      "severity": "error",\n' +
        '      "code": "YM401",\n' +
        '      "message": "Unknown concept kind \\"mysteryKind\\" in profile \\"yarramate/core@0.1\\"",\n' +
        '      "path": "test/fixtures/invalid/unknown-concept-kind.yaml",\n' +
        '      "pointer": "/concepts/0/kind",\n' +
        '      "line": 6,\n' +
        '      "column": 11\n' +
        '    }\n' +
        '  ]\n' +
        '}\n',
      stderr: '',
    })
  })

  it('reports successful checks without emitting a compiled artifact', () => {
    const result = runCli(
      ['check', 'test/fixtures/valid/minimal.yaml'],
      repositoryRoot,
    )

    expect(result).toEqual({
      exitCode: 0,
      stdout: 'Checked 1 document: no errors\n',
      stderr: '',
    })
  })
})
