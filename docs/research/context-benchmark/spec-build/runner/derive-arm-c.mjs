// Derives arm C's handoff from a completed arm B design run: copy the
// designer workspace, inject lies (same-kind endpoint rotation), and
// re-render the briefs from the lying model. The C run number mirrors the
// B run it derives from — pre-registered mapping, no choice at run time.
//
// Usage:
//   node derive-arm-c.mjs --run <n> --out <results-dir> --toolchain <bins>

import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { here, opt, record } from './lib.mjs';

const args = process.argv.slice(2);
const runN = opt(args, 'run');
const outDir = opt(args, 'out');
const toolchain = opt(args, 'toolchain');
if (!runN || !outDir || !toolchain) {
  console.error('usage: derive-arm-c.mjs --run <n> --out <dir> --toolchain <bins>');
  process.exit(2);
}

const sourceWork = join(outDir, 'design', 'B', `run-${runN}`, 'work');
const runDir = join(outDir, 'design', 'C', `run-${runN}`);
const workdir = join(runDir, 'work');
rmSync(runDir, { recursive: true, force: true });
mkdirSync(runDir, { recursive: true });
cpSync(sourceWork, workdir, { recursive: true });

const lieRecord = execFileSync('node', [
  join(here, 'inject-lies.mjs'),
  '--workdir', workdir,
  '--toolchain', toolchain,
], { encoding: 'utf8' });
writeFileSync(join(runDir, 'lies.json'), lieRecord);

const briefs = JSON.parse(execFileSync('node', [
  join(here, 'render-briefs.mjs'),
  '--workdir', workdir,
  '--toolchain', toolchain,
  '--out', join(runDir, 'briefs'),
], { encoding: 'utf8' })).rendered;

record(outDir, {
  phase: 'design', arm: 'C', run: Number(runN), derivedFrom: `B/run-${runN}`,
  exitCode: 0, durationMs: 0, metrics: null,
  deliverable: { kind: 'workspace', ok: briefs.length > 0, lies: JSON.parse(lieRecord).lies.length, briefs },
  runDir,
});
console.log(JSON.stringify({ arm: 'C', run: Number(runN), lies: JSON.parse(lieRecord).lies, briefs }, null, 2));
