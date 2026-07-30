// Shared helper: catalogue snapshot of a workspace — open questions under the
// core-enrichment catalogue (via the reference evaluator) alongside the number
// of concepts they were counted over. Returns null (never throws) when the
// workspace does not compile or the evaluator output is unrecognisable.
//
// The concept count exists because the evaluator counts subject-scoped
// questions once per matching subject: an absolute open-question total is not
// comparable across workspaces of different size (score.mjs,
// catalogue-density-not-worse).

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const catalogueDir = join(repoRoot, 'docs/research/question-catalogue');

// Enrichment targets, as evaluate-catalogue.mjs defines them: concept subjects
// minus the architecture-state subjects, which carry no catalogue questions.
const conceptCount = (graph) => {
  const states = new Set((graph.claims ?? [])
    .filter((claim) => claim.predicate === 'yarramate/state/type')
    .map((claim) => claim.subject));
  return (graph.subjects ?? []).filter((subject) => subject.type === 'concept' && !states.has(subject.id)).length;
};

export const catalogueSnapshot = (toolchainDir, workspaceDir, scratchDir, cataloguePath = join(catalogueDir, 'core-enrichment.yaml')) => {
  try {
    const compiled = execFileSync(join(toolchainDir, 'yarramate'), ['compile', join(workspaceDir, 'workspace.yaml')], {
      encoding: 'utf8',
      maxBuffer: 512 * 1024 * 1024,
    });
    const graphPath = join(scratchDir, 'compiled-graph.json');
    writeFileSync(graphPath, compiled);
    const evaluated = execFileSync('node', [
      join(catalogueDir, 'evaluate-catalogue.mjs'),
      join(catalogueDir, 'yarramate-question-catalogue.schema.json'),
      cataloguePath,
      graphPath,
    ], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    const open = evaluated.match(/total open questions[^:]*:\s*(\d+)/i);
    return open ? { open: Number(open[1]), concepts: conceptCount(JSON.parse(compiled)) } : null;
  } catch {
    return null;
  }
};
