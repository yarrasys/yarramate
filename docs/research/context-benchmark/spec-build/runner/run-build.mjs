// Build phase, one run of one arm: a fresh implementer receives the spec
// materials plus the arm's handoff artifact, builds the backend, and is
// gated by the conformance suites. Promise-keeping is scored mechanically
// afterwards; both scores land in the run record.
//
// Usage:
//   node run-build.mjs --arm A|B|C --run <n> --out <results-dir> \
//     [--design-run <n>]     (defaults to --run; which design run feeds this build) \
//     [--harness 'claude -p --output-format json'] \
//     [--toolchain <bins>]   (required for B/C promise scoring) \
//     [--port 3199] [--no-gate] [--dry-run]

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ensureSpecCache, flag, here, opt, placeSpecMaterials, readPrompt,
  record, runHarness, saveTranscript,
} from './lib.mjs';

const args = process.argv.slice(2);
const arm = opt(args, 'arm');
const runN = opt(args, 'run');
const outDir = opt(args, 'out');
const designRun = opt(args, 'design-run', runN);
const toolchain = opt(args, 'toolchain');
const harness = opt(args, 'harness', 'claude -p --output-format json');
const port = opt(args, 'port', '3199');
const dryRun = flag(args, 'dry-run');
if (!['A', 'B', 'C', 'Cs'].includes(arm) || !runN || !outDir) {
  console.error('usage: run-build.mjs --arm A|B|C|Cs --run <n> --out <dir> [--design-run <n>] [--harness <cmd>] [--toolchain <bins>] [--port <p>] [--no-gate] [--dry-run]');
  process.exit(2);
}

const designDir = join(outDir, 'design', arm, `run-${designRun}`);
const runDir = join(outDir, 'build', arm, `run-${runN}`);
const workdir = join(runDir, 'work');

if (dryRun) {
  console.log(`build arm=${arm} run=${runN} design=${designDir} harness=${JSON.stringify(harness)}`);
  process.exit(0);
}

rmSync(runDir, { recursive: true, force: true });
mkdirSync(workdir, { recursive: true });
placeSpecMaterials(workdir, ensureSpecCache(outDir));

// The handoff: exactly what the arm's design phase produced, nothing else.
// Implementers never see the model or the CLI — briefs are the interface
// (ADR 0054); arm A's document plays the same role.
const handoff = join(workdir, 'handoff');
mkdirSync(handoff);
if (arm === 'A') {
  cpSync(join(designDir, 'work', 'DESIGN.md'), join(handoff, 'DESIGN.md'));
} else {
  cpSync(join(designDir, 'briefs'), handoff, { recursive: true });
}

const prompt = readPrompt('implementer');
writeFileSync(join(runDir, 'prompt.txt'), prompt);
const { result, durationMs, metrics } = runHarness(harness, workdir, prompt);
saveTranscript(runDir, result);

let gate = null;
if (!flag(args, 'no-gate') && existsSync(join(workdir, 'run.sh'))) {
  try {
    gate = JSON.parse(execFileSync('node', [
      join(here, 'conformance.mjs'),
      '--workdir', workdir,
      '--port', port,
    ], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }));
  } catch (error) {
    gate = { ok: false, error: String(error.stdout ?? error).slice(0, 4000) };
  }
} else if (!existsSync(join(workdir, 'run.sh'))) {
  gate = { ok: false, error: 'run.sh missing' };
}
writeFileSync(join(runDir, 'gate.json'), JSON.stringify(gate, null, 2));

let promises = null;
try {
  promises = JSON.parse(execFileSync('node', [
    join(here, 'score-promises.mjs'),
    '--arm', arm,
    '--design', designDir,
    '--impl', workdir,
    ...(toolchain ? ['--toolchain', toolchain] : []),
  ], { encoding: 'utf8' }));
} catch (error) {
  promises = { error: String(error).slice(0, 2000) };
}
writeFileSync(join(runDir, 'promises.json'), JSON.stringify(promises, null, 2));

record(outDir, {
  phase: 'build', arm, run: Number(runN), designRun: Number(designRun),
  exitCode: result.status, durationMs, metrics, gate, promises, runDir,
});
console.log(JSON.stringify({ arm, run: Number(runN), gate, promises, metrics }, null, 2));
