// Renders the implementer handoff for arms B and C: prose briefs composed
// mechanically from a designer workspace (context --brief, ADR 0055). One
// brief for the target projection when the designer authored one, plus one
// ad-hoc neighbourhood brief per planned concept. Deterministic: rendering
// twice from the same workspace is byte-identical, so the handoff carries
// no hand of ours.
//
// Usage:
//   node render-briefs.mjs --workdir <designer-workdir> --toolchain <bins> --out <briefs-dir>

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { opt, plannedConcepts } from './lib.mjs';

const args = process.argv.slice(2);
const workdir = opt(args, 'workdir');
const toolchain = opt(args, 'toolchain');
const out = opt(args, 'out');
if (!workdir || !toolchain || !out) {
  console.error('usage: render-briefs.mjs --workdir <designer-workdir> --toolchain <bins> --out <briefs-dir>');
  process.exit(2);
}

const cli = join(toolchain, 'yarramate');
const manifest = '.yarramate/workspace.yaml';
mkdirSync(out, { recursive: true });

const rendered = [];
const targetProjection = '.yarramate/projections/target.yaml';
if (existsSync(join(workdir, targetProjection))) {
  const brief = execFileSync(cli, ['context', targetProjection, manifest, '--brief'], { cwd: workdir, encoding: 'utf8' });
  writeFileSync(join(out, 'brief-target.md'), brief);
  rendered.push('brief-target.md');
}

for (const concept of plannedConcepts(toolchain, join(workdir, '.yarramate'))) {
  const local = concept.id.split('#').pop();
  const brief = execFileSync(
    cli,
    ['context', '--subject', concept.id, manifest, '--brief'],
    { cwd: workdir, encoding: 'utf8' },
  );
  writeFileSync(join(out, `brief-${local}.md`), brief);
  rendered.push(`brief-${local}.md`);
}

console.log(JSON.stringify({ rendered }, null, 2));
