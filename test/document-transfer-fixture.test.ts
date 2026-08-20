import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { runCli } from '../src/cli.js'

const repositoryRoot = resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '..',
)

const workspace =
  'test/fixtures/valid/document-transfer.workspace.yaml'

describe('document-transfer capture fixture', () => {
  it('checks and renders distinct authn and capacity subjects in the brief', () => {
    const checked = runCli(['check', workspace], repositoryRoot)
    expect(checked.exitCode).toBe(0)

    const asked = runCli(
      [
        'ask',
        workspace,
        'test/fixtures/valid/document-transfer.projection.yaml',
      ],
      repositoryRoot,
    )
    expect(asked.exitCode).toBe(0)
    expect(asked.stdout).toContain('OAuth client-credentials')
    expect(asked.stdout).toContain('100 requests per client per second')
    expect(asked.stdout).toContain('No caller-facing rate limit')
    expect(asked.stdout).toContain('Document payload')
  })
})
