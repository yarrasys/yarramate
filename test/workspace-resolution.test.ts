import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { loadWorkspaceManifest } from '../src/workspace.js'
import {
  patternToRegExp,
  resolveWorkspaceFrom,
} from '../src/workspace-resolution.js'

const repositoryRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')

const listFiles = (root: string): readonly string[] => {
  const found: string[] = []
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory)) {
      const absolute = join(directory, entry)
      if (statSync(absolute).isDirectory()) walk(absolute)
      else found.push(relative(root, absolute).split(sep).join('/'))
    }
  }
  walk(root)
  return found.sort()
}

const manifest = (body: string) => ({
  path: '.yarramate/workspace.yaml',
  source: `format: yarramate/workspace/v1\nid: fixture\n${body}`,
})

describe('resolveWorkspaceFrom', () => {
  it('resolves the repository manifest from a file list exactly as the filesystem loader does', () => {
    const path = '.yarramate/workspace.yaml'
    const source = readFileSync(resolve(repositoryRoot, path), 'utf8')
    const fromDisk = loadWorkspaceManifest({ path, source }, repositoryRoot)
    const fromList = resolveWorkspaceFrom(
      { path, source },
      listFiles(resolve(repositoryRoot, '.yarramate')).map(
        (file) => `.yarramate/${file}`,
      ),
    )
    expect(fromDisk.ok).toBe(true)
    expect(fromList).toEqual(fromDisk)
  })

  it('roots patterns at the manifest and answers store paths', () => {
    const resolved = resolveWorkspaceFrom(
      manifest(
        'documents:\n  - architecture/*.yaml\nprofiles: []\nprojections:\n  - projections/**/*.yaml\nadapterMappings: []\n',
      ),
      [
        '.yarramate/workspace.yaml',
        '.yarramate/architecture/main.yaml',
        '.yarramate/architecture/notes.md',
        '.yarramate/projections/landscape.yaml',
        '.yarramate/projections/deep/inside.yaml',
        'README.md',
        'other/.yarramate/architecture/elsewhere.yaml',
      ],
    )
    expect(resolved).toMatchObject({
      ok: true,
      workspace: {
        id: 'fixture',
        documents: ['.yarramate/architecture/main.yaml'],
        projections: [
          '.yarramate/projections/deep/inside.yaml',
          '.yarramate/projections/landscape.yaml',
        ],
        profiles: [],
        patterns: [],
        questions: [],
        evidence: [],
        contracts: [],
      },
    })
  })

  it('reports YM702 for a pattern matching nothing and YM703 for a file in two categories', () => {
    const nothing = resolveWorkspaceFrom(
      manifest(
        'documents:\n  - architecture/*.yaml\nprofiles:\n  - profiles/*.yaml\nprojections: []\nadapterMappings: []\n',
      ),
      ['.yarramate/architecture/main.yaml'],
    )
    expect(nothing.ok).toBe(false)
    if (!nothing.ok) {
      expect(nothing.diagnostics.map(({ code, pointer }) => [code, pointer])).toEqual([
        ['YM702', '/profiles/0'],
      ])
    }
    const twice = resolveWorkspaceFrom(
      manifest(
        'documents:\n  - architecture/*.yaml\nprofiles:\n  - architecture/main.yaml\nprojections: []\nadapterMappings: []\n',
      ),
      ['.yarramate/architecture/main.yaml'],
    )
    expect(twice.ok).toBe(false)
    if (!twice.ok) {
      expect(twice.diagnostics.map(({ code }) => code)).toEqual(['YM703'])
    }
  })

  it('refuses a pattern that leaves the manifest directory, on sight', () => {
    const escaped = resolveWorkspaceFrom(
      manifest(
        'documents:\n  - ../src/*.ts\nprofiles: []\nprojections: []\nadapterMappings: []\n',
      ),
      ['src/index.ts'],
    )
    expect(escaped.ok).toBe(false)
    if (!escaped.ok) {
      expect(escaped.diagnostics.map(({ code }) => code)).toEqual(['YM701'])
    }
  })

  it('matches the pattern shapes a manifest writes', () => {
    const matches = (pattern: string, path: string) =>
      patternToRegExp(pattern).test(path)
    expect(matches('architecture/*.yaml', 'architecture/main.yaml')).toBe(true)
    expect(matches('architecture/*.yaml', 'architecture/deep/main.yaml')).toBe(false)
    expect(matches('**/*.yaml', 'a/b/c.yaml')).toBe(true)
    expect(matches('**/*.yaml', 'c.yaml')).toBe(true)
    expect(matches('docs/**', 'docs/a/b.md')).toBe(true)
    expect(matches('profiles/{core,water}.yaml', 'profiles/water.yaml')).toBe(true)
    expect(matches('profiles/{core,water}.yaml', 'profiles/fire.yaml')).toBe(false)
    expect(matches('q?.yaml', 'q1.yaml')).toBe(true)
    expect(matches('q?.yaml', 'q10.yaml')).toBe(false)
    expect(matches('[ab]*.yaml', 'b-side.yaml')).toBe(true)
    expect(matches('main.yaml', 'main.yaml')).toBe(true)
    expect(matches('main.yaml', 'main.yaml.bak')).toBe(false)
  })
})
