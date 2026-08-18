import { describe, expect, it } from 'vitest'
import {
  ATTESTATION_PREDICATE_PREFIX,
  attestationClaimValue,
  parseAttestationClaimValue,
  parseConstraintExpectsValue,
} from '../src/graph-claims.js'

describe('graph-claims', () => {
  it('exposes the attestation predicate prefix', () => {
    expect(ATTESTATION_PREDICATE_PREFIX).toBe('yarramate/attestation/')
  })

  it('round-trips attestation values with and without recordedBy', () => {
    expect(parseAttestationClaimValue(attestationClaimValue({ by: 'a', on: '2026-08-01' }))).toEqual({
      by: 'a',
      on: '2026-08-01',
    })
    expect(
      parseAttestationClaimValue(
        attestationClaimValue({ by: 'a', on: '2026-08-01', recordedBy: 'bot' }),
      ),
    ).toEqual({ by: 'a', on: '2026-08-01', recordedBy: 'bot' })
  })

  it('rejects malformed attestation values', () => {
    expect(parseAttestationClaimValue('only-one-token')).toBeUndefined()
    expect(parseAttestationClaimValue('a not-a-date')).toBeUndefined()
  })

  it('parses constraint expects with spaces in the value', () => {
    expect(parseConstraintExpectsValue('terraform-scan region ap-southeast-2')).toEqual({
      provider: 'terraform-scan',
      key: 'region',
      value: 'ap-southeast-2',
    })
    expect(parseConstraintExpectsValue('p k value with spaces')).toEqual({
      provider: 'p',
      key: 'k',
      value: 'value with spaces',
    })
  })

  it('rejects malformed constraint expects', () => {
    expect(parseConstraintExpectsValue('only-one')).toBeUndefined()
    expect(parseConstraintExpectsValue('one two')).toBeUndefined()
  })
})
