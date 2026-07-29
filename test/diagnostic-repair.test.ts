import { describe, expect, it } from 'vitest'
import { compileWorkspace } from '../src/compiler.js'

const document = (body: string) => ({
  path: 'architecture/example.yaml',
  source: body,
})

const messagesOf = (sources: readonly { path: string; source: string }[]) => {
  const result = compileWorkspace(sources)
  expect(result.ok).toBe(false)
  return result.ok ? [] : result.diagnostics.map(({ message }) => message)
}

describe('repair-oriented diagnostics', () => {
  it('suggests the closest concept kind for a near miss', () => {
    const messages = messagesOf([
      document(
        'format: yarramate/v1\nid: example\nprofile: yarramate/core@0.1\nconcepts:\n  - id: a\n    kind: applicationServic\n    name: A\nrelationships: []\n',
      ),
    ])
    expect(messages).toContain(
      'Unknown concept kind "applicationServic" in profile "yarramate/core@0.1"; did you mean "applicationService"?',
    )
  })

  it('suggests the closest relationship kind for a near miss', () => {
    const messages = messagesOf([
      document(
        'format: yarramate/v1\nid: example\nprofile: yarramate/core@0.1\nconcepts:\n  - id: a\n    kind: applicationService\n    name: A\nrelationships:\n  - id: r\n    kind: servin\n    from: a\n    to: a\n',
      ),
    ])
    expect(
      messages.some((message) =>
        message.includes('did you mean "serving"?'),
      ),
    ).toBe(true)
  })

  it('offers no suggestion when nothing is close', () => {
    const messages = messagesOf([
      document(
        'format: yarramate/v1\nid: example\nprofile: yarramate/core@0.1\nconcepts:\n  - id: a\n    kind: zzzzzzzzzz\n    name: A\nrelationships: []\n',
      ),
    ])
    const unknown = messages.find((message) =>
      message.startsWith('Unknown concept kind "zzzzzzzzzz"'),
    )
    expect(unknown).toBeDefined()
    expect(unknown).not.toContain('did you mean')
  })

  it('names the expected constant on format violations', () => {
    const messages = messagesOf([
      document(
        'format: yarramate/document/v9\nid: example\nprofile: yarramate/core@0.1\nconcepts:\n  - id: a\n    kind: applicationService\n    name: A\n',
      ),
    ])
    expect(messages).toContain(
      'Document schema violation: must be equal to constant: expected "yarramate/v1"',
    )
  })

  it('lists the allowed values on enum violations', () => {
    const messages = messagesOf([
      document(
        'format: yarramate/v1\nid: example\nprofile: yarramate/core@0.1\nconcepts:\n  - id: a\n    kind: applicationService\n    name: A\n    status: activ\n',
      ),
    ])
    expect(messages).toContain(
      'Document schema violation: must be equal to one of the allowed values: "planned", "current", "retired"',
    )
  })
})
