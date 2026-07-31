// Shared plumbing for the spec-build family runners. Mirrors the sweep
// runner's conventions (../../runner/run-benchmark.mjs): explicit options,
// nothing runs without a harness command, one jsonl record per run.

import { execFileSync, execSync, spawnSync } from 'node:child_process';
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const here = dirname(fileURLToPath(import.meta.url));
export const familyRoot = join(here, '..');
export const repoRoot = join(here, '..', '..', '..', '..', '..');

// The pinned base spec (SPEC-DELTA.md is the authority; keep in sync).
export const SPEC_REPO = 'https://github.com/gothinkster/realworld';
export const SPEC_COMMIT = '98f29fb3f8bcb1dd614b91f2851371bf22c34775';

export const opt = (args, name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
export const flag = (args, name) => args.includes(`--${name}`);

// One pinned clone per results directory; every workdir copies from it.
export const ensureSpecCache = (outDir) => {
  const cacheDir = join(outDir, 'cache', 'realworld');
  if (!existsSync(join(cacheDir, 'specs'))) {
    mkdirSync(cacheDir, { recursive: true });
    execSync('git init -q', { cwd: cacheDir });
    execFileSync('git', ['fetch', '-q', '--depth', '1', SPEC_REPO, SPEC_COMMIT], { cwd: cacheDir });
    execSync('git checkout -q FETCH_HEAD', { cwd: cacheDir });
  }
  return cacheDir;
};

// Every phase's workdir carries the same spec materials: the OpenAPI spec,
// the upstream conformance suite, the frozen delta, and its acceptance
// tests. Constant across arms by construction.
export const placeSpecMaterials = (workdir, cacheDir) => {
  const spec = join(workdir, 'spec');
  mkdirSync(spec, { recursive: true });
  cpSync(join(cacheDir, 'specs', 'api', 'openapi.yml'), join(spec, 'openapi.yml'));
  cpSync(join(cacheDir, 'specs', 'api', 'hurl'), join(spec, 'hurl'), { recursive: true });
  cpSync(join(familyRoot, 'SPEC-DELTA.md'), join(spec, 'SPEC-DELTA.md'));
  cpSync(join(familyRoot, 'delta-hurl'), join(spec, 'delta-hurl'), { recursive: true });
};

export const runHarness = (harness, workdir, prompt, extraPath) => {
  const started = Date.now();
  const result = spawnSync('bash', ['-lc', harness], {
    cwd: workdir,
    input: prompt,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, PATH: extraPath ? `${extraPath}:${process.env.PATH}` : process.env.PATH },
  });
  const durationMs = Date.now() - started;
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
  return { result, durationMs, metrics };
};

export const record = (outDir, entry) => {
  mkdirSync(outDir, { recursive: true });
  appendFileSync(join(outDir, 'runs.jsonl'), `${JSON.stringify({ ...entry, finishedAt: new Date().toISOString() })}\n`);
};

export const saveTranscript = (runDir, result) => {
  writeFileSync(join(runDir, 'transcript.json'), result.stdout ?? '');
  writeFileSync(join(runDir, 'stderr.log'), result.stderr ?? '');
};

// Planned concepts (id + name) from a compiled workspace — the declared
// component list arms B and C are scored against.
export const plannedConcepts = (toolchain, workspaceDir) => {
  const graph = JSON.parse(execFileSync(
    join(toolchain, 'yarramate'),
    ['compile', join(workspaceDir, 'workspace.yaml')],
    { encoding: 'utf8', cwd: dirname(workspaceDir) },
  ));
  const planned = new Set(
    graph.claims
      .filter((claim) => claim.predicate === 'yarramate/lifecycle/status' && claim.object.value === 'planned')
      .map((claim) => claim.subject),
  );
  const names = new Map();
  for (const claim of graph.claims) {
    if (claim.predicate === 'yarramate/concept/name' && planned.has(claim.subject)) {
      names.set(claim.subject, claim.object.value);
    }
  }
  return [...planned].sort().map((id) => ({ id, name: names.get(id) ?? id.split('#').pop() }));
};

export const readPrompt = (name, substitutions = {}) => {
  let text = readFileSync(join(familyRoot, 'prompts', `${name}.md`), 'utf8');
  for (const [key, value] of Object.entries(substitutions)) {
    text = text.replaceAll(`{{${key}}}`, value);
  }
  return text;
};
