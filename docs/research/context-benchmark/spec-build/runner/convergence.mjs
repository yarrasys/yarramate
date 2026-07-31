// Convergence across the repeat runs of one arm: do independent sessions
// produce the same structure? Two pre-registered measures, both needing no
// right answer (DESIGN-HANDOFF-FAMILY.md):
//   names  — Jaccard similarity of the declared component-name token sets
//            across design runs;
//   files  — Jaccard similarity of implementation source paths (top two
//            levels) across build runs.
// Guard (pre-registered): compute arm A's convergence too — if A's runs
// converge as strongly as B's, the spec is forcing the structure and the
// metric is uninformative for this task.
//
// Usage:
//   node convergence.mjs --mode names --runs <dir> <dir> [<dir> ...]
//     names: pass design run dirs (uses promises-visible declared names via
//            score output is not required; reads DESIGN.md / workspace directly
//            is the build runner's job — here we read the recorded runs.jsonl
//            entries' promise scores when present, else the raw artifacts)
//   node convergence.mjs --mode files --runs <dir> <dir> [<dir> ...]
//     files: pass build run dirs (reads work/ trees)

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { opt } from './lib.mjs';

const args = process.argv.slice(2);
const mode = opt(args, 'mode');
const runsIndex = args.indexOf('--runs');
const runs = runsIndex >= 0 ? args.slice(runsIndex + 1) : [];
if (!['names', 'files'].includes(mode) || runs.length < 2) {
  console.error('usage: convergence.mjs --mode names|files --runs <dir> <dir> [...]');
  process.exit(2);
}

const SKIP = new Set(['node_modules', '.git', 'spec', 'handoff', '.yarramate', 'vendor', 'target', 'dist', '__pycache__']);

const nameTokens = (runDir) => {
  // Design run: declared names from promises.json when a build recorded
  // them, else directly from the artifact.
  const promisesPath = join(runDir, 'promises.json');
  if (existsSync(promisesPath)) {
    const { names } = JSON.parse(readFileSync(promisesPath, 'utf8'));
    return new Set(names.flatMap(({ name }) => name.toLowerCase().split(/[^a-z0-9]+/)).filter((token) => token.length >= 3));
  }
  const designDoc = join(runDir, 'work', 'DESIGN.md');
  if (existsSync(designDoc)) {
    const section = readFileSync(designDoc, 'utf8').split(/^## Components$/m)[1]?.split(/^## /m)[0] ?? '';
    const names = [...section.matchAll(/^\s*[-*]\s+\*\*([^*]+)\*\*/gm)].map((match) => match[1]);
    return new Set(names.flatMap((name) => name.toLowerCase().split(/[^a-z0-9]+/)).filter((token) => token.length >= 3));
  }
  const briefsDir = join(runDir, 'briefs');
  if (existsSync(briefsDir)) {
    return new Set(readdirSync(briefsDir)
      .flatMap((file) => file.replace(/^brief-|\.md$/g, '').split(/[^a-z0-9]+/))
      .filter((token) => token.length >= 3));
  }
  return new Set();
};

const filePaths = (runDir) => {
  const found = new Set();
  const walk = (dir, relative, depth) => {
    if (depth > 2) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (SKIP.has(entry.name)) continue;
      const rel = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(join(dir, entry.name), rel, depth + 1);
      else found.add(rel);
    }
  };
  walk(join(runDir, 'work'), '', 0);
  return found;
};

const sets = runs.map((runDir) => (mode === 'names' ? nameTokens(runDir) : filePaths(runDir)));
const jaccard = (a, b) => {
  const union = new Set([...a, ...b]);
  if (union.size === 0) return null;
  const intersection = [...a].filter((item) => b.has(item)).length;
  return Number((intersection / union.size).toFixed(3));
};

const pairs = [];
for (let i = 0; i < runs.length; i += 1) {
  for (let j = i + 1; j < runs.length; j += 1) {
    pairs.push({ a: runs[i], b: runs[j], jaccard: jaccard(sets[i], sets[j]) });
  }
}
const values = pairs.map(({ jaccard: value }) => value).filter((value) => value !== null);
console.log(JSON.stringify({
  mode,
  pairs,
  mean: values.length === 0 ? null : Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(3)),
  setSizes: sets.map((set) => set.size),
}, null, 2));
