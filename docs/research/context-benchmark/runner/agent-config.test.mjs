// Self-test for the workdir agent-configuration rules. Not part of `pnpm test`
// (this directory is a research artifact, outside the package test tree):
//   node --test 'docs/research/context-benchmark/runner/*.test.mjs'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { placePointerFiles, quarantineAgentConfig, readPointerFiles } from './agent-config.mjs';

const POINTER = '## YarraMate architecture workspace\n\nThis repository has one.\n';

const subjectRepo = () => {
  const root = mkdtempSync(join(tmpdir(), 'bench-agent-config-'));
  const workdir = join(root, 'repo');
  mkdirSync(join(workdir, 'server', '.claude'), { recursive: true });
  mkdirSync(join(workdir, '.git'), { recursive: true });
  writeFileSync(join(workdir, 'CLAUDE.md'), 'Do not use AI assistants on this repository.\n');
  writeFileSync(join(workdir, 'AGENTS.md'), 'Subject repo agent notes.\n');
  writeFileSync(join(workdir, 'server', 'CLAUDE.md'), 'Nested refusal.\n');
  writeFileSync(join(workdir, 'server', '.claude', 'settings.json'), '{}\n');
  writeFileSync(join(workdir, '.git', 'CLAUDE.md'), 'git internals, never touched.\n');
  writeFileSync(join(workdir, 'README.md'), 'Subject repo readme.\n');
  return { root, workdir, quarantine: join(root, '.benchmark-quarantined') };
};

test('quarantine moves every auto-loaded agent config out of the workdir', (t) => {
  const { root, workdir, quarantine } = subjectRepo();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const moved = quarantineAgentConfig(workdir, quarantine);

  assert.deepEqual(moved, ['AGENTS.md', 'CLAUDE.md', 'server/.claude', 'server/CLAUDE.md']);
  for (const relative of moved) {
    assert.equal(existsSync(join(workdir, relative)), false, `${relative} still in workdir`);
    assert.equal(existsSync(join(quarantine, relative)), true, `${relative} not preserved`);
  }
  assert.equal(readFileSync(join(quarantine, 'server', '.claude', 'settings.json'), 'utf8'), '{}\n');
  assert.equal(existsSync(join(workdir, 'README.md')), true, 'unrelated files must survive');
  assert.equal(existsSync(join(workdir, '.git', 'CLAUDE.md')), true, 'git internals are not agent config');
});

test('quarantine runs before pointer placement, so B/C carry only the harness pointer', (t) => {
  const { root, workdir, quarantine } = subjectRepo();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const probeDir = join(root, 'probe');
  mkdirSync(probeDir, { recursive: true });
  writeFileSync(join(probeDir, 'AGENTS.md'), POINTER);
  writeFileSync(join(probeDir, 'CLAUDE.md'), POINTER);

  quarantineAgentConfig(workdir, quarantine);
  const placed = placePointerFiles(workdir, readPointerFiles(probeDir));

  assert.deepEqual(placed, ['AGENTS.md', 'CLAUDE.md']);
  for (const name of placed) {
    assert.equal(readFileSync(join(workdir, name), 'utf8'), POINTER, `${name} must be the pointer alone`);
  }
});

test('quarantining after pointer placement would take the pointer with it', (t) => {
  const { root, workdir, quarantine } = subjectRepo();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const probeDir = join(root, 'probe');
  mkdirSync(probeDir, { recursive: true });
  writeFileSync(join(probeDir, 'AGENTS.md'), POINTER);

  quarantineAgentConfig(workdir, quarantine);
  placePointerFiles(workdir, readPointerFiles(probeDir));

  // The pointer is written after quarantine; re-running quarantine would take
  // it away, which is exactly the ordering bug the runner must not have.
  assert.deepEqual(quarantineAgentConfig(workdir, join(root, 'second-pass')), ['AGENTS.md']);
  assert.equal(existsSync(join(workdir, 'AGENTS.md')), false);
});

test('a repository with no agent config quarantines nothing', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'bench-agent-config-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const workdir = join(root, 'repo');
  mkdirSync(workdir, { recursive: true });
  writeFileSync(join(workdir, 'README.md'), 'Nothing to see.\n');

  assert.deepEqual(quarantineAgentConfig(workdir, join(root, '.benchmark-quarantined')), []);
});
