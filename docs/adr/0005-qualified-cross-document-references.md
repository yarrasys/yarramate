# Add qualified cross-document concept references

Status: accepted

## Context

Native documents use document IDs as stable namespaces. The first compiler
supported only references within the authored document, which forced unrelated
product intent, engine design, and repository artifacts into one file.

## Decision

A relationship endpoint is either:

- a local concept ID such as `compiler`; or
- a qualified concept ID such as `yarramate-product#stable-cli`.

Local references resolve in the relationship's document namespace. Qualified
references resolve against the complete set of documents supplied to one
`compileWorkspace` operation. Both forms compile to the same canonical
`document-id#local-id` subject identity.

References address concepts only. They do not use source paths, directory
layout, implicit imports, or list positions. A qualified reference whose
document or concept is absent produces the existing unresolved-reference
diagnostic at the authored endpoint.

## Consequences

Documents can be divided along reviewable semantic seams without changing the
compiled graph model. Moving files does not alter identity, and callers must
supply every referenced document as part of the workspace compilation.

This decision does not define a workspace manifest, repository discovery,
profile imports, relationship-to-relationship references, or remote
resolution. The syntax and wording are original YarraMate semantics.
