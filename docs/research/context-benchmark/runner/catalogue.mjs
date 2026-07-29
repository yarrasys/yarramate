// Shared helper: open-question count of a workspace under the core-enrichment
// catalogue, via the reference evaluator. Returns null (never throws) when the
// workspace does not compile or the evaluator output is unrecognisable.

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const catalogueDir = join(repoRoot, 'docs/research/question-catalogue');

export const catalogueOpen = (toolchainDir, workspaceDir, scratchDir, cataloguePath = join(catalogueDir, 'core-enrichment.yaml')) => {
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
    return open ? Number(open[1]) : null;
  } catch {
    return null;
  }
};
