// Draft validator for yarramate/benchmark-suite v1 and v2 task suites.
// Schema validation plus the cross-checks the schema cannot express:
// unique task ids, per-family minimums, and condition-neutral prompts.
// Usage: node validate-suite.mjs <schema.json> <suite.yaml> [suite.yaml ...]

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const require = createRequire(join(repoRoot, 'package.json'));
const Ajv2020 = require('ajv/dist/2020').default;
const YAML = require('yaml');

const [schemaPath, ...suitePaths] = process.argv.slice(2);
if (!schemaPath || suitePaths.length === 0) {
  console.error('usage: validate-suite.mjs <schema.json> <suite.yaml> [suite.yaml ...]');
  process.exit(2);
}

const ajv = new Ajv2020({ allErrors: true });
const validate = ajv.compile(JSON.parse(readFileSync(schemaPath, 'utf8')));

// Comprehension and change prompts run under condition A (no model), so they
// must not hint at a preferred context source (DESIGN.md, "Prompt leakage").
// Model-maintenance prompts necessarily reference the workspace and only run
// under model-present conditions. Checked lexically; phrasing review still applies.
const leakage = /yarramate|projection|likec4|architecture model|\.yarramate/i;

const MIN_PER_FAMILY = 2;
let failed = false;
const fail = (file, message) => {
  failed = true;
  console.error(`${file}: ${message}`);
};

for (const suitePath of suitePaths) {
  const suite = YAML.parse(readFileSync(suitePath, 'utf8'));
  if (!validate(suite)) {
    for (const err of validate.errors) fail(suitePath, `schema ${err.instancePath || '/'} ${err.message}`);
    continue;
  }

  const ids = new Set();
  const families = { comprehension: 0, change: 0, 'model-maintenance': 0 };
  for (const task of suite.tasks) {
    if (ids.has(task.id)) fail(suitePath, `duplicate task id ${task.id}`);
    ids.add(task.id);
    families[task.family] += 1;
    if (task.family !== 'model-maintenance' && leakage.test(task.prompt)) {
      fail(suitePath, `task ${task.id}: prompt mentions a context source (leakage)`);
    }
  }
  for (const [family, count] of Object.entries(families)) {
    if (count < MIN_PER_FAMILY) fail(suitePath, `family ${family} has ${count} tasks, needs >= ${MIN_PER_FAMILY}`);
  }
  if (!failed) {
    const retired = suite.retired
      ? ` RETIRED ${suite.retired.since} (conditions ${suite.retired.conditions.join(',')} cannot run)`
      : '';
    console.log(`${suitePath}: ok (${suite.tasks.length} tasks, headline=${suite.headline})${retired}`);
  }
}

process.exit(failed ? 1 : 0);
