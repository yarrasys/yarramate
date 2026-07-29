// Matrix runner for one benchmark suite: tasks x conditions, sequential.
// Materializes an isolated workdir per run (pinned clone + condition-specific
// model placement), invokes a headless agent harness with the condition
// instruction + frozen task prompt, and appends one record per run to
// <out>/runs.jsonl. Scoring is a separate step (score.mjs).
//
// Runs cost real agent tokens; nothing executes without an explicit harness
// command, and --dry-run prints the full matrix without materializing anything.
//
// Usage:
//   node run-benchmark.mjs --suite tasks/<name>.yaml --gallery <gallery-repo-dir> \
//     --toolchain <dir with yarramate bins> --out <results-dir> \
//     [--conditions A,B,C] [--tasks id,id] [--label tier-name] \
//     [--harness 'claude -p --output-format json'] [--dry-run]
//
// The harness command receives the composed prompt on stdin and runs with the
// task workdir as cwd. Anything printed to stdout is captured as the transcript.

import { execSync, execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, rmSync, cpSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONDITIONS } from './conditions.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..');
const require = createRequire(join(repoRoot, 'package.json'));
const YAML = require('yaml');

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const flag = (name) => args.includes(`--${name}`);

const suitePath = opt('suite');
const outDir = opt('out');
if (!suitePath || !outDir) {
  console.error('usage: run-benchmark.mjs --suite <suite.yaml> --out <dir> [--gallery <dir>] [--toolchain <bin-dir>] [--conditions A,B,C] [--tasks id,id] [--label tier] [--harness <cmd>] [--dry-run]');
  process.exit(2);
}
const suite = YAML.parse(readFileSync(suitePath, 'utf8'));
const galleryDir = opt('gallery');
const toolchain = opt('toolchain');
const harness = opt('harness', 'claude -p --output-format json');
const label = opt('label', 'default');
const conditionIds = opt('conditions', 'A,B,C').split(',');
const onlyTasks = opt('tasks') ? new Set(opt('tasks').split(',')) : null;
const dryRun = flag('dry-run');

const modelSourceDir = () => {
  if (suite.repository.gallery && !galleryDir) {
    console.error('run-benchmark: suite references a gallery model; pass --gallery <local clone of the gallery repo>');
    process.exit(2);
  }
  const base = suite.repository.gallery ? galleryDir : repoRoot;
  const model = suite.repository.model;
  return model.endsWith('.yarramate') ? join(base, model) : join(base, model, '.yarramate');
};

const matrix = [];
for (const conditionId of conditionIds) {
  const condition = CONDITIONS[conditionId];
  if (!condition) {
    console.error(`run-benchmark: unknown condition ${conditionId}`);
    process.exit(2);
  }
  for (const task of suite.tasks) {
    if (onlyTasks && !onlyTasks.has(task.id)) continue;
    if (!condition.families.includes(task.family)) continue;
    matrix.push({ conditionId, condition, task });
  }
}

if (dryRun) {
  console.log(`suite=${suite.suite} label=${label} harness=${JSON.stringify(harness)} runs=${matrix.length}`);
  for (const { conditionId, task } of matrix) console.log(`  ${conditionId} ${task.family.padEnd(17)} ${task.id}`);
  process.exit(0);
}

if (!toolchain) {
  console.error('run-benchmark: --toolchain <dir with pinned yarramate bins> is required for live runs (conditions B/C verification)');
  process.exit(2);
}

mkdirSync(outDir, { recursive: true });
const cacheDir = join(outDir, 'cache', suite.suite);
if (!existsSync(cacheDir)) {
  mkdirSync(cacheDir, { recursive: true });
  execSync('git init -q', { cwd: cacheDir });
  execFileSync('git', ['fetch', '-q', '--depth', '1', suite.repository.source, suite.repository.commit], { cwd: cacheDir });
  execSync('git checkout -q FETCH_HEAD', { cwd: cacheDir });
}

const runsPath = join(outDir, 'runs.jsonl');
for (const [index, { conditionId, condition, task }] of matrix.entries()) {
  const runDir = join(outDir, suite.suite, label, conditionId, task.id);
  const workdir = join(runDir, 'repo');
  rmSync(runDir, { recursive: true, force: true });
  mkdirSync(runDir, { recursive: true });
  cpSync(cacheDir, workdir, { recursive: true });

  const workspaceDir = join(workdir, '.yarramate');
  rmSync(workspaceDir, { recursive: true, force: true });
  if (condition.model !== 'none') {
    cpSync(modelSourceDir(), workspaceDir, { recursive: true });
    if (condition.model === 'stale') {
      const injected = execFileSync('node', [
        join(here, 'inject-stale.mjs'),
        '--workspace', workspaceDir,
        '--cli', join(toolchain, 'yarramate'),
      ], { encoding: 'utf8' });
      writeFileSync(join(runDir, 'inject.json'), injected);
    }
  }
  execSync('git add -A && git -c user.email=bench@local -c user.name=bench commit -qm baseline --allow-empty', { cwd: workdir });

  const prompt = `${condition.instruction}\n\n${task.prompt}`;
  writeFileSync(join(runDir, 'prompt.txt'), prompt);

  console.log(`[${index + 1}/${matrix.length}] ${suite.suite} ${conditionId} ${task.id}`);
  const started = Date.now();
  const result = spawnSync('bash', ['-lc', harness], {
    cwd: workdir,
    input: prompt,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, PATH: `${toolchain}:${process.env.PATH}` },
  });
  const durationMs = Date.now() - started;
  writeFileSync(join(runDir, 'transcript.json'), result.stdout ?? '');
  writeFileSync(join(runDir, 'stderr.log'), result.stderr ?? '');

  let metrics = null;
  try {
    const parsed = JSON.parse(result.stdout);
    metrics = {
      numTurns: parsed.num_turns ?? null,
      inputTokens: parsed.usage?.input_tokens ?? null,
      outputTokens: parsed.usage?.output_tokens ?? null,
      costUsd: parsed.total_cost_usd ?? null,
    };
  } catch {
    metrics = null;
  }

  appendFileSync(runsPath, `${JSON.stringify({
    suite: suite.suite,
    headline: suite.headline,
    label,
    condition: conditionId,
    task: task.id,
    family: task.family,
    exitCode: result.status,
    durationMs,
    metrics,
    runDir,
    finishedAt: new Date().toISOString(),
  })}\n`);
}

console.log(`done: ${matrix.length} runs appended to ${runsPath}`);
