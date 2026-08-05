// Deterministic near-duplicate subject detection (ADR 0077).
//
// The engine never reads words to judge quality (ADR 0056). This module
// does not break that rule: it does not assess whether a name is good, it
// asks whether two names are mechanically the same string after a stated
// normalization. The output is a hygiene question a human answers, never a
// `check` error, and every step below is pure, ordered, and reproducible on
// any machine. No embeddings, no model, no network.

// Type tokens name what a subject *is* rather than what it is *about*.
// `order-gateway` and `orders-service` disagree on every raw token yet name
// one subject; stripping the type noun is what makes that visible. The list
// is deliberately closed, short, and confined to deployment and application
// nouns: domain words an architecture actually reasons about (actor,
// process, contract, product) are never stripped. Entries are singular
// because normalization singularizes first.
const typeTokens: ReadonlySet<string> = new Set([
  'adapter',
  'api',
  'app',
  'application',
  'bus',
  'cache',
  'component',
  'connector',
  'daemon',
  'database',
  'db',
  'endpoint',
  'engine',
  'gateway',
  'module',
  'platform',
  'proxy',
  'queue',
  'server',
  'service',
  'srv',
  'store',
  'svc',
  'system',
  'worker',
])

// A crude, symmetric stemmer. It is wrong about English often enough that
// calling it a stemmer flatters it ("status" becomes "statu"), but it is
// wrong *identically* on both sides of every comparison, which is the only
// property a similarity signal needs. Correct English morphology would add
// a dictionary, and a dictionary is state that has to be versioned.
const singularize = (token: string): string => {
  if (token.length < 4) return token
  if (token.endsWith('ies')) return `${token.slice(0, -3)}y`
  if (
    token.endsWith('sses') ||
    token.endsWith('shes') ||
    token.endsWith('ches') ||
    token.endsWith('xes') ||
    token.endsWith('zes')
  ) {
    return token.slice(0, -2)
  }
  if (token.endsWith('ss')) return token
  if (token.endsWith('s')) return token.slice(0, -1)
  return token
}

// Split on case boundaries, then on everything that is not alphanumeric.
// `OrderGateway`, `order-gateway`, `order_gateway` and `Order Gateway` all
// normalize to the same token list.
export const normalizeLabel = (label: string): readonly string[] =>
  label
    .replaceAll(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 0)
    .map(singularize)

// Removing every token would erase a subject genuinely called "Gateway", so
// a label that is nothing but type nouns keeps them.
export const headTokens = (tokens: readonly string[]): readonly string[] => {
  const head = tokens.filter((token) => !typeTokens.has(token))
  return head.length === 0 ? tokens : head
}

const levenshtein = (left: string, right: string): number => {
  if (left === right) return 0
  if (left.length === 0) return right.length
  if (right.length === 0) return left.length
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let i = 0; i < left.length; i += 1) {
    const current = [i + 1]
    for (let j = 0; j < right.length; j += 1) {
      current.push(
        Math.min(
          previous[j + 1]! + 1,
          current[j]! + 1,
          previous[j]! + (left[i] === right[j] ? 0 : 1),
        ),
      )
    }
    previous = current
  }
  return previous[right.length]!
}

// Edit distance normalized by the longer string: 1 is identical, 0 shares
// nothing.
export const similarity = (left: string, right: string): number => {
  const longest = Math.max(left.length, right.length)
  return longest === 0 ? 0 : 1 - levenshtein(left, right) / longest
}

const jaccard = (
  left: ReadonlySet<string>,
  right: ReadonlySet<string>,
): number => {
  if (left.size === 0 || right.size === 0) return 0
  let shared = 0
  for (const token of left) if (right.has(token)) shared += 1
  return shared / (left.size + right.size - shared)
}

export interface IdentitySubject {
  readonly id: string
  readonly kind: string
  // The local id, the display name, and every declared alias. Aliases are
  // matched at the same weight as the name (ADR 0076): an alias exists
  // precisely to be an alternative way in, and ranking it below the name
  // would defeat the reason it was recorded.
  readonly labels: readonly string[]
  readonly owner?: string
  readonly neighbours: ReadonlySet<string>
  readonly distinctFrom: ReadonlySet<string>
}

export interface NearDuplicatePair {
  readonly left: string
  readonly right: string
  readonly score: number
  readonly corroboration: 'lexical' | 'owner' | 'neighbourhood'
}

// A pair whose head labels are effectively the same string is worth one
// question with no further evidence. Below that, lexical resemblance alone
// is too noisy to spend a human's attention on, so a structural signal must
// agree before the question opens.
export const strongLexicalThreshold = 0.95
export const moderateLexicalThreshold = 0.8

const labelScore = (left: string, right: string): number => {
  const leftHead = headTokens(normalizeLabel(left))
  const rightHead = headTokens(normalizeLabel(right))
  if (leftHead.length === 0 || rightHead.length === 0) return 0
  return Math.max(
    jaccard(new Set(leftHead), new Set(rightHead)),
    similarity(leftHead.join(' '), rightHead.join(' ')),
  )
}

// The best matching pair of labels decides, because any one alias matching
// is the match the alias was recorded for.
export const lexicalScore = (
  left: IdentitySubject,
  right: IdentitySubject,
): number => {
  let best = 0
  for (const leftLabel of left.labels) {
    for (const rightLabel of right.labels) {
      best = Math.max(best, labelScore(leftLabel, rightLabel))
      if (best === 1) return 1
    }
  }
  return best
}

const shareNeighbour = (
  left: IdentitySubject,
  right: IdentitySubject,
): boolean => {
  for (const neighbour of left.neighbours) {
    if (right.neighbours.has(neighbour)) return true
  }
  return false
}

// Distinctness is read symmetrically: the pair is the subject of the
// question, so one recorded judgment closes it from either side. Demanding
// the same fact twice would be busywork the model should not ask for.
const dismissed = (left: IdentitySubject, right: IdentitySubject): boolean =>
  left.distinctFrom.has(right.id) || right.distinctFrom.has(left.id)

/**
 * Every candidate near-duplicate pair, sorted by subject id. Only subjects
 * of the same qualified kind are compared: kind is the cheapest structural
 * disagreement there is, and it also bounds the pairwise cost to the square
 * of the largest kind bucket rather than of the whole model.
 */
export const findNearDuplicates = (
  subjects: readonly IdentitySubject[],
): readonly NearDuplicatePair[] => {
  const buckets = new Map<string, IdentitySubject[]>()
  for (const subject of subjects) {
    const bucket = buckets.get(subject.kind)
    if (bucket === undefined) buckets.set(subject.kind, [subject])
    else bucket.push(subject)
  }
  const pairs: NearDuplicatePair[] = []
  for (const bucket of buckets.values()) {
    const ordered = [...bucket].sort((left, right) =>
      left.id.localeCompare(right.id),
    )
    for (const [index, left] of ordered.entries()) {
      for (const right of ordered.slice(index + 1)) {
        if (dismissed(left, right)) continue
        const score = lexicalScore(left, right)
        if (score < moderateLexicalThreshold) continue
        if (score >= strongLexicalThreshold) {
          pairs.push({ left: left.id, right: right.id, score, corroboration: 'lexical' })
          continue
        }
        const sameOwner =
          left.owner !== undefined && left.owner === right.owner
        if (sameOwner) {
          pairs.push({ left: left.id, right: right.id, score, corroboration: 'owner' })
          continue
        }
        if (shareNeighbour(left, right)) {
          pairs.push({
            left: left.id,
            right: right.id,
            score,
            corroboration: 'neighbourhood',
          })
        }
      }
    }
  }
  return pairs.sort(
    (left, right) =>
      left.left.localeCompare(right.left) ||
      left.right.localeCompare(right.right),
  )
}

/**
 * Both members of every candidate pair, mapped to their counterparts. The
 * question attaches to both sides deliberately: `ask --advise` filters open
 * questions to the subjects in a slice, so a finding recorded only against
 * the lexically-first member would vanish from a slice seeded on the other.
 */
export const nearDuplicateIndex = (
  subjects: readonly IdentitySubject[],
): ReadonlyMap<string, readonly string[]> => {
  const index = new Map<string, string[]>()
  for (const pair of findNearDuplicates(subjects)) {
    for (const [subject, counterpart] of [
      [pair.left, pair.right],
      [pair.right, pair.left],
    ] as const) {
      const existing = index.get(subject)
      if (existing === undefined) index.set(subject, [counterpart])
      else existing.push(counterpart)
    }
  }
  for (const counterparts of index.values()) {
    counterparts.sort((left, right) => left.localeCompare(right))
  }
  return index
}
