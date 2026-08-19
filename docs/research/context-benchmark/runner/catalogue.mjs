// Shared helper: catalogue snapshot of a workspace — open questions alongside
// the number of concepts they were counted over. Returns null (never throws)
// when the workspace does not compile or the output is unrecognisable; the
// failure is reported on stderr, because the 2026-07-29 → 0.7.0 break showed
// a silent null here erases a whole metric family without anyone noticing.
//
// Harness v3: the count comes from the pinned toolchain's own evaluator
// (`design --json`, shipped catalogue by default) rather than the research
// evaluator under docs/research/question-catalogue/. The research schema had
// drifted behind the product catalogue (0.8 uses fields it never learned), and
// the toolchain's evaluator is also what a condition-B/C agent actually
// experiences. Baseline (run-benchmark.mjs) and post-run (score.mjs) snapshots
// default to the same shipped catalogue, so the not-worse delta is coherent.
//
// The concept count exists because the evaluator counts subject-scoped
// questions once per matching subject: an absolute open-question total is not
// comparable across workspaces of different size (score.mjs,
// catalogue-density-not-worse).

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Enrichment targets: concept subjects minus the architecture-state subjects,
// which carry no catalogue questions.
const conceptCount = (graph) => {
  const states = new Set((graph.claims ?? [])
    .filter((claim) => claim.predicate === 'yarramate/state/type')
    .map((claim) => claim.subject));
  return (graph.subjects ?? []).filter((subject) => subject.type === 'concept' && !states.has(subject.id)).length;
};

export const catalogueSnapshot = (toolchainDir, workspaceDir, scratchDir, cataloguePath = null) => {
  try {
    const workspacePath = join(workspaceDir, 'workspace.yaml');
    // `export graph` is the seven-verb surface's compiled-graph emitter; the
    // pre-0.7.0 `compile` verb this helper first shipped against is gone.
    const graphPath = join(scratchDir, 'compiled-graph.json');
    execFileSync(join(toolchainDir, 'yarramate'), ['export', 'graph', workspacePath, '--out', graphPath], {
      encoding: 'utf8',
      maxBuffer: 512 * 1024 * 1024,
    });
    const stepArgs = ['design', workspacePath, '--json'];
    if (cataloguePath) stepArgs.push('--catalogue', cataloguePath);
    const step = JSON.parse(execFileSync(join(toolchainDir, 'yarramate'), stepArgs, {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    }));
    const open = step.progress?.open;
    if (typeof open !== 'number') {
      console.error('catalogue snapshot: design --json carried no progress.open; recording null baseline');
      return null;
    }
    return { open, concepts: conceptCount(JSON.parse(readFileSync(graphPath, 'utf8'))) };
  } catch (error) {
    console.error(`catalogue snapshot failed; recording null baseline: ${error.message ?? error}`);
    return null;
  }
};
