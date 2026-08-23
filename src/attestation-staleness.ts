import { spawnSync } from 'node:child_process'
import { isMap, isScalar, isSeq, parseDocument, type YAMLMap } from 'yaml'
import { changedLineRanges, lineOfOffset } from './changed.js'
import type {
  AttestationStaleness,
  StaleAttestationFinding,
} from './reconciliation.js'

// Attestation staleness derives from git (ADR 0074): an attestation
// accepts a subject as stated on a date, so the sign-off goes stale the
// moment the attested wording changes in a commit after that date. Git
// stays authoritative for when the wording changed; the engine only maps
// diff hunks back to the name and description spans (v1 granularity).
// When git cannot answer honestly (no repository, shallow history, an
// untracked file, or history that starts after the sign-off) the check
// degrades to a note instead of guessing.

interface WordingSpan {
  readonly field: 'name' | 'description'
  readonly startLine: number
  readonly endLine: number
}

interface AttestedConcept {
  readonly qualifiedId: string
  readonly spans: readonly WordingSpan[]
  readonly attestations: ReadonlyArray<{
    readonly topic: string
    readonly by: string
    readonly on: string
  }>
}

const attestedConcepts = (
  source: string,
  documentId: string,
): readonly AttestedConcept[] => {
  const lineStarts: number[] = [0]
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === '\n') lineStarts.push(index + 1)
  }
  const document = parseDocument(source)
  const root = document.contents
  if (!isMap(root)) return []
  const conceptsPair = root.items.find(
    (candidate) => isScalar(candidate.key) && candidate.key.value === 'concepts',
  )
  if (conceptsPair === undefined || !isSeq(conceptsPair.value)) return []
  const concepts: AttestedConcept[] = []
  for (const item of conceptsPair.value.items) {
    if (!isMap(item)) continue
    const concept = item as YAMLMap
    const stringField = (name: string): string | undefined => {
      const pair = concept.items.find(
        (field) => isScalar(field.key) && field.key.value === name,
      )
      return pair !== undefined &&
        isScalar(pair.value) &&
        typeof pair.value.value === 'string'
        ? pair.value.value
        : undefined
    }
    const id = stringField('id')
    if (id === undefined) continue
    const attestationsPair = concept.items.find(
      (field) => isScalar(field.key) && field.key.value === 'attestations',
    )
    if (attestationsPair === undefined || !isSeq(attestationsPair.value)) {
      continue
    }
    const attestations: Array<{ topic: string; by: string; on: string }> = []
    for (const attestationItem of attestationsPair.value.items) {
      if (!isMap(attestationItem)) continue
      const record: Record<string, string> = {}
      for (const field of (attestationItem as YAMLMap).items) {
        if (
          isScalar(field.key) &&
          typeof field.key.value === 'string' &&
          isScalar(field.value) &&
          typeof field.value.value === 'string'
        ) {
          record[field.key.value] = field.value.value
        }
      }
      const { topic, by, on } = record
      if (topic !== undefined && by !== undefined && on !== undefined) {
        // The authority is a reference; report it in the same qualified form
        // the compiler resolves, so one sign-off reads identically in a
        // staleness finding, a reconcile finding, and the RTM.
        attestations.push({
          topic,
          by,
          on,
        })
      }
    }
    if (attestations.length === 0) continue
    const spans: WordingSpan[] = []
    for (const field of ['name', 'description'] as const) {
      const pair = concept.items.find(
        (candidate) =>
          isScalar(candidate.key) && candidate.key.value === field,
      )
      if (pair === undefined) continue
      const keyRange = (
        pair.key as { range?: readonly [number, number, number] }
      ).range
      const valueRange = (
        pair.value as { range?: readonly [number, number, number] } | null
      )?.range
      if (keyRange === undefined || valueRange === undefined) continue
      spans.push({
        field,
        startLine: lineOfOffset(lineStarts, keyRange[0]),
        // range[1] can extend past the trailing newline; anchor the end
        // on the last content character instead.
        endLine: lineOfOffset(
          lineStarts,
          Math.max(keyRange[0], valueRange[1] - 1),
        ),
      })
    }
    if (spans.length === 0) continue
    concepts.push({
      qualifiedId: id,
      spans,
      attestations,
    })
  }
  return concepts
}

const runGit = (cwd: string, args: readonly string[]) =>
  spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' })

interface Commit {
  readonly sha: string
  readonly iso: string
  readonly epoch: number
}

const commitsTouching = (cwd: string, path: string): readonly Commit[] => {
  const log = runGit(cwd, ['log', '--format=%H %cI', '--', path])
  if (log.status !== 0) return []
  const commits: Commit[] = []
  for (const line of (log.stdout ?? '').split('\n')) {
    const [sha, iso] = line.trim().split(' ')
    if (sha === undefined || sha === '' || iso === undefined) continue
    const epoch = Date.parse(iso)
    if (Number.isNaN(epoch)) continue
    commits.push({ sha, iso, epoch })
  }
  return commits
}

// The comparison rule (ADR 0074): an attestation dated `on` covers every
// commit up to the end of that calendar day in UTC. A change is "after
// the sign-off" exactly when its committer timestamp is strictly after
// 23:59:59.999 UTC on the `on` day, i.e. at or past midnight UTC of the
// following day.
const endOfAttestationDayUtc = (on: string): number => {
  const [year, month, day] = on.split('-').map(Number)
  return Date.UTC(year ?? 0, (month ?? 1) - 1, (day ?? 1) + 1)
}

const intersects = (
  touched: ReadonlyArray<readonly [number, number]>,
  spans: readonly WordingSpan[],
): readonly WordingSpan[] =>
  spans.filter((span) =>
    touched.some(([from, to]) => from <= span.endLine && to >= span.startLine),
  )

const describeFields = (spans: readonly WordingSpan[]): string =>
  [...new Set(spans.map(({ field }) => field))].sort().join(' and ')

export function deriveAttestationStaleness(
  cwd: string,
  documents: ReadonlyArray<{
    readonly path: string
    readonly source: string
    readonly documentId: string
  }>,
): AttestationStaleness {
  const findings: StaleAttestationFinding[] = []
  const notes: string[] = []
  const finish = (): AttestationStaleness => ({
    findings: [...findings].sort(
      (left, right) =>
        left.target.id.localeCompare(right.target.id) ||
        left.attestation.topic.localeCompare(right.attestation.topic),
    ),
    notes: [...notes].sort((left, right) => left.localeCompare(right)),
  })
  const withAttestations = documents
    .map((document) => ({
      document,
      concepts: attestedConcepts(document.source, document.documentId),
    }))
    .filter(({ concepts }) => concepts.length > 0)
  if (withAttestations.length === 0) return finish()
  const probe = runGit(cwd, ['rev-parse', '--git-dir'])
  if (probe.status !== 0) {
    notes.push(
      'Attestation staleness was not assessed: the workspace is not inside a git repository.',
    )
    return finish()
  }
  const shallow = runGit(cwd, ['rev-parse', '--is-shallow-repository'])
  if ((shallow.stdout ?? '').trim() === 'true') {
    notes.push(
      'Attestation staleness was not assessed: the git history is shallow; fetch the full history to assess it.',
    )
    return finish()
  }
  for (const { document, concepts } of withAttestations) {
    const commits = commitsTouching(cwd, document.path)
    if (commits.length === 0) {
      notes.push(
        `Attestation staleness was not assessed for ${document.path}: the file has no committed history.`,
      )
      continue
    }
    // Diff hunks between a commit and the working tree carry new-side
    // line numbers, so they intersect directly with the spans the
    // wording occupies today (the changed.ts idiom, ADR 0065).
    const touchedSince = new Map<
      string,
      ReadonlyArray<readonly [number, number]> | undefined
    >()
    const rangesSince = (sha: string) => {
      if (!touchedSince.has(sha)) {
        const diffed = runGit(cwd, [
          'diff',
          '--unified=0',
          sha,
          '--',
          document.path,
        ])
        touchedSince.set(
          sha,
          diffed.status === 0
            ? changedLineRanges(diffed.stdout ?? '').touched
            : undefined,
        )
      }
      return touchedSince.get(sha)
    }
    for (const concept of concepts) {
      for (const attestation of concept.attestations) {
        const cutoff = endOfAttestationDayUtc(attestation.on)
        const base = commits.find(({ epoch }) => epoch < cutoff)
        if (base === undefined) {
          notes.push(
            `Attestation "${attestation.topic}" on ${concept.qualifiedId} predates the earliest committed history of ${document.path}; staleness was not assessed.`,
          )
          continue
        }
        const baseRanges = rangesSince(base.sha)
        if (baseRanges === undefined) {
          notes.push(
            `Attestation staleness was not assessed for ${document.path}: git diff against ${base.sha} failed.`,
          )
          continue
        }
        const staleSpans = intersects(baseRanges, concept.spans)
        if (staleSpans.length === 0) continue
        const later = commits
          .filter(({ epoch }) => epoch >= cutoff)
          .reverse()
        const introduced = later.find((commit) => {
          const ranges = rangesSince(commit.sha)
          return (
            ranges !== undefined && intersects(ranges, staleSpans).length === 0
          )
        })
        const fields = describeFields(staleSpans)
        const heading =
          `Attestation "${attestation.topic}" by ${attestation.by} on ` +
          `${attestation.on} predates the current wording of ` +
          `${concept.qualifiedId}`
        findings.push({
          target: { type: 'subject', id: concept.qualifiedId },
          result: 'stale-attestation',
          attestation,
          provider: 'git',
          ...(introduced === undefined ? {} : { changedAt: introduced.iso }),
          evidence:
            introduced === undefined
              ? {
                  uri: 'git:worktree',
                  message: `${heading}: the ${fields} changed in uncommitted working tree edits.`,
                }
              : {
                  uri: `git:${introduced.sha}`,
                  message: `${heading}: the ${fields} changed in commit ${introduced.sha.slice(0, 7)} on ${introduced.iso}.`,
                },
        })
      }
    }
  }
  return finish()
}
