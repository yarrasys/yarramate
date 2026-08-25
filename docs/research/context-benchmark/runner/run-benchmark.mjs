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
//     [--harness 'claude -p --output-format json'] [--keep-subject-agent-config] \
//     [--dry-run] [--resume]
//
// --resume skips matrix cells that already have a record in <out>/runs.jsonl
// (same suite, label, condition, task). A killed sweep appends no record for
// the run it died in, so rerunning with --resume picks up exactly where it
// stopped; the 2026-07-29 sweep lost seven tail runs to a session cap and had
// to be retried by hand.
//
// The harness command receives the composed prompt on stdin and runs with the
// task workdir as cwd. Anything printed to stdout is captured as the transcript.

import { execSync, execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, rmSync, cpSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONDITIONS } from './conditions.mjs';
import { catalogueSnapshot } from './catalogue.mjs';
import { placePointerFiles, quarantineAgentConfig, readPointerFiles } from './agent-config.mjs';
import { isDegenerateRun } from './degenerate.mjs';

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
  console.error('usage: run-benchmark.mjs --suite <suite.yaml> --out <dir> [--gallery <dir>] [--toolchain <bin-dir>] [--conditions A,B,C] [--tasks id,id] [--label tier] [--harness <cmd>] [--keep-subject-agent-config] [--dry-run]');
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
const resume = flag('resume');
const agentConfigPolicy = flag('keep-subject-agent-config') ? 'keep' : 'neutralize';

// A retired suite has lost the model its model-bearing conditions place, so
// those conditions would fail later on a missing directory. Refuse them here,
// by name, and let any condition the suite still supports through: the tasks
// were verified against the subject source at the pinned commit, not the model.
if (suite.retired) {
  const blocked = conditionIds.filter((id) => suite.retired.conditions.includes(id));
  if (blocked.length) {
    const message =
      `suite ${suite.suite} was retired on ${suite.retired.since}; ` +
      `condition${blocked.length > 1 ? 's' : ''} ${blocked.join(',')} cannot run.\n` +
      `  ${suite.retired.reason.trim().replace(/\s+/g, ' ')}`;
    // A dry run has no side effects and no cost, so it stays useful for
    // inspecting a retired corpus; only a live run is refused.
    if (dryRun) {
      console.error(`run-benchmark: warning: ${message}`);
    } else {
      console.error(`run-benchmark: ${message}`);
      process.exit(2);
    }
  }
}

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
  console.log(`suite=${suite.suite} type=${suite.type} label=${label} harness=${JSON.stringify(harness)} agent-config=${agentConfigPolicy} runs=${matrix.length}`);
  for (const { conditionId, task } of matrix) console.log(`  ${conditionId} ${task.family.padEnd(17)} ${task.id}`);
  process.exit(0);
}

if (!toolchain) {
  console.error('run-benchmark: --toolchain <dir with pinned yarramate bins> is required for live runs (conditions B/C verification)');
  process.exit(2);
}

// Provenance: the 2026-07-29 sweep recorded no toolchain version anywhere in
// runs.jsonl — the version under test lived only in the results write-up. The
// gallery model is likewise unpinned by the suite schema (a path, not a SHA),
// so the clone's HEAD is captured here.
const toolchainVersion = execFileSync(join(toolchain, 'yarramate'), ['--version'], { encoding: 'utf8' }).trim();
const galleryCommit = suite.repository.gallery
  ? execSync('git rev-parse HEAD', { cwd: galleryDir, encoding: 'utf8' }).trim()
  : null;

mkdirSync(outDir, { recursive: true });
const cacheDir = join(outDir, 'cache', suite.suite);
if (!existsSync(cacheDir)) {
  mkdirSync(cacheDir, { recursive: true });
  execSync('git init -q', { cwd: cacheDir });
  execFileSync('git', ['fetch', '-q', '--depth', '1', suite.repository.source, suite.repository.commit], { cwd: cacheDir });
  execSync('git checkout -q FETCH_HEAD', { cwd: cacheDir });
}

// Model-bearing workdirs also get the pointer that `yarramate init` writes
// (ADR 0040, delivered per ADR 0045): an adopted repository advertises its
// workspace to agent harnesses, and condition B/C should look like an adopted
// repository. Both the delivery list and the text are captured once from a
// fresh init with the pinned toolchain, so the runner places what that
// toolchain places and nothing else.
let pointers = null;
const pointerFiles = () => {
  if (pointers === null) {
    const probeDir = join(outDir, 'cache', '.agents-probe');
    if (!existsSync(join(probeDir, 'AGENTS.md'))) {
      mkdirSync(probeDir, { recursive: true });
      execFileSync(join(toolchain, 'yarramate'), ['init', '.'], { cwd: probeDir, stdio: 'ignore' });
    }
    pointers = readPointerFiles(probeDir);
  }
  return pointers;
};

const runsPath = join(outDir, 'runs.jsonl');
const recorded = new Set();
if (resume && existsSync(runsPath)) {
  for (const line of readFileSync(runsPath, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const record = JSON.parse(line);
    recorded.add(`${record.suite}|${record.label}|${record.condition}|${record.task}`);
  }
}

for (const [index, { conditionId, condition, task }] of matrix.entries()) {
  if (resume && recorded.has(`${suite.suite}|${label}|${conditionId}|${task.id}`)) {
    console.log(`[${index + 1}/${matrix.length}] ${suite.suite} ${conditionId} ${task.id} — already recorded, skipped`);
    continue;
  }
  const runDir = join(outDir, suite.suite, label, conditionId, task.id);
  const workdir = join(runDir, 'repo');
  rmSync(runDir, { recursive: true, force: true });
  mkdirSync(runDir, { recursive: true });
  cpSync(cacheDir, workdir, { recursive: true });

  // Before anything the harness places: the subject's own agent config is a
  // tier-dependent confound (agent-config.mjs). Quarantined outside the
  // workdir so the agent cannot read it either, and always before the pointer
  // is written into the same file names.
  const neutralized = agentConfigPolicy === 'keep'
    ? null
    : quarantineAgentConfig(workdir, join(runDir, '.benchmark-quarantined'));

  const workspaceDir = join(workdir, '.yarramate');
  rmSync(workspaceDir, { recursive: true, force: true });
  let catalogueBaseline = null;
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
    placePointerFiles(workdir, pointerFiles());
    catalogueBaseline = catalogueSnapshot(toolchain, workspaceDir, runDir);
  }
  execSync('git add -A && git -c user.email=bench@local -c user.name=bench commit -qm baseline --allow-empty', { cwd: workdir });
  const baselineCommit = execSync('git rev-parse HEAD', { cwd: workdir, encoding: 'utf8' }).trim();

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
    suiteType: suite.type,
    headline: suite.headline,
    toolchainVersion,
    galleryCommit,
    label,
    condition: conditionId,
    task: task.id,
    family: task.family,
    exitCode: result.status,
    durationMs,
    metrics,
    degenerate: isDegenerateRun(task.family, metrics),
    agentConfig: { policy: agentConfigPolicy, neutralized },
    catalogueBaseline,
    baselineCommit,
    runDir,
    finishedAt: new Date().toISOString(),
  })}\n`);
}

console.log(`done: ${matrix.length} runs appended to ${runsPath}`);
