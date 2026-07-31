// Mechanical promise-keeping floor. The declared component names are the
// promises: arm A's come from DESIGN.md's mandated `## Components` bullets,
// arms B/C's from the designer workspace's planned concepts. A name is
// honoured when its tokens appear in the implementation (file names or
// source text), missing otherwise; DEVIATIONS.md entries are surfaced but
// not judged. This is deliberately the floor — boundary violations need
// human adjudication on top (no-LLM-judging), and the scorer never claims
// more than name presence.
//
// Usage:
//   node score-promises.mjs --arm A|B|C --design <design-run-dir> --impl <workdir> [--toolchain <bins>]

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { opt, plannedConcepts } from './lib.mjs';

const args = process.argv.slice(2);
const arm = opt(args, 'arm');
const designDir = opt(args, 'design');
const impl = opt(args, 'impl');
const toolchain = opt(args, 'toolchain');
if (!arm || !designDir || !impl) {
  console.error('usage: score-promises.mjs --arm A|B|C --design <design-run-dir> --impl <workdir> [--toolchain <bins>]');
  process.exit(2);
}

const declaredNames = () => {
  if (arm === 'A') {
    const text = readFileSync(join(designDir, 'work', 'DESIGN.md'), 'utf8');
    const section = text.split(/^## Components$/m)[1]?.split(/^## /m)[0] ?? '';
    return [...section.matchAll(/^\s*[-*]\s+\*\*([^*]+)\*\*/gm)].map((match) => match[1].trim());
  }
  if (!toolchain) {
    console.error('score-promises: arms B/C need --toolchain to compile the designer workspace');
    process.exit(2);
  }
  return plannedConcepts(toolchain, join(designDir, 'work', '.yarramate')).map(({ name }) => name);
};

// Implementation corpus: file paths plus source text, excluding dependency
// trees and the materials the harness placed.
const SKIP = new Set(['node_modules', '.git', 'spec', 'handoff', '.yarramate', 'vendor', 'target', 'dist', '__pycache__']);
const corpus = [];
const walk = (dir, relative) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const path = join(dir, entry.name);
    const rel = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      walk(path, rel);
    } else if (statSync(path).size < 512 * 1024) {
      corpus.push({ path: rel, text: readFileSync(path, 'utf8').toLowerCase() });
    }
  }
};
walk(impl, '');
const allText = corpus.map(({ path, text }) => `${path.toLowerCase()}\n${text}`).join('\n');

// A name is honoured when every informative token appears; single-token
// names match as-is. Tokens under three characters carry no signal.
const tokens = (name) => name.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length >= 3);
const names = declaredNames();
const scored = names.map((name) => {
  const parts = tokens(name);
  const honoured = parts.length > 0 && parts.every((token) => allText.includes(token));
  return { name, honoured };
});

const deviationsPath = join(impl, 'DEVIATIONS.md');
const deviations = existsSync(deviationsPath) ? readFileSync(deviationsPath, 'utf8').trim() : '';

console.log(JSON.stringify({
  arm,
  declared: names.length,
  honoured: scored.filter(({ honoured }) => honoured).length,
  missing: scored.filter(({ honoured }) => !honoured).map(({ name }) => name),
  names: scored,
  deviations: deviations === '' ? null : deviations.split('\n').filter((line) => line.trim().startsWith('-')).length || 'present',
}, null, 2));
