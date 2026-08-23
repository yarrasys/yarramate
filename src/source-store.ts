import { createHash } from 'node:crypto'
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname, join, relative, resolve, sep } from 'node:path'

/**
 * Where a workspace's sources come from and where they go back to
 * (ADR 0100).
 *
 * Core is a pure function from sources to sources and never holds one of
 * these: a caller lists, reads, calls the pure function, and writes what it
 * returns. That is what lets the same engine serve a filesystem, an object
 * store and a database row without knowing which it is.
 */
export interface SourceStore {
  /**
   * Every path this store holds, for a manifest's patterns to match against.
   * Relative to the store's root and separated by `/` whatever the platform
   * writes, because a manifest's patterns are written that way.
   */
  list(): readonly string[]
  /** The bytes, and an opaque statement of which bytes they are. */
  read(path: string): StoredSource | undefined
  /**
   * All of them or none, each only if it still holds what was read. A write
   * with a `null` source removes the document instead of replacing it
   * (ADR 0103), under the same condition and in the same batch.
   */
  writeAll(writes: readonly PendingWrite[]): WriteOutcome
}

export interface StoredSource {
  readonly source: string
  /**
   * Opaque outside the store that minted it. A filesystem store may use a
   * content hash, S3 an ETag, git a blob sha, D1 a rowversion. Nothing parses
   * one, orders two, or asks what it means; the only operation is equality,
   * performed by the store that issued it.
   */
  readonly revision: string
}

export interface PendingWrite {
  readonly path: string
  /**
   * The bytes to leave behind, or `null` to remove the document (ADR 0103).
   *
   * Removal is a write like any other: it lands in the same all-or-none batch,
   * under the same compare-and-swap, so a view deleted beside a subject edit
   * either takes both or neither. A store with nothing to remove things from
   * is a store that cannot express a workspace shrinking, and the alternative -
   * a second call outside the batch - is exactly the unconditional write the
   * `expected` field exists to refuse.
   */
  readonly source: string | null
  /**
   * The revision this edit was made against, or `null` to require that the
   * document does not exist yet. There is no way to write unconditionally:
   * a caller with nothing to state is a caller that cannot detect a conflict.
   *
   * A removal must name a revision. `null` here would ask to remove something
   * on condition it is not there, which is not a thing to want.
   */
  readonly expected: string | null
}

export type WriteConflict =
  /** Someone else wrote it after this edit was made. */
  | { readonly path: string; readonly reason: 'changed' }
  /**
   * Expected to be new, but something is already there - or a removal that
   * named no revision, which asks to remove a document on condition it does
   * not exist. Both are a caller stating something the store cannot satisfy.
   */
  | { readonly path: string; readonly reason: 'exists' }
  /** Expected to be there, and is not. */
  | { readonly path: string; readonly reason: 'missing' }

export type WriteOutcome =
  | { readonly ok: true; readonly revisions: ReadonlyMap<string, string> }
  | { readonly ok: false; readonly conflicts: readonly WriteConflict[] }

const digest = (source: string): string =>
  createHash('sha256').update(source, 'utf8').digest('hex')

const toPosix = (path: string): string =>
  sep === '/' ? path : path.split(sep).join('/')

/**
 * A store over a directory, which is the manifest's own directory: a
 * workspace's patterns are confined beneath it already (`YM701`), so listing
 * everything under it enumerates the workspace and nothing else.
 *
 * Confinement is enforced here rather than in Core. `realpath` is a filesystem
 * concept, and a store with no symlinks must not be asked to pretend it has
 * them.
 */
export const createFileSystemStore = (root: string): SourceStore => {
  const base = (() => {
    const requested = resolve(root)
    try {
      // Resolved once, through the root's own links, so every later
      // comparison has both sides in the same terms. Without this a platform
      // that symlinks a parent of the root - macOS points /var at
      // /private/var - makes every path under it look like an escape.
      return realpathSync(requested)
    } catch {
      return requested
    }
  })()

  const withinBase = (candidate: string): boolean =>
    candidate === base || candidate.startsWith(`${base}${sep}`)

  // Resolves a store path to an absolute one, refusing anything that would
  // leave the root. A path is a store address, not a filesystem path, so a
  // caller that builds one from a document id cannot reach outside by saying
  // so.
  const absoluteOf = (path: string): string => {
    const absolute = resolve(base, path)
    if (!withinBase(absolute)) {
      throw new Error(`Path escapes the workspace root: ${path}`)
    }
    return absolute
  }

  const revisionOf = (absolute: string): string | undefined => {
    try {
      return digest(readFileSync(absolute, 'utf8'))
    } catch {
      return undefined
    }
  }

  return {
    list: () => {
      const found: string[] = []
      const walk = (directory: string): void => {
        let entries
        try {
          entries = readdirSync(directory, { withFileTypes: true })
        } catch {
          return
        }
        for (const entry of entries) {
          const absolute = join(directory, entry.name)
          // A symlink is followed only where it lands inside the root, so a
          // link out of the workspace neither lists nor reads.
          let real
          try {
            real = realpathSync(absolute)
          } catch {
            continue
          }
          if (!withinBase(real)) continue
          let stat
          try {
            stat = statSync(absolute)
          } catch {
            continue
          }
          if (stat.isDirectory()) walk(absolute)
          else if (stat.isFile()) found.push(toPosix(relative(base, absolute)))
        }
      }
      walk(base)
      return found.sort()
    },

    read: (path) => {
      let absolute
      try {
        absolute = absoluteOf(path)
      } catch {
        return undefined
      }
      let source
      try {
        source = readFileSync(absolute, 'utf8')
      } catch {
        return undefined
      }
      return { source, revision: digest(source) }
    },

    writeAll: (writes) => {
      const conflicts: WriteConflict[] = []
      const resolved = new Map<string, string>()
      for (const write of writes) {
        let absolute
        try {
          absolute = absoluteOf(write.path)
        } catch {
          conflicts.push({ path: write.path, reason: 'missing' })
          continue
        }
        resolved.set(write.path, absolute)
        const held = revisionOf(absolute)
        if (write.expected === null) {
          // A removal on condition the document is not there is not a thing to
          // want, and treating it as a no-op would let a caller delete by
          // accident and be told it worked.
          if (write.source === null || held !== undefined) {
            conflicts.push({ path: write.path, reason: 'exists' })
          }
          continue
        }
        if (held === undefined) {
          conflicts.push({ path: write.path, reason: 'missing' })
          continue
        }
        if (held !== write.expected) {
          conflicts.push({ path: write.path, reason: 'changed' })
        }
      }
      // Every expectation is checked before any byte moves, so a batch whose
      // last document is stale does not leave its first one rewritten.
      if (conflicts.length > 0) return { ok: false, conflicts }

      const revisions = new Map<string, string>()
      for (const write of writes) {
        const absolute = resolved.get(write.path)!
        if (write.source === null) {
          // Nothing is staged and renamed: there are no bytes to land whole,
          // and the directory is left behind because an empty one is not
          // something a workspace can tell from a directory it never had.
          rmSync(absolute, { force: true })
          continue
        }
        mkdirSync(dirname(absolute), { recursive: true })
        // Each file lands whole: a reader sees the old bytes or the new ones,
        // never a half-written document. The batch as a whole is not atomic on
        // a filesystem, which ADR 0100 states rather than hides.
        const staged = `${absolute}.yarramate-${randomUUID()}.tmp`
        try {
          writeFileSync(staged, write.source, 'utf8')
          renameSync(staged, absolute)
        } catch (error) {
          rmSync(staged, { force: true })
          throw error
        }
        revisions.set(write.path, digest(write.source))
      }
      return { ok: true, revisions }
    },
  }
}
