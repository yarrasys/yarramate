// TypeSafe System One client for the judgment experiment (docs/research/typesafe/PROTOCOL.md).
//
// Research code, not part of the package. Reads the key from the environment
// only, never logs it, and refuses to go live unless the caller says so. Every
// request and response is written to the replay cache keyed by the request's
// hash, the way the vendor's cookbooks ship a json_cache, so a re-run of a
// finished arm costs nothing and a reader can replay the exact answers.

import { createHash } from 'node:crypto'
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const ENDPOINT = 'https://api.typesafe.ai/v1/systemone'
// Pinned on purpose: an alias moves when a release ships (vendor docs, Models).
export const MODEL = 'jev-1.13.0'

const sha256 = (text) => createHash('sha256').update(text).digest('hex')

export const requestHash = (request) => sha256(JSON.stringify(request))

/** Rough token count for planning: the vendor bills input tokens only. */
export const estimateTokens = (request) => Math.ceil(JSON.stringify(request).length / 4)

export const createClient = ({ cacheDir, live = false, concurrency = 4, log = () => {} }) => {
  mkdirSync(cacheDir, { recursive: true })
  const key = process.env.TYPESAFE_API_KEY
  if (live && (key === undefined || key.length < 8)) {
    throw new Error('live run requested but TYPESAFE_API_KEY is not set; see docs/research/typesafe/README.md')
  }
  let inFlight = 0
  const queue = []
  const next = () => {
    if (inFlight >= concurrency || queue.length === 0) return
    inFlight += 1
    const { run, resolve, reject } = queue.shift()
    run().then(resolve, reject).finally(() => {
      inFlight -= 1
      next()
    })
  }
  const schedule = (run) => new Promise((resolve, reject) => {
    queue.push({ run, resolve, reject })
    next()
  })

  const call = async (request) => {
    const body = { model: MODEL, ...request }
    const hash = requestHash(body)
    const path = join(cacheDir, `${hash}.json`)
    if (existsSync(path)) {
      const cached = JSON.parse(readFileSync(path, 'utf8'))
      return { ...cached.response, _cached: true, _ms: cached.ms, _hash: hash }
    }
    if (!live) return { _planned: true, _hash: hash, _tokens: estimateTokens(body) }
    return schedule(async () => {
      let attempt = 0
      for (;;) {
        attempt += 1
        const started = Date.now()
        let response
        try {
          response = await fetch(ENDPOINT, {
            method: 'POST',
            headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(60000),
          })
        } catch (error) {
          // A dropped connection or a timeout is not an answer; retry it the way a
          // throttle is retried. A long run over thousands of requests will meet these.
          if (attempt >= 8) throw new Error(`network failed after ${attempt} attempts: ${error?.cause?.code ?? error.message}`)
          const wait = Math.min(30000, 500 * 2 ** attempt)
          log(`network ${error?.cause?.code ?? error.name}, retrying in ${wait} ms`)
          await new Promise((r) => setTimeout(r, wait))
          continue
        }
        const ms = Date.now() - started
        if (response.status === 429 || response.status === 529) {
          if (attempt >= 6) throw new Error(`typesafe ${response.status} after ${attempt} attempts`)
          const retryAfter = Number(response.headers.get('retry-after') ?? 0)
          const wait = retryAfter > 0 ? retryAfter * 1000 : Math.min(30000, 500 * 2 ** attempt)
          log(`rate limited (${response.status}), waiting ${wait} ms`)
          await new Promise((r) => setTimeout(r, wait))
          continue
        }
        const text = await response.text()
        if (!response.ok) {
          // Never echo the request body here: it may carry the key's neighbour headers in a stack trace.
          throw new Error(`typesafe ${response.status}: ${text.slice(0, 300)}`)
        }
        const parsed = JSON.parse(text)
        writeFileSync(path, JSON.stringify({ at: new Date().toISOString(), ms, request: body, response: parsed }, null, 2))
        return { ...parsed, _cached: false, _ms: ms, _hash: hash }
      }
    })
  }

  return { call, live, model: MODEL }
}

/** Confidence and probabilities helpers shared by the arms. */
export const top = (probabilities) =>
  Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0]
