import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repositoryRoot = resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '..',
)

interface MarketplaceManifest {
  readonly name: string
  readonly description?: string
  readonly owner: { readonly name: string; readonly url?: string }
  readonly plugins: readonly {
    readonly name: string
    readonly source: string
    readonly description?: string
    readonly version?: string
  }[]
}

const manifest = JSON.parse(
  readFileSync(
    join(repositoryRoot, '.claude-plugin/marketplace.json'),
    'utf8',
  ),
) as MarketplaceManifest

const frontmatter = (source: string): Record<string, string> => {
  const match = /^---\n([\s\S]*?)\n---/.exec(source)
  if (match === null) return {}
  const entries = match[1]!.split('\n').flatMap((line) => {
    const separator = line.indexOf(':')
    return separator <= 0
      ? []
      : [
          [
            line.slice(0, separator).trim(),
            line.slice(separator + 1).trim(),
          ] as const,
        ]
  })
  return Object.fromEntries(entries)
}

describe('plugin marketplace manifest', () => {
  it('declares a collision-safe marketplace identity', () => {
    expect(manifest.name).toBe('yarramate')
    expect(manifest.name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
    expect(manifest.description).toBeTruthy()
    expect(manifest.owner.name).toBeTruthy()
  })

  it('offers the canonical skill as its only plugin', () => {
    expect(manifest.plugins).toHaveLength(1)
    const plugin = manifest.plugins[0]!
    expect(plugin.name).toBe('yarramate-architecture')
    expect(plugin.source).toBe('./skills/yarramate-architecture')
  })

  it('resolves every plugin source to a directory holding a skill', () => {
    for (const plugin of manifest.plugins) {
      const directory = resolve(repositoryRoot, plugin.source)
      expect(existsSync(directory), `${plugin.source} exists`).toBe(true)
      expect(
        existsSync(join(directory, 'SKILL.md')),
        `${plugin.source}/SKILL.md exists`,
      ).toBe(true)
    }
  })

  it('keeps the plugin entry consistent with the skill it points at', () => {
    const plugin = manifest.plugins[0]!
    const skill = frontmatter(
      readFileSync(
        resolve(repositoryRoot, plugin.source, 'SKILL.md'),
        'utf8',
      ),
    )
    expect(skill.name).toBe(plugin.name)
    // The listing is browse copy for a human; the skill description is the
    // trigger text a model matches against, so the listing may be shorter.
    // Requiring it to open the skill description keeps it a faithful
    // summary that cannot contradict what gets installed.
    expect(plugin.description).toBeTruthy()
    expect(skill.description).toMatch(
      new RegExp(
        `^${plugin.description!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
      ),
    )
  })

  it('ships the plugin source inside the published package', () => {
    const packageManifest = JSON.parse(
      readFileSync(join(repositoryRoot, 'package.json'), 'utf8'),
    ) as { readonly files: readonly string[] }
    for (const plugin of manifest.plugins) {
      const packaged = plugin.source.replace(/^\.\//, '')
      expect(packageManifest.files).toContain(packaged)
    }
  })

  it('carries no hand-maintained version to drift from the release', () => {
    // Omitting version lets the marketplace auto-version by commit, so the
    // manifest cannot go stale the way a duplicated constant would.
    for (const plugin of manifest.plugins) {
      expect(plugin.version).toBeUndefined()
    }
  })
})
