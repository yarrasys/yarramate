// Turns arm B's designer workspace into arm C's: a model that still passes
// check but lies about the wiring. Greenfield variant of the sweep's
// inject-stale.mjs — there is no evidence to flip, so the lie is pure
// rotation: for up to three relationship kinds with at least two instances,
// rotate the `to` endpoints among the instances. Deterministic (sorted
// order, no randomness) so a C run is reproducible from its B workspace.
// Refuses to proceed if the lying model fails check: a lie that breaks the
// gate is not the failure mode under test.
//
// Usage:
//   node inject-lies.mjs --workdir <arm-C-workdir> --toolchain <bins>
// Prints the lie record (JSON) to stdout; the caller persists it.

import { execFileSync } from 'node:child_process';
import { globSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { opt, repoRoot } from './lib.mjs';

const require = createRequire(join(repoRoot, 'package.json'));
const YAML = require('yaml');

const args = process.argv.slice(2);
const workdir = opt(args, 'workdir');
const toolchain = opt(args, 'toolchain');
if (!workdir || !toolchain) {
  console.error('usage: inject-lies.mjs --workdir <arm-C-workdir> --toolchain <bins>');
  process.exit(2);
}

const cli = join(toolchain, 'yarramate');
const manifestPath = join(workdir, '.yarramate', 'workspace.yaml');
const manifest = YAML.parse(readFileSync(manifestPath, 'utf8'));

const check = (allowFail) => {
  try {
    execFileSync(cli, ['check', '.yarramate/workspace.yaml'], { cwd: workdir, stdio: 'pipe' });
    return true;
  } catch (error) {
    if (allowFail) return false;
    throw error;
  }
};
check(false);

// Collect relationships across the manifest's documents, grouped by kind.
// Manifest entries may be globs (the CLI expands them; so must we).
const documents = manifest.documents
  .flatMap((path) => globSync(path, { cwd: join(workdir, '.yarramate') }).sort())
  .map((path) => {
    const absolute = join(workdir, '.yarramate', path);
    return { path: absolute, doc: YAML.parseDocument(readFileSync(absolute, 'utf8')) };
  });
// Group by document AND kind: references are document-local, so a target
// rotated across documents would dangle (YM302) instead of lying.
const byKind = new Map();
for (const { path, doc } of documents) {
  const relationships = doc.get('relationships');
  if (!relationships || !relationships.items) continue;
  for (const item of relationships.items) {
    const key = `${path}::${item.get('kind')}`;
    const entry = { path, doc, item, kind: item.get('kind') };
    byKind.set(key, [...(byKind.get(key) ?? []), entry]);
  }
}

const lies = [];
for (const key of [...byKind.keys()].sort()) {
  if (lies.length >= 3) break;
  const group = byKind.get(key).filter((entry) => entry.item.get('to') !== undefined);
  const kind = group[0]?.kind;
  const targets = group.map((entry) => entry.item.get('to'));
  if (new Set(targets).size < 2) continue;
  // Rotate every target in the group one position: each relationship now
  // points where its same-kind neighbour pointed. A rotation that changes
  // nothing, or that would point a relationship at its own source (a
  // self-loop no designer would write), stays truthful instead.
  group.forEach((entry, index) => {
    const lyingTo = targets[(index + 1) % targets.length];
    if (lyingTo === targets[index] || lyingTo === entry.item.get('from')) return;
    entry.item.set('to', lyingTo);
    lies.push({
      relationship: entry.item.get('id'),
      kind,
      from: entry.item.get('from'),
      originalTo: targets[index],
      lyingTo,
    });
  });
}

if (lies.length === 0) {
  console.error('inject-lies: no rotatable relationship group found; arm C cannot be derived from this workspace');
  process.exit(1);
}

for (const { path, doc } of documents) {
  writeFileSync(path, doc.toString());
}

if (!check(true)) {
  console.error('inject-lies: the lying model fails check; rotation produced an invalid model (aspect rules?). Inspect and re-derive.');
  process.exit(1);
}

console.log(JSON.stringify({ lies }, null, 2));
