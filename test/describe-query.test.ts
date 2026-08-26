import { describe, expect, it } from 'vitest'
import { describeQuery } from '../src/visual-app/describe-query.js'

describe('describeQuery', () => {
  it('summarizes a single populated field', () => {
    expect(describeQuery({ layers: ['application'] })).toBe('layers: application')
  })

  it('joins multiple values within a field', () => {
    expect(describeQuery({ layers: ['application', 'technology'] })).toBe(
      'layers: application, technology',
    )
  })

  it('names connectivity queries by their subject rather than field order', () => {
    expect(
      describeQuery({ subjects: ['checkout-service'], relationships: 'connected' }),
    ).toBe('connected to checkout-service')
  })

  it('names betweenness queries with their subjects', () => {
    expect(
      describeQuery({
        subjects: ['checkout-service', 'payments-gateway'],
        relationships: 'between',
      }),
    ).toBe('between checkout-service, payments-gateway')
  })

  it('notes descendant kind matching against the kinds it widens', () => {
    expect(
      describeQuery({ kinds: ['capability'], kindMatching: 'descendants' }),
    ).toBe('kinds (and descendants): capability')
  })

  it('prioritizes several populated fields in a stable, readable order', () => {
    expect(
      describeQuery({
        layers: ['application'],
        statuses: ['current'],
        owners: ['platform-team'],
      }),
    ).toBe('layers: application · statuses: current · owners: platform-team')
  })

  it('notes an isolated-concepts exclusion', () => {
    expect(describeQuery({ isolatedConcepts: 'exclude' })).toBe(
      'connected concepts only',
    )
  })

  // The exception a rule states about itself (#267, ADR 0122). It has to be
  // read back either way a query can be glossed, or the pill describes a view
  // that draws subjects the reviewer took out.
  it('reads the exception back, in both glosses', () => {
    expect(
      describeQuery({ layers: ['application'], exclude: ['legacy-gateway'] }),
    ).toBe('layers: application · except: legacy-gateway')
    expect(
      describeQuery({
        subjects: ['checkout'],
        relationships: 'connected',
        exclude: ['ledger'],
      }),
    ).toBe('connected to checkout · except: ledger')
  })

  it('falls back to "all" for a query with nothing populated', () => {
    expect(describeQuery({})).toBe('all')
  })
})
