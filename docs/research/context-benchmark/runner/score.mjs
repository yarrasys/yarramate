// Scoring for benchmark runs (DESIGN.md, "Metrics").
// Deterministic metrics are computed here; ground-truth and rubric items are
// emitted to an adjudication queue for a human — this script never judges
// free-form agent output.
//
// Per run record from runs.jsonl:
// - model-maintenance: run the pinned CLI against the post-run workspace and
//   evaluate the task's `expect` list (check-pass, no-contradicted,
//   catalogue-not-worse, likec4-check-pass);
// - change: compute the wrong-file edit rate (files changed vs the task's
//   `touches` paths) from the workdir's git diff against the baseline commit;
// - comprehension/change verdicts: append to adjudication-queue.jsonl with the
//   ground truth or rubric attached.
//
// Usage: node score.mjs --runs <runs.jsonl> --suite <suite.yaml> --toolchain <bin-dir> [--catalogue <catalogue.yaml>]

import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { catalogueOpen } from './catalogue.mjs';
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
const cataloguePath = opt('catalogue', join(repoRoot, 'docs/research/question-catalogue/core-enrichment.yaml'));
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
const postCatalogueOpen = (workspaceDir, cwd) => catalogueOpen(toolchain, workspaceDir, cwd, cataloguePath);

const records = readFileSync(runsPath, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
for (const record of records) {
  const task = tasksById.get(record.task);
  if (!task) continue;
  const workdir = join(record.runDir, 'repo');
  const workspaceDir = join(workdir, '.yarramate');
  const score = { ...record, deterministic: null, wrongFiles: null, adjudication: false };

  if (task.family === 'change' && existsSync(workdir)) {
    const changed = execFileSync('git', ['diff', '--name-only', 'HEAD'], { cwd: workdir, encoding: 'utf8' })
      .trim().split('\n').filter(Boolean).filter((f) => !f.startsWith('.yarramate'));
    const expected = task.touches.filter((t) => t.includes('/') || t.includes('.'));
    score.wrongFiles = {
      changed,
      expected,
      unexpected: changed.filter((f) => !expected.some((e) => f === e || f.startsWith(e))),
    };
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
      } else if (expectation === 'catalogue-not-worse') {
        const baseline = record.catalogueBaseline ?? null;
        const after = postCatalogueOpen(workspaceDir, workdir);
        results[expectation] = baseline === null || after === null ? null : after <= baseline;
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
      wrongFiles: score.wrongFiles,
    })}\n`);
  }

  appendFileSync(scoresPath, `${JSON.stringify(score)}\n`);
}

console.log(`scored ${records.length} runs -> ${scoresPath}; adjudication queue -> ${queuePath}`);
