// The conformance gate: start the implementation's run.sh, wait for it to
// answer, run the upstream Hurl suite and the delta suite, stop the server.
// A gate, never a ranking (DESIGN-HANDOFF-FAMILY.md): output is pass/fail
// per suite plus the failing files.
//
// Usage:
//   node conformance.mjs --workdir <impl-workdir> [--port 3199] [--suites upstream,delta]
// Prints a JSON summary to stdout; exit 0 iff every requested suite passed.

import { spawn, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { opt } from './lib.mjs';

const args = process.argv.slice(2);
const workdir = opt(args, 'workdir');
const port = opt(args, 'port', '3199');
const suites = opt(args, 'suites', 'upstream,delta').split(',');
if (!workdir) {
  console.error('usage: conformance.mjs --workdir <impl-workdir> [--port <p>] [--suites upstream,delta]');
  process.exit(2);
}

const host = `http://localhost:${port}`;
const server = spawn('bash', ['run.sh'], {
  cwd: workdir,
  env: { ...process.env, PORT: port },
  stdio: ['ignore', 'pipe', 'pipe'],
  detached: true,
});
let serverLog = '';
server.stdout.on('data', (chunk) => { serverLog += chunk; });
server.stderr.on('data', (chunk) => { serverLog += chunk; });

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let up = false;
for (let attempt = 0; attempt < 120; attempt += 1) {
  try {
    await fetch(`${host}/api/tags`);
    up = true;
    break;
  } catch {
    await wait(500);
  }
}

const results = {};
if (up) {
  const uid = `${Date.now()}`;
  for (const suite of suites) {
    const dir = suite === 'upstream' ? join(workdir, 'spec', 'hurl') : join(workdir, 'spec', 'delta-hurl');
    const run = spawnSync('bash', ['-c', `hurl --test --jobs 1 --variable host=${host} --variable uid=${uid}_${suite} "${dir}"/*.hurl`], {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    });
    results[suite] = {
      ok: run.status === 0,
      report: (run.stderr ?? '').split('\n').filter((line) => line.includes('hurl') || line.includes('Success') || line.includes('Fail')).slice(-20),
    };
  }
} else {
  for (const suite of suites) results[suite] = { ok: false, report: ['server never answered'] };
}

try {
  process.kill(-server.pid, 'SIGTERM');
} catch {
  try { server.kill('SIGTERM'); } catch { /* already gone */ }
}

const ok = up && suites.every((suite) => results[suite].ok);
console.log(JSON.stringify({ ok, up, results, serverLogTail: serverLog.split('\n').slice(-15) }, null, 2));
process.exit(ok ? 0 : 1);
