// Scoring for benchmark runs (DESIGN.md, "Metrics").
// Deterministic metrics are computed here; ground-truth and rubric items are
// emitted to an adjudication queue for a human — this script never judges
// free-form agent output.
//
// Per run record from runs.jsonl:
// - every run with a workdir: stage the working tree and write diff.patch
//   against the pinned baseline commit;
// - model-maintenance: run the pinned CLI against the post-run workspace and
//   evaluate the task's `expect` list (check-pass, no-contradicted,
//   catalogue-not-worse, catalogue-density-not-worse, likec4-check-pass);
// - change: compute the wrong-file edit rate (files changed vs the task's
//   `touches` paths) from the same staged diff;
// - comprehension/change verdicts: append to adjudication-queue.jsonl with the
//   ground truth or rubric attached.
//
// Usage: node score.mjs --runs <runs.jsonl> --suite <suite.yaml> --toolchain <bin-dir> [--catalogue <catalogue.yaml>]

import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { catalogueSnapshot } from './catalogue.mjs';
import { DEGENERATE_MIN_TURNS, isDegenerateRun } from './degenerate.mjs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..');
const require = createRequire(join(repoRoot, 'package.json'));
const YAML = require('yaml');

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const runsPath = opt('runs');
const suitePath = opt('suite');
const toolchain = opt('toolchain');
// Default null = the pinned toolchain's shipped catalogue, matching what
// run-benchmark.mjs recorded as the baseline; --catalogue overrides both only
// if passed to both sides.
const cataloguePath = opt('catalogue', null);
if (!runsPath || !suitePath || !toolchain) {
  console.error('usage: score.mjs --runs <runs.jsonl> --suite <suite.yaml> --toolchain <bin-dir> [--catalogue <catalogue.yaml>]');
  process.exit(2);
}

const suite = YAML.parse(readFileSync(suitePath, 'utf8'));
const tasksById = new Map(suite.tasks.map((t) => [t.id, t]));
const outDir = dirname(runsPath);
const scoresPath = join(outDir, 'scores.jsonl');
const queuePath = join(outDir, 'adjudication-queue.jsonl');
writeFileSync(scoresPath, '');
writeFileSync(queuePath, '');

const cli = (bin, cmdArgs, cwd) => {
  try {
    return { out: execFileSync(join(toolchain, bin), cmdArgs, { encoding: 'utf8', cwd, maxBuffer: 64 * 1024 * 1024 }), code: 0 };
  } catch (error) {
    return { out: `${error.stdout ?? ''}${error.stderr ?? ''}`, code: error.status ?? 1 };
  }
};
const postCatalogueSnapshot = (workspaceDir, cwd) => catalogueSnapshot(toolchain, workspaceDir, cwd, cataloguePath);
const git = (cmdArgs, cwd) => execFileSync('git', cmdArgs, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

// `git diff HEAD` saw neither the files an agent added (add-provider tasks
// create whole modules) nor the work it committed. Staging everything and
// diffing the index against the run's pinned baseline commit captures both.
const baselineOf = (record, workdir) => {
  if (record.baselineCommit) return record.baselineCommit;
  // Sweeps that predate the recorded sha: "baseline" is the only commit the
  // runner authors, so its message identifies it.
  return git(['rev-list', '-1', '--grep=^baseline$', 'HEAD'], workdir).trim() || 'HEAD';
};

// Sweeps that predate the concept count store a bare open-question number.
const asSnapshot = (value) => (typeof value === 'number' ? { open: value, concepts: null } : value ?? null);

const catalogueVerdict = (expectation, baseline, after) => {
  if (baseline === null || after === null) return null;
  if (expectation === 'catalogue-not-worse') return after.open <= baseline.open;
  if (baseline.concepts === null || after.concepts === null) return null;
  // Open questions are counted once per matching subject, so declaring the
  // concept an additive task asks for mechanically opens more of them — and
  // owner-missing (authority: human) cannot honestly be closed for a
  // third-party repository at all. Density keeps the intent, that new
  // inventory is enriched to the standard of the model it joins, without
  // punishing the requested behaviour. Cross-multiplied to stay in integers.
  return after.open * baseline.concepts <= baseline.open * after.concepts;
};

const records = readFileSync(runsPath, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
const degenerate = [];
for (const record of records) {
  const task = tasksById.get(record.task);
  if (!task) continue;
  const workdir = join(record.runDir, 'repo');
  const workspaceDir = join(workdir, '.yarramate');
  const score = {
    ...record,
    degenerate: record.degenerate ?? isDegenerateRun(record.family, record.metrics),
    deterministic: null,
    wrongFiles: null,
    adjudication: false,
  };

  if (existsSync(join(workdir, '.git'))) {
    const baseline = baselineOf(record, workdir);
    git(['add', '-A'], workdir);
    writeFileSync(join(record.runDir, 'diff.patch'), git(['diff', '--cached', baseline], workdir));

    if (task.family === 'change') {
      const changed = git(['diff', '--cached', '--name-only', baseline], workdir)
        .trim().split('\n').filter(Boolean).filter((f) => !f.startsWith('.yarramate'));
      const expected = task.touches.filter((t) => t.includes('/') || t.includes('.'));
      score.wrongFiles = {
        changed,
        expected,
        unexpected: changed.filter((f) => !expected.some((e) => f === e || f.startsWith(e))),
      };
    }
  }

  if (task.family === 'model-maintenance' && existsSync(workspaceDir)) {
    const results = {};
    for (const expectation of task.scoring.deterministic.expect) {
      if (expectation === 'check-pass') {
        const check = cli('yarramate', ['check', join(workspaceDir, 'workspace.yaml'), '--json'], workdir);
        results[expectation] = check.code === 0 && (() => { try { return JSON.parse(check.out).ok === true; } catch { return false; } })();
      } else if (expectation === 'no-contradicted') {
        const reconcile = cli('yarramate', ['reconcile', join(workspaceDir, 'workspace.yaml')], workdir);
        try {
          results[expectation] = JSON.parse(reconcile.out).summary.contradicted === 0;
        } catch {
          results[expectation] = null;
        }
      } else if (expectation === 'likec4-check-pass') {
        const projectPath = '.yarramate/integrations/likec4/project.yaml';
        if (existsSync(join(workdir, projectPath))) {
          const check = cli('yarramate-likec4', ['check', projectPath, '--json', '.yarramate/workspace.yaml'], workdir);
          results[expectation] = check.code === 0;
        } else {
          results[expectation] = null;
        }
      } else if (expectation === 'catalogue-not-worse' || expectation === 'catalogue-density-not-worse') {
        const baseline = asSnapshot(record.catalogueBaseline);
        const after = postCatalogueSnapshot(workspaceDir, workdir);
        results[expectation] = catalogueVerdict(expectation, baseline, after);
        score.catalogue = { baseline, after };
      }
    }
    score.deterministic = results;
  }

  if (task.family === 'comprehension' || task.family === 'change') {
    score.adjudication = true;
    appendFileSync(queuePath, `${JSON.stringify({
      suite: record.suite,
      label: record.label,
      condition: record.condition,
      task: task.id,
      family: task.family,
      prompt: task.prompt,
      groundTruth: task.groundTruth ?? null,
      rubric: task.scoring.rubric ?? null,
      transcript: join(record.runDir, 'transcript.json'),
      diff: join(record.runDir, 'diff.patch'),
      wrongFiles: score.wrongFiles,
      degenerate: score.degenerate,
    })}\n`);
  }

  appendFileSync(scoresPath, `${JSON.stringify(score)}\n`);
  if (score.degenerate) degenerate.push(`${record.label}/${record.condition}/${record.task}`);
}

console.log(`scored ${records.length} runs -> ${scoresPath}; adjudication queue -> ${queuePath}`);
if (degenerate.length > 0) {
  console.log(`degenerate (< ${DEGENERATE_MIN_TURNS} turns, review before scoring): ${degenerate.join(', ')}`);
}
