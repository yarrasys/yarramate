import { describe, expect, it } from 'vitest'
import { kindOptionText } from '../src/kind-label.js'

/**
 * What a reader sees where a kind is offered or stated (Nabeel, 2026-09-05).
 *
 * The field this reads, `VisualKindOption.name`, shipped in phase 4 with ZERO
 * consumers: it was added to the wire, typechecked, and never connected to a
 * renderer, so a profile that authored "Mule API interface" saw it nowhere.
 * Found by the ApertureX session reading a mounted host rather than assuming.
 */

describe('kindOptionText', () => {
  it('states the authored name AND the id the document will carry', () => {
    // Both halves. The panel edits the document, so an architect needs the
    // exact token; a consultant needs to know what the token means.
    expect(kindOptionText({ label: 'mule-api', name: 'Mule API interface' })).toBe(
      'Mule API interface (mule-api)',
    )
  })

  it('says the id alone where the profile authored no name', () => {
    // Which is every core kind - roughly 140 of them on the reference. A
    // parenthetical there would be noise on every row.
    expect(kindOptionText({ label: 'applicationComponent' })).toBe(
      'applicationComponent',
    )
  })

  it('does not repeat a name that is already the id', () => {
    // A profile may author a name identical to its local id, which would
    // otherwise read `dataObject (dataObject)`.
    expect(kindOptionText({ label: 'dataObject', name: 'dataObject' })).toBe(
      'dataObject',
    )
  })
})
