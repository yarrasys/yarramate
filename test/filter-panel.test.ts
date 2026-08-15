import { describe, expect, it } from 'vitest'
import {
  EMPTY_FIELDS,
  composeQuery,
  queryToFields,
  type QueryFields,
} from '../src/visual-app/filter-panel.js'
import type { ProjectionQuery } from '../src/projection.js'

// A populated value for every one of the 13 `ProjectionQuery` dimensions, so
// each field's own round trip (composeQuery <-> queryToFields) is exercised
// independently of the others.
const filledFieldFor: { readonly [K in keyof QueryFields]: QueryFields[K] } = {
  subjects: ['main#user'],
  documents: ['architecture/main.yaml'],
  kinds: ['yarramate/core@0.1#businessActor'],
  layers: ['application'],
  statuses: ['current'],
  excludeStatuses: ['retired'],
  states: ['live'],
  owners: ['team-a'],
  constraints: ['australia-only'],
  relationshipKinds: ['serving'],
  kindMatching: 'descendants',
  relationships: 'between',
  isolatedConcepts: 'exclude',
}

const fieldKeys = Object.keys(filledFieldFor) as (keyof QueryFields)[]

const allFilledFields: QueryFields = filledFieldFor

const allFilledQuery: ProjectionQuery = {
  subjects: ['main#user'],
  documents: ['architecture/main.yaml'],
  kinds: ['yarramate/core@0.1#businessActor'],
  layers: ['application'],
  statuses: ['current'],
  excludeStatuses: ['retired'],
  states: ['live'],
  owners: ['team-a'],
  constraints: ['australia-only'],
  relationshipKinds: ['serving'],
  kindMatching: 'descendants',
  relationships: 'between',
  isolatedConcepts: 'exclude',
}

describe('composeQuery', () => {
  it('includes each of the 13 fields when populated, and omits it when empty', () => {
    for (const key of fieldKeys) {
      const populated = composeQuery({
        ...EMPTY_FIELDS,
        [key]: filledFieldFor[key],
      }) as Record<string, unknown>
      expect(populated[key]).toEqual(filledFieldFor[key])

      const empty = composeQuery(EMPTY_FIELDS) as Record<string, unknown>
      expect(key in empty).toBe(false)
    }
  })

  it('composes every field at once into the full query', () => {
    expect(composeQuery(allFilledFields)).toEqual(allFilledQuery)
  })

  it('produces an empty object for all-empty fields', () => {
    expect(composeQuery(EMPTY_FIELDS)).toEqual({})
  })
})

describe('queryToFields', () => {
  it('returns the all-empty shape for null', () => {
    expect(queryToFields(null)).toEqual(EMPTY_FIELDS)
  })

  it('returns the all-empty shape for an empty query', () => {
    expect(queryToFields({})).toEqual(EMPTY_FIELDS)
  })

  it('inverts a populated query back into fields, one dimension at a time', () => {
    for (const key of fieldKeys) {
      const query: ProjectionQuery = { [key]: filledFieldFor[key] } as ProjectionQuery
      expect(queryToFields(query)).toEqual({
        ...EMPTY_FIELDS,
        [key]: filledFieldFor[key],
      })
    }
  })

  it('round-trips a query using all 13 fields through composeQuery(queryToFields(query))', () => {
    expect(composeQuery(queryToFields(allFilledQuery))).toEqual(allFilledQuery)
  })
})
