// Condition C staleness injector: make the model lie about the code while the
// evidence overlay records what the code actually shows, so reconciliation
// reports the injected claims as contradicted (DESIGN.md, H3).
//
// Deterministic mutation: among relationship claims that carry a confirmed
// evidence observation, pick the largest same-kind group, take the first
// <count> with pairwise-distinct targets (sorted by claim id), rotate their
// `to` endpoints, and flip the matching observations to "contradicted".
// Same-kind rotation keeps endpoints existing and kind semantics legal.
//
// Self-verifies with the pinned CLI: check must stay green and reconcile must
// report at least <count> contradicted claims, otherwise exits non-zero.
//
// Usage: node inject-stale.mjs --workspace <dir-or-workspace.yaml> --cli <yarramate-bin> [--count 3]

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const require = createRequire(join(repoRoot, 'package.json'));
const YAML = require('yaml');

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const workspaceArg = opt('workspace');
const cli = opt('cli');
const count = Number(opt('count', '3'));
if (!workspaceArg || !cli) {
  console.error('usage: inject-stale.mjs --workspace <dir-or-workspace.yaml> --cli <yarramate-bin> [--count 3]');
  process.exit(2);
}

const workspacePath = workspaceArg.endsWith('.yaml') ? resolve(workspaceArg) : resolve(workspaceArg, 'workspace.yaml');
const modelDir = dirname(workspacePath);

const yamlFiles = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path);
    else if (entry.endsWith('.yaml')) yamlFiles.push(path);
  }
};
walk(modelDir);

const documents = [];
const evidences = [];
for (const path of yamlFiles) {
  const parsed = YAML.parse(readFileSync(path, 'utf8'));
  if (!parsed || typeof parsed !== 'object') continue;
  if (parsed.format === 'yarramate/v1') documents.push({ path, parsed });
  else if (parsed.format === 'yarramate/evidence/v1') evidences.push({ path, parsed });
}
if (documents.length === 0 || evidences.length === 0) {
  console.error(`inject-stale: found ${documents.length} documents and ${evidences.length} evidence overlays under ${modelDir}; need both`);
  process.exit(1);
}

const confirmedClaims = new Set();
for (const { parsed } of evidences) {
  for (const obs of parsed.observations ?? []) {
    if (obs.result === 'confirmed' && obs.claim) confirmedClaims.add(obs.claim);
  }
}

const candidates = [];
for (const { path, parsed } of documents) {
  for (const rel of parsed.relationships ?? []) {
    const claim = `${parsed.id}#${rel.id}`;
    if (confirmedClaims.has(claim)) candidates.push({ claim, rel, kind: rel.kind, path });
  }
}
const byKind = new Map();
for (const c of candidates) byKind.set(c.kind, [...(byKind.get(c.kind) ?? []), c]);
const group = [...byKind.values()].sort((a, b) => b.length - a.length)[0] ?? [];
group.sort((a, b) => a.claim.localeCompare(b.claim));

const picked = [];
const seenTargets = new Set();
for (const c of group) {
  if (seenTargets.has(c.rel.to)) continue;
  seenTargets.add(c.rel.to);
  picked.push(c);
  if (picked.length === count) break;
}
if (picked.length < count) {
  console.error(`inject-stale: needed ${count} same-kind confirmed relationship claims with distinct targets, found ${picked.length}`);
  process.exit(1);
}

const originalTargets = picked.map((c) => c.rel.to);
picked.forEach((c, i) => {
  c.rel.to = originalTargets[(i + 1) % picked.length];
});

const staleClaims = new Set(picked.map((c) => c.claim));
for (const { path, parsed } of evidences) {
  let touched = false;
  for (const obs of parsed.observations ?? []) {
    if (obs.claim && staleClaims.has(obs.claim)) {
      obs.result = 'contradicted';
      touched = true;
    }
  }
  if (touched) writeFileSync(path, YAML.stringify(parsed));
}
for (const { path, parsed } of documents) {
  if (picked.some((c) => c.path === path)) writeFileSync(path, YAML.stringify(parsed));
}

// --- self-verify ------------------------------------------------------------
const run = (bin, cmdArgs) => {
  try {
    return { out: execFileSync(bin, cmdArgs, { encoding: 'utf8' }), code: 0 };
  } catch (error) {
    return { out: `${error.stdout ?? ''}${error.stderr ?? ''}`, code: error.status ?? 1 };
  }
};

const check = run(cli, ['check', workspacePath, '--json']);
let checkOk = false;
try {
  checkOk = JSON.parse(check.out).ok === true;
} catch {
  checkOk = false;
}
if (!checkOk) {
  console.error(`inject-stale: check no longer passes after mutation:\n${check.out}`);
  process.exit(1);
}

const reconcile = run(cli, ['reconcile', workspacePath]);
let contradicted = null;
try {
  const report = JSON.parse(reconcile.out);
  contradicted = report.summary?.contradicted ?? report.contradicted ?? null;
} catch {
  const match = reconcile.out.match(/contradicted\D{0,5}(\d+)/i) ?? reconcile.out.match(/(\d+)\s+contradicted/i);
  if (match) contradicted = Number(match[1]);
}
if (contradicted === null || contradicted < count) {
  console.error(`inject-stale: expected >= ${count} contradicted claims, reconcile reported ${contradicted}:\n${reconcile.out}`);
  process.exit(1);
}

console.log(JSON.stringify({ mutated: [...staleClaims].sort(), contradicted }));
