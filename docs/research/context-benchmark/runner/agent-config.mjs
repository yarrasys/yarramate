// Agent configuration in a prepared workdir: the subject repository's own, and
// the pointer the harness deliberately places.
//
// Subject repositories ship agent configuration that coding harnesses auto-load
// (uptime-kuma's upstream CLAUDE.md instructs agents to refuse the work; the
// 2026-07-29 sweep lost four weak-tier runs to it and no strong-tier ones). That
// makes it a tier-dependent confound, not a property of the condition under
// test, so the runner moves it out of the workdir before the run and records
// what it moved. Keeping it is an explicit realism choice, not the default.
//
// Ordering is load-bearing: quarantine strips the *subject's* files first, then
// the harness writes YarraMate's own pointer into the same names for
// model-bearing conditions (ADR 0045 delivers it to every file a harness
// auto-loads). Reversing the two would quarantine the pointer.

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

// Paths a coding harness reads without being asked. Files and directories both;
// matched by name at any depth, because nested CLAUDE.md files load when the
// agent works in that subtree.
export const SUBJECT_AGENT_CONFIG = ['AGENTS.md', 'AGENT.md', 'CLAUDE.md', 'CLAUDE.local.md', '.claude', '.mcp.json'];

// ADR 0045: `init` delivers one identical pointer section to every file a
// harness auto-loads. The delivery list is read back from a probe init rather
// than hardcoded, so a pinned toolchain that predates ADR 0045 places exactly
// what that toolchain would have placed.
export const POINTER_FILES = ['AGENTS.md', 'CLAUDE.md'];

const walk = (root, relative, found) => {
  for (const entry of readdirSync(join(root, relative), { withFileTypes: true })) {
    if (entry.name === '.git') continue;
    const path = relative ? join(relative, entry.name) : entry.name;
    if (SUBJECT_AGENT_CONFIG.includes(entry.name)) {
      found.push(path);
      continue;
    }
    if (entry.isDirectory()) walk(root, path, found);
  }
  return found;
};

// Moves (never deletes) the subject repository's agent configuration out of the
// workdir, preserving its relative layout under quarantineDir for audit.
// Returns the workdir-relative paths that were moved, sorted.
export const quarantineAgentConfig = (workdir, quarantineDir) => {
  const found = walk(workdir, '', []).sort();
  for (const relative of found) {
    const target = join(quarantineDir, relative);
    mkdirSync(dirname(target), { recursive: true });
    renameSync(join(workdir, relative), target);
  }
  return found;
};

export const readPointerFiles = (probeDir) =>
  POINTER_FILES.filter((name) => existsSync(join(probeDir, name)))
    .map((name) => [name, readFileSync(join(probeDir, name), 'utf8')]);

// Appends to whatever the workdir already has, matching `init`'s own safety
// rule. After quarantine there is nothing to append to, which is the point.
export const placePointerFiles = (workdir, pointers) => {
  for (const [name, text] of pointers) {
    const path = join(workdir, name);
    const existing = existsSync(path) ? `${readFileSync(path, 'utf8').replace(/\n*$/, '')}\n\n` : '';
    writeFileSync(path, `${existing}${text}`);
  }
  return pointers.map(([name]) => name);
};
