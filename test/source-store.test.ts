import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createFileSystemStore } from '../src/source-store.js'

describe('filesystem source store', () => {
  let parent: string
  let root: string

  const write = (path: string, source: string) => {
    const absolute = join(root, path)
    mkdirSync(join(absolute, '..'), { recursive: true })
    writeFileSync(absolute, source, 'utf8')
  }

  beforeEach(() => {
    parent = mkdtempSync(join(tmpdir(), 'yarramate-source-store-'))
    root = join(parent, 'workspace')
    mkdirSync(root, { recursive: true })
  })

  afterEach(() => {
    rmSync(parent, { recursive: true, force: true })
  })

  describe('list', () => {
    it('names every file beneath the root, separated by slashes', () => {
      write('workspace.yaml', 'a\n')
      write('architecture/engine.yaml', 'b\n')
      write('projections/one.yaml', 'c\n')

      expect(createFileSystemStore(root).list()).toEqual([
        'architecture/engine.yaml',
        'projections/one.yaml',
        'workspace.yaml',
      ])
    })

    it('does not follow a link that leaves the root', () => {
      write('inside.yaml', 'a\n')
      writeFileSync(join(parent, 'outside.yaml'), 'b\n')
      symlinkSync(join(parent, 'outside.yaml'), join(root, 'linked.yaml'))

      expect(createFileSystemStore(root).list()).toEqual(['inside.yaml'])
    })

    it('is empty for a root that does not exist', () => {
      expect(createFileSystemStore(join(parent, 'absent')).list()).toEqual([])
    })
  })

  describe('read', () => {
    it('returns the bytes and a revision that follows them', () => {
      write('a.yaml', 'first\n')
      const store = createFileSystemStore(root)

      const before = store.read('a.yaml')
      expect(before?.source).toBe('first\n')

      write('a.yaml', 'second\n')
      const after = store.read('a.yaml')

      expect(after?.source).toBe('second\n')
      expect(after?.revision).not.toBe(before?.revision)
    })

    it('gives one revision to identical bytes', () => {
      write('a.yaml', 'same\n')
      write('b.yaml', 'same\n')
      const store = createFileSystemStore(root)

      expect(store.read('a.yaml')?.revision).toBe(
        store.read('b.yaml')?.revision,
      )
    })

    it('is undefined for what is not there, and for what is outside', () => {
      writeFileSync(join(parent, 'outside.yaml'), 'b\n')
      const store = createFileSystemStore(root)

      expect(store.read('absent.yaml')).toBeUndefined()
      expect(store.read('../outside.yaml')).toBeUndefined()
    })
  })

  describe('writeAll', () => {
    it('writes every document when every expectation holds', () => {
      write('a.yaml', 'one\n')
      write('b.yaml', 'two\n')
      const store = createFileSystemStore(root)
      const a = store.read('a.yaml')!
      const b = store.read('b.yaml')!

      const outcome = store.writeAll([
        { path: 'a.yaml', source: 'one changed\n', expected: a.revision },
        { path: 'b.yaml', source: 'two changed\n', expected: b.revision },
      ])

      expect(outcome.ok).toBe(true)
      expect(readFileSync(join(root, 'a.yaml'), 'utf8')).toBe('one changed\n')
      expect(readFileSync(join(root, 'b.yaml'), 'utf8')).toBe('two changed\n')
    })

    it('refuses the batch and writes nothing when one document moved', () => {
      write('a.yaml', 'one\n')
      write('b.yaml', 'two\n')
      const store = createFileSystemStore(root)
      const a = store.read('a.yaml')!
      const b = store.read('b.yaml')!

      // Someone else lands a write to the second document after both were read.
      write('b.yaml', 'landed elsewhere\n')

      const outcome = store.writeAll([
        { path: 'a.yaml', source: 'one changed\n', expected: a.revision },
        { path: 'b.yaml', source: 'two changed\n', expected: b.revision },
      ])

      expect(outcome).toEqual({
        ok: false,
        conflicts: [{ path: 'b.yaml', reason: 'changed' }],
      })
      // The point of checking everything first: the document that was still
      // current is not left rewritten by a batch that did not land.
      expect(readFileSync(join(root, 'a.yaml'), 'utf8')).toBe('one\n')
      expect(readFileSync(join(root, 'b.yaml'), 'utf8')).toBe(
        'landed elsewhere\n',
      )
    })

    it('reports every conflict, not only the first', () => {
      write('a.yaml', 'one\n')
      write('b.yaml', 'two\n')
      const store = createFileSystemStore(root)
      const stale = store.read('a.yaml')!.revision
      write('a.yaml', 'moved\n')
      write('b.yaml', 'moved\n')

      const outcome = store.writeAll([
        { path: 'a.yaml', source: 'x\n', expected: stale },
        { path: 'b.yaml', source: 'y\n', expected: stale },
      ])

      expect(outcome.ok).toBe(false)
      if (outcome.ok) return
      expect(outcome.conflicts.map((conflict) => conflict.path)).toEqual([
        'a.yaml',
        'b.yaml',
      ])
    })

    it('creates a document that was expected not to exist', () => {
      const store = createFileSystemStore(root)

      const outcome = store.writeAll([
        { path: 'architecture/new.yaml', source: 'fresh\n', expected: null },
      ])

      expect(outcome.ok).toBe(true)
      expect(readFileSync(join(root, 'architecture/new.yaml'), 'utf8')).toBe(
        'fresh\n',
      )
    })

    it('refuses to create over something already there', () => {
      write('a.yaml', 'occupied\n')
      const store = createFileSystemStore(root)

      const outcome = store.writeAll([
        { path: 'a.yaml', source: 'fresh\n', expected: null },
      ])

      expect(outcome).toEqual({
        ok: false,
        conflicts: [{ path: 'a.yaml', reason: 'exists' }],
      })
      expect(readFileSync(join(root, 'a.yaml'), 'utf8')).toBe('occupied\n')
    })

    it('refuses to update something that has gone', () => {
      write('a.yaml', 'here\n')
      const store = createFileSystemStore(root)
      const a = store.read('a.yaml')!
      rmSync(join(root, 'a.yaml'))

      const outcome = store.writeAll([
        { path: 'a.yaml', source: 'x\n', expected: a.revision },
      ])

      expect(outcome).toEqual({
        ok: false,
        conflicts: [{ path: 'a.yaml', reason: 'missing' }],
      })
    })

    it('refuses a path that would leave the root', () => {
      writeFileSync(join(parent, 'outside.yaml'), 'safe\n')
      const store = createFileSystemStore(root)

      const outcome = store.writeAll([
        { path: '../outside.yaml', source: 'reached\n', expected: null },
      ])

      expect(outcome.ok).toBe(false)
      expect(readFileSync(join(parent, 'outside.yaml'), 'utf8')).toBe('safe\n')
    })

    it('returns revisions a later write can be made against', () => {
      write('a.yaml', 'one\n')
      const store = createFileSystemStore(root)
      const first = store.writeAll([
        { path: 'a.yaml', source: 'two\n', expected: store.read('a.yaml')!.revision },
      ])

      expect(first.ok).toBe(true)
      if (!first.ok) return
      const second = store.writeAll([
        { path: 'a.yaml', source: 'three\n', expected: first.revisions.get('a.yaml')! },
      ])

      expect(second.ok).toBe(true)
      expect(readFileSync(join(root, 'a.yaml'), 'utf8')).toBe('three\n')
    })

    it('leaves no staging file behind', () => {
      write('a.yaml', 'one\n')
      const store = createFileSystemStore(root)
      store.writeAll([
        { path: 'a.yaml', source: 'two\n', expected: store.read('a.yaml')!.revision },
      ])

      expect(readdirSync(root)).toEqual(['a.yaml'])
    })
  })
})
