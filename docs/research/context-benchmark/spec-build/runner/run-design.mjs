// Design phase, one run of one arm. Arm A's designer writes DESIGN.md;
// arm B's designer authors a YarraMate workspace, which is then verified
// (check green) and rendered to briefs mechanically. Arm C has no design
// phase of its own: derive it from a B run with derive-arm-c.mjs.
//
// Runs cost real agent tokens; nothing executes without --harness, and
// --dry-run prints what would run.
//
// Usage:
//   node run-design.mjs --arm A|B --run <n> --out <results-dir> \
//     [--toolchain <dir with yarramate bins>]   (required for arm B) \
//     [--harness 'claude -p --output-format json'] [--dry-run]

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ensureSpecCache, flag, opt, placeSpecMaterials, readPrompt,
  record, runHarness, saveTranscript,
} from './lib.mjs';

const args = process.argv.slice(2);
const arm = opt(args, 'arm');
const runN = opt(args, 'run');
const outDir = opt(args, 'out');
const toolchain = opt(args, 'toolchain');
const harness = opt(args, 'harness', 'claude -p --output-format json');
const dryRun = flag(args, 'dry-run');
if (!['A', 'B'].includes(arm) || !runN || !outDir) {
  console.error('usage: run-design.mjs --arm A|B --run <n> --out <dir> [--toolchain <bins>] [--harness <cmd>] [--dry-run]');
  process.exit(2);
}
if (arm === 'B' && !toolchain && !dryRun) {
  console.error('run-design: arm B needs --toolchain (pinned yarramate bins)');
  process.exit(2);
}

const runDir = join(outDir, 'design', arm, `run-${runN}`);
const workdir = join(runDir, 'work');
const prompt = readPrompt(arm === 'A' ? 'designer-A' : 'designer-B');

if (dryRun) {
  console.log(`design arm=${arm} run=${runN} harness=${JSON.stringify(harness)} workdir=${workdir}`);
  process.exit(0);
}

rmSync(runDir, { recursive: true, force: true });
mkdirSync(workdir, { recursive: true });
placeSpecMaterials(workdir, ensureSpecCache(outDir));

if (arm === 'B') {
  // The designer gets the pinned toolchain's own skill and catalogue, so
  // the run exercises exactly what the package ships.
  const packageRoot = join(toolchain, '..', 'yarramate');
  cpSync(join(packageRoot, 'skills', 'yarramate-architecture', 'SKILL.md'), join(workdir, 'SKILL.md'));
  cpSync(join(packageRoot, 'skills', 'yarramate-architecture', 'references'), join(workdir, 'references'), { recursive: true });
  mkdirSync(join(workdir, 'catalogue'), { recursive: true });
  cpSync(join(packageRoot, 'catalogues', 'core-enrichment.yaml'), join(workdir, 'catalogue', 'core-enrichment.yaml'));
}

writeFileSync(join(runDir, 'prompt.txt'), prompt);
const { result, durationMs, metrics } = runHarness(harness, workdir, prompt, arm === 'B' ? toolchain : undefined);
saveTranscript(runDir, result);

// Deliverable gates: a design run that produced no scoreable artifact is
// recorded as failed rather than silently passed downstream.
let deliverable = null;
if (arm === 'A') {
  const ok = existsSync(join(workdir, 'DESIGN.md'))
    && readFileSync(join(workdir, 'DESIGN.md'), 'utf8').includes('## Components');
  deliverable = { kind: 'design-doc', ok };
} else {
  let checkOk = false;
  let interrogate = null;
  try {
    execFileSync(join(toolchain, 'yarramate'), ['check', '.yarramate/workspace.yaml'], { cwd: workdir, stdio: 'pipe' });
    checkOk = true;
    interrogate = JSON.parse(execFileSync(
      join(toolchain, 'yarramate'),
      ['interrogate', 'catalogue/core-enrichment.yaml', '.yarramate/workspace.yaml', '--json'],
      { cwd: workdir, encoding: 'utf8' },
    )).summary;
  } catch {
    checkOk = false;
  }
  let briefs = null;
  if (checkOk) {
    briefs = JSON.parse(execFileSync('node', [
      join(import.meta.dirname, 'render-briefs.mjs'),
      '--workdir', workdir,
      '--toolchain', toolchain,
      '--out', join(runDir, 'briefs'),
    ], { encoding: 'utf8' })).rendered;
  }
  deliverable = { kind: 'workspace', ok: checkOk && (briefs?.length ?? 0) > 0, interrogate, briefs };
}

record(outDir, {
  phase: 'design', arm, run: Number(runN),
  exitCode: result.status, durationMs, metrics, deliverable, runDir,
});
console.log(JSON.stringify({ arm, run: Number(runN), deliverable, metrics }, null, 2));
