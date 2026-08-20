import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const shippedPolicyIdentity = 'yarramate/policy@0.1'

const here = dirname(fileURLToPath(import.meta.url))

export const shippedPolicySource = readFileSync(
  join(here, '..', 'profiles', 'yarramate-policy.yaml'),
  'utf8',
)
