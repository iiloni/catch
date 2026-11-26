import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';

const scripts = import.meta.dirname;
const library = join(scripts, 'worktree-processes.sh');
const hasProc = existsSync('/proc/self/stat');

// A primary checkout and one worktree beside it, as worktree.sh lays them out.
let base = '';
let primary = '';
let worktree = '';
let removable = '';
const started: number[] = [];

before(() => {
  if (!hasProc) return;
  base = realpathSync(mkdtempSync(join(tmpdir(), 'catch-processes-')));
  primary = join(base, 'catch');
  worktree = join(base, 'catch-feature');
  removable = join(base, 'catch-removable');
  mkdirSync(join(primary, 'scripts'), { recursive: true });
  for (const script of ['worktree.sh', 'worktree-processes.sh']) {
    copyFileSync(join(scripts, script), join(primary, 'scripts', script));
  }
  writeFileSync(join(primary, '.gitignore'), 'node_modules/\n');
  const git = (...args: string[]) => execFileSync('git', args, { cwd: primary });
  git('init', '-q');
  mkdirSync(join(primary, 'apps/web'), { recursive: true });
  writeFileSync(join(primary, 'apps/web/interrupted'), 'interrupted\n');
  git('add', '.');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'init');
  git('worktree', 'add', '-q', worktree);
  git('worktree', 'add', '-q', removable);
  for (const checkout of [primary, worktree, removable]) {
    // Stands in for Capacitor's CLI: leaves a mark when interrupted, as live reload
    // restores its config on SIGINT, and keeps a child running like Gradle.
    const cap = join(checkout, 'apps/web/node_modules/.bin/cap');
    mkdirSync(join(checkout, 'apps/web/node_modules/.bin'), { recursive: true });
    writeFileSync(
      cap,
      '#!/usr/bin/env bash\ntrap \'echo interrupted > "$PWD/interrupted"; exit 0\' INT\nsleep 300 & wait\n',
    );
    chmodSync(cap, 0o755);
  }
});

after(() => {
  for (const pid of started) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {}
  }
  if (base) rmSync(base, { recursive: true, force: true });
});

function startProcess(command: string, args: string[], cwd: string): number {
  const child = spawn(command, args, { cwd, stdio: 'ignore', detached: true });
  child.unref();
  assert.ok(child.pid);
  started.push(child.pid);
  return child.pid;
}

function running(pid: number): boolean {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    return stat.slice(stat.lastIndexOf(')') + 2)[0] !== 'Z';
  } catch {
    return false;
  }
}

function childrenOf(pid: number): number[] {
  return readFileSync(`/proc/${pid}/task/${pid}/children`, 'utf8')
    .split(' ')
    .filter(Boolean)
    .map(Number);
}

async function waitFor(check: () => boolean) {
  for (let attempt = 0; attempt < 50 && !check(); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(check());
}

// Runs the cleanup the way dev.sh does, under a parent that itself looks like a live-reload
// session in the worktree and is recorded in its pidfile.
function stopProcesses(target: string): string {
  return execFileSync(
    'bash',
    [
      '-c',
      'bash -c \'source "$1"; read_proc_stat "$PPID"; echo "$PPID $stat_start" > "$(android_pidfile "$2")"; stop_worktree_processes "$2"\' inner "$3" "$4"; echo survived',
      'cap',
      'run',
      'android',
      library,
      target,
    ],
    { cwd: worktree, encoding: 'utf8', env: { ...process.env, CATCH_STOP_PROCESS_POLLS: '5' } },
  );
}

test('stops the worktree live-reload session and leaves other processes alone', {
  skip: !hasProc && 'needs /proc',
}, async () => {
  const cap = join(worktree, 'apps/web/node_modules/.bin/cap');
  writeFileSync(join(worktree, 'apps/web/interrupted'), 'live reload\n');
  const session = startProcess(
    cap,
    ['run', 'android', '--live-reload'],
    join(worktree, 'apps/web'),
  );
  // Ignores SIGINT and SIGTERM, so only the SIGKILL fallback stops it.
  const stubborn = startProcess(
    'bash',
    ['-c', "trap '' INT TERM; sleep 300 & wait; sleep 300", 'cap', 'run', 'android'],
    join(worktree, 'apps/web'),
  );
  const otherCheckout = startProcess(
    join(primary, 'apps/web/node_modules/.bin/cap'),
    ['run', 'android'],
    join(primary, 'apps/web'),
  );
  // A shell or editor working in the checkout.
  const bystander = startProcess('sleep', ['300'], worktree);
  // Mentions the command inside one argument, as a note or a prompt might.
  const mention = startProcess('bash', ['-c', 'sleep 300; true', 'cap run android'], worktree);
  await waitFor(() => childrenOf(session).length > 0);
  const gradle = childrenOf(session)[0];

  const output = stopProcesses(worktree);

  assert.match(output, /survived/);
  for (const pid of [session, gradle, stubborn]) assert.equal(running(pid), false, `${pid}`);
  for (const pid of [otherCheckout, bystander, mention]) {
    assert.equal(running(pid), true, `${pid}`);
  }
  assert.equal(readFileSync(join(worktree, 'apps/web/interrupted'), 'utf8'), 'interrupted\n');
});

test('stops a recorded dev.sh android session and its children', {
  skip: !hasProc && 'needs /proc',
}, async () => {
  // Started from elsewhere, so only the pidfile ties it to the worktree.
  const session = startProcess('bash', ['-c', 'sleep 300 & wait'], base);
  await waitFor(() => childrenOf(session).length > 0);
  const child = childrenOf(session)[0];
  const stat = readFileSync(`/proc/${session}/stat`, 'utf8');
  const startTime = stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19];
  const gitDir = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-dir'], {
    cwd: worktree,
    encoding: 'utf8',
  }).trim();
  const pidfile = join(gitDir, 'catch-android.pid');

  // A recorded PID that now belongs to another process is not stopped.
  writeFileSync(pidfile, `${session} 1\n`);
  execFileSync('bash', [
    '-c',
    'source "$1"; stop_worktree_processes "$2"',
    'test',
    library,
    worktree,
  ]);
  assert.equal(running(session), true);

  writeFileSync(pidfile, `${session} ${startTime}\n`);
  execFileSync(
    'bash',
    ['-c', 'source "$1"; stop_worktree_processes "$2"', 'test', library, worktree],
    {
      env: { ...process.env, CATCH_STOP_PROCESS_POLLS: '5' },
    },
  );
  assert.equal(running(session), false);
  assert.equal(running(child), false);
  assert.equal(existsSync(pidfile), false);
});

test('removing a worktree that was never initialized still stops its live-reload session', {
  skip: !hasProc && 'needs /proc',
}, async () => {
  writeFileSync(join(removable, 'apps/web/interrupted'), 'live reload\n');
  const session = startProcess(
    join(removable, 'apps/web/node_modules/.bin/cap'),
    ['run', 'android', '--live-reload'],
    join(removable, 'apps/web'),
  );
  const otherCheckout = startProcess(
    join(worktree, 'apps/web/node_modules/.bin/cap'),
    ['run', 'android'],
    join(worktree, 'apps/web'),
  );
  await waitFor(() => childrenOf(session).length > 0);

  // Make signal delivery fail, then retry with normal signal handling.
  const shellEnv = join(base, 'no-signals.sh');
  writeFileSync(shellEnv, 'kill() { return 1; }\n');
  const failed = spawnSync(join(primary, 'scripts/worktree.sh'), ['remove', removable, '-y'], {
    cwd: primary,
    encoding: 'utf8',
    env: { ...process.env, BASH_ENV: shellEnv, CATCH_STOP_PROCESS_POLLS: '1' },
  });
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /Refusing to remove a worktree whose processes are still running/);
  assert.ok(existsSync(removable));
  assert.ok(running(session));

  execFileSync(join(primary, 'scripts/worktree.sh'), ['remove', removable, '-y'], {
    cwd: primary,
    env: { ...process.env, CATCH_STOP_PROCESS_POLLS: '5' },
  });

  assert.equal(running(session), false);
  assert.equal(running(otherCheckout), true);
  assert.equal(existsSync(removable), false);
});

test('a session in a worktree whose path needs quoting releases its pidfile on exit', {
  skip: !hasProc && 'needs /proc',
}, () => {
  const quoted = join(base, "catch-it's $(touch injected)");
  mkdirSync(quoted);
  execFileSync('git', ['init', '-q'], { cwd: quoted });
  const output = execFileSync(
    'bash',
    [
      '-c',
      'source "$1"; record_android_session "$2"; cat "$(android_pidfile "$2")"',
      'test',
      library,
      quoted,
    ],
    { cwd: base, encoding: 'utf8' },
  );
  assert.match(output, /^\d+ \d+\n$/);
  const gitDir = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-dir'], {
    cwd: quoted,
    encoding: 'utf8',
  }).trim();
  assert.equal(existsSync(join(gitDir, 'catch-android.pid')), false);
  assert.equal(existsSync(join(base, 'injected')), false);
});
