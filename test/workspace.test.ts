import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { loadWorkspaceManifest } from '../src/index.js'

const manifest = (documents: string) =>
  'format: yarramate/workspace/v1\n' +
  'id: test-workspace\n' +
  'documents:\n' +
  `  - ${documents}\n` +
  'profiles: []\n' +
  'projections: []\n' +
  'adapterMappings: []\n'

describe('workspace manifests', () => {
  it('enforces the closed normative manifest schema', () => {
    const directory = mkdtempSync(join(tmpdir(), 'yarramate-workspace-'))
    try {
      const result = loadWorkspaceManifest(
        {
          path: 'yarramate.workspace.yaml',
          source:
            manifest('architecture/*.yaml') +
            'output: graph.json\n',
        },
        directory,
      )
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({
          code: 'YM201',
          message: 'Property "output" is not allowed',
          pointer: '/output',
        }),
      )
    } finally {
      rmSync(directory, { recursive: true })
    }
  })

  it('reports a declared pattern that matches no files', () => {
    const directory = mkdtempSync(join(tmpdir(), 'yarramate-workspace-'))
    try {
      expect(
        loadWorkspaceManifest(
          {
            path: 'yarramate.workspace.yaml',
            source: manifest('architecture/*.yaml'),
          },
          directory,
        ),
      ).toEqual({
        ok: false,
        diagnostics: [
          {
            severity: 'error',
            code: 'YM702',
            message:
              'Workspace document pattern "architecture/*.yaml" matched no files',
            path: 'yarramate.workspace.yaml',
            pointer: '/documents/0',
            line: 4,
            column: 5,
          },
        ],
      })
    } finally {
      rmSync(directory, { recursive: true })
    }
  })

  it('rejects a pattern that traverses outside the manifest directory', () => {
    const directory = mkdtempSync(join(tmpdir(), 'yarramate-workspace-'))
    try {
      expect(
        loadWorkspaceManifest(
          {
            path: 'yarramate.workspace.yaml',
            source: manifest('../outside.yaml'),
          },
          directory,
        ),
      ).toEqual({
        ok: false,
        diagnostics: [
          {
            severity: 'error',
            code: 'YM701',
            message:
              'Workspace document pattern "../outside.yaml" must be a relative path beneath the manifest directory',
            path: 'yarramate.workspace.yaml',
            pointer: '/documents/0',
            line: 4,
            column: 5,
          },
        ],
      })
    } finally {
      rmSync(directory, { recursive: true })
    }
  })

  it('rejects one resolved file declared in multiple categories', () => {
    const directory = mkdtempSync(join(tmpdir(), 'yarramate-workspace-'))
    try {
      mkdirSync(join(directory, 'architecture'))
      writeFileSync(join(directory, 'architecture/main.yaml'), 'model', 'utf8')
      const source =
        'format: yarramate/workspace/v1\n' +
        'id: duplicate-category\n' +
        'documents:\n' +
        '  - architecture/main.yaml\n' +
        'profiles:\n' +
        '  - architecture/main.yaml\n' +
        'projections: []\n' +
        'adapterMappings: []\n'

      const result = loadWorkspaceManifest(
        { path: 'yarramate.workspace.yaml', source },
        directory,
      )
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.diagnostics).toContainEqual({
        severity: 'error',
        code: 'YM703',
        message:
          'Resolved file "architecture/main.yaml" is declared as both document and profile',
        path: 'yarramate.workspace.yaml',
        pointer: '/profiles/0',
        line: 6,
        column: 5,
      })
    } finally {
      rmSync(directory, { recursive: true })
    }
  })

  it('rejects one physical file aliased across categories by symlink', () => {
    const directory = mkdtempSync(join(tmpdir(), 'yarramate-workspace-'))
    try {
      mkdirSync(join(directory, 'architecture'))
      writeFileSync(join(directory, 'architecture/main.yaml'), 'model', 'utf8')
      symlinkSync(
        'main.yaml',
        join(directory, 'architecture/profile-alias.yaml'),
      )
      const source =
        'format: yarramate/workspace/v1\n' +
        'id: duplicate-category\n' +
        'documents:\n' +
        '  - architecture/main.yaml\n' +
        'profiles:\n' +
        '  - architecture/profile-alias.yaml\n' +
        'projections: []\n' +
        'adapterMappings: []\n'

      const result = loadWorkspaceManifest(
        { path: 'yarramate.workspace.yaml', source },
        directory,
      )
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.diagnostics).toContainEqual({
        severity: 'error',
        code: 'YM703',
        message:
          'Resolved file "architecture/profile-alias.yaml" is declared as both document and profile',
        path: 'yarramate.workspace.yaml',
        pointer: '/profiles/0',
        line: 6,
        column: 5,
      })
    } finally {
      rmSync(directory, { recursive: true })
    }
  })

  it('rejects a matched symlink that escapes the manifest directory', () => {
    const directory = mkdtempSync(join(tmpdir(), 'yarramate-workspace-'))
    const outside = join(tmpdir(), `outside-${Date.now()}.yaml`)
    try {
      mkdirSync(join(directory, 'architecture'))
      writeFileSync(outside, 'outside', 'utf8')
      symlinkSync(outside, join(directory, 'architecture/linked.yaml'))

      const result = loadWorkspaceManifest(
        {
          path: 'yarramate.workspace.yaml',
          source: manifest('architecture/*.yaml'),
        },
        directory,
      )
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.diagnostics).toContainEqual({
        severity: 'error',
        code: 'YM701',
        message:
          'Workspace document pattern "architecture/*.yaml" resolved outside the manifest directory',
        path: 'yarramate.workspace.yaml',
        pointer: '/documents/0',
        line: 4,
        column: 5,
      })
    } finally {
      rmSync(directory, { recursive: true })
      rmSync(outside, { force: true })
    }
  })

  it('resolves the repository manifest as a deterministic typed source set', () => {
    const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))
    const result = loadWorkspaceManifest(
      {
        path: 'yarramate.workspace.yaml',
        source: readFileSync(
          join(repositoryRoot, 'yarramate.workspace.yaml'),
          'utf8',
        ),
      },
      repositoryRoot,
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.workspace).toEqual({
      id: 'yarramate',
      documents: [
        'architecture/engine.yaml',
        'architecture/product.yaml',
        'architecture/repository.yaml',
      ],
      profiles: ['profiles/yarramate-development.yaml'],
      projections: [
        'projections/current-engine.yaml',
        'projections/implementation-traceability.yaml',
        'projections/likec4-export-path.yaml',
        'projections/maintainer-tool-neutral-engine.yaml',
        'projections/product-context.yaml',
      ],
      adapterMappings: [
        'adapters/likec4-export-path.mapping.yaml',
      ],
      evidence: ['evidence/repository.yaml'],
    })
  })
})
