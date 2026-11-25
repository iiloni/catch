import assert from 'node:assert/strict';
import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
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
import { test } from 'node:test';

const repoRoot = realpathSync(new URL('..', import.meta.url).pathname);
const helperScript = join(repoRoot, 'scripts/worktree-processes.sh');
const devScript = join(repoRoot, 'scripts/dev.sh');
const worktreeScript = join(repoRoot, 'scripts/worktree.sh');
const gitignoreFile = join(repoRoot, '.gitignore');

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const state = stat.slice(stat.lastIndexOf(') ') + 2).trimStart()[0];
    return state !== 'Z' && state !== 'X';
  } catch {
    return true;
  }
}

async function waitForFile(path: string, timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(path)) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for file: ${path}`);
}

async function waitForExit(pid: number, timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isAlive(pid)) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for pid ${pid} to exit`);
}

function forceKillAll(children: ChildProcess[], extraPids: number[] = []): void {
  for (const pid of extraPids) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // already gone
    }
  }
  for (const child of children) {
    if (child.pid && isAlive(child.pid)) {
      try {
        process.kill(child.pid, 'SIGKILL');
      } catch {
        // already gone
      }
    }
  }
}

function runHelper(
  args: string[],
  options: { cwd?: string; env?: Record<string, string | undefined> } = {},
) {
  const result = spawnSync('bash', [helperScript, ...args], {
    cwd: options.cwd,
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      CATCH_STOP_SIGINT_WAIT_DS: '6',
      CATCH_STOP_SIGTERM_WAIT_DS: '6',
      CATCH_STOP_SIGKILL_WAIT_DS: '10',
      ...options.env,
    },
  });
  assert.ifError(result.error);
  return result;
}

test('pidfile-tracked process and its descendants receive SIGINT first and restore config cleanly', async () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'catch-wt-pidfile-')));
  const worktree = join(base, 'catch-alpha');
  const outsideDir = join(base, 'outside');
  mkdirSync(worktree, { recursive: true });
  mkdirSync(outsideDir, { recursive: true });

  const configPath = join(worktree, 'capacitor.config.ts');
  const originalConfig = 'export default { appId: "org.iloni.catchnotes" };\n';
  writeFileSync(configPath, originalConfig);

  const parentReady = join(base, 'parent.ready');
  const childReady = join(base, 'child.ready');
  const childPidFile = join(base, 'child.pid');
  const signalLog = join(base, 'signals.log');

  const childScript = join(outsideDir, 'child-worker.mjs');
  writeFileSync(
    childScript,
    `
      import { appendFileSync, writeFileSync } from 'node:fs';
      const [configPath, original, readyPath, logPath] = process.argv.slice(2);
      writeFileSync(configPath, '// temporary live-reload config\\n');
      process.on('SIGINT', () => {
        appendFileSync(logPath, 'child:SIGINT\\n');
        writeFileSync(configPath, original);
        process.exit(0);
      });
      process.on('SIGTERM', () => {
        appendFileSync(logPath, 'child:SIGTERM\\n');
        process.exit(0);
      });
      writeFileSync(readyPath, String(process.pid));
      setInterval(() => {}, 1000);
    `,
  );

  const parentScript = join(outsideDir, 'parent-wrapper.mjs');
  writeFileSync(
    parentScript,
    `
      import { spawn } from 'node:child_process';
      import { appendFileSync, writeFileSync } from 'node:fs';
      const [childScript, configPath, original, childReady, childPidFile, parentReady, logPath] = process.argv.slice(2);
      const child = spawn(process.execPath, [childScript, configPath, original, childReady, logPath], {
        cwd: ${JSON.stringify(outsideDir)},
        stdio: 'ignore',
      });
      writeFileSync(childPidFile, String(child.pid));
      process.on('SIGINT', () => {
        appendFileSync(logPath, 'parent:SIGINT\\n');
        child.on('exit', () => process.exit(0));
        if (child.exitCode !== null || child.signalCode !== null) process.exit(0);
      });
      writeFileSync(parentReady, String(process.pid));
      setInterval(() => {}, 1000);
    `,
  );

  const children: ChildProcess[] = [];
  const extraPids: number[] = [];
  try {
    const parent = spawn(
      process.execPath,
      [
        parentScript,
        childScript,
        configPath,
        originalConfig,
        childReady,
        childPidFile,
        parentReady,
        signalLog,
      ],
      { cwd: outsideDir, stdio: 'ignore' },
    );
    children.push(parent);
    await waitForFile(parentReady);
    await waitForFile(childReady);

    const parentPid = parent.pid!;
    const childPid = Number(readFileSync(childPidFile, 'utf8').trim());
    extraPids.push(childPid);

    // Record the parent PID via the helper (includes starttime for PID-reuse protection).
    const writeRes = runHelper(['write-pid', worktree, String(parentPid)]);
    assert.equal(writeRes.status, 0, writeRes.stderr);
    assert.ok(existsSync(join(worktree, '.dev-android.pid')));
    assert.equal(readFileSync(configPath, 'utf8'), '// temporary live-reload config\n');

    const stopRes = runHelper(['stop', worktree]);
    assert.equal(stopRes.status, 0, stopRes.stderr);

    await waitForExit(parentPid);
    await waitForExit(childPid);

    const signals = readFileSync(signalLog, 'utf8');
    assert.match(signals, /child:SIGINT/);
    assert.match(signals, /parent:SIGINT/);
    assert.doesNotMatch(signals, /SIGTERM/);
    assert.equal(readFileSync(configPath, 'utf8'), originalConfig);
    assert.equal(existsSync(join(worktree, '.dev-android.pid')), false);
  } finally {
    forceKillAll(children, extraPids);
    rmSync(base, { recursive: true, force: true });
  }
});

test('path-matched and cwd-matched worktree processes without pidfiles are stopped', async () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'catch-wt-scan-')));
  const worktree = join(base, 'catch-scan');
  const webDir = join(worktree, 'apps/web');
  const binDir = join(webDir, 'node_modules/.bin');
  const scriptsDir = join(worktree, 'scripts');
  const outsideDir = join(base, 'outside');
  mkdirSync(binDir, { recursive: true });
  mkdirSync(scriptsDir, { recursive: true });
  mkdirSync(outsideDir, { recursive: true });

  const waitScript = `
    import { writeFileSync } from 'node:fs';
    const readyFile = process.argv[process.argv.length - 1];
    process.on('SIGINT', () => process.exit(0));
    writeFileSync(readyFile, String(process.pid));
    setInterval(() => {}, 1000);
  `;

  // 1. Cmdline-matched: node <worktree>/apps/web/node_modules/.bin/cap run android --live-reload (cwd outside)
  const capInWt = join(binDir, 'cap');
  writeFileSync(capInWt, waitScript);

  // 2. Cwd-matched: node <outside>/cap run android --live-reload (cwd inside worktree, no worktree path in argv)
  const capOutside = join(outsideDir, 'cap');
  writeFileSync(capOutside, waitScript);

  // 3. Worktree script: bash <worktree>/scripts/dev.sh android
  const fakeDevSh = join(scriptsDir, 'dev.sh');
  writeFileSync(
    fakeDevSh,
    `#!/usr/bin/env bash
trap 'exit 0' INT TERM
printf '%s' "$$" > "$2"
while true; do sleep 0.2; done
`,
  );
  chmodSync(fakeDevSh, 0o755);

  const ready1 = join(base, 'ready1');
  const ready2 = join(base, 'ready2');
  const ready3 = join(base, 'ready3');

  const children: ChildProcess[] = [];
  try {
    const p1 = spawn(process.execPath, [capInWt, 'run', 'android', '--live-reload', ready1], {
      cwd: outsideDir,
      stdio: 'ignore',
    });
    const p2 = spawn(process.execPath, [capOutside, 'run', 'android', '--live-reload', ready2], {
      cwd: webDir,
      stdio: 'ignore',
    });
    const p3 = spawn('bash', [fakeDevSh, 'android', ready3], {
      cwd: outsideDir,
      stdio: 'ignore',
    });
    children.push(p1, p2, p3);

    await Promise.all([waitForFile(ready1), waitForFile(ready2), waitForFile(ready3)]);

    const stopRes = runHelper(['stop', worktree]);
    assert.equal(stopRes.status, 0, stopRes.stderr);

    await Promise.all([waitForExit(p1.pid!), waitForExit(p2.pid!), waitForExit(p3.pid!)]);
  } finally {
    forceKillAll(children);
    rmSync(base, { recursive: true, force: true });
  }
});

test('escalates from SIGINT to SIGTERM and then SIGKILL when processes ignore softer signals', async () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'catch-wt-escalate-')));
  const worktree = join(base, 'catch-escalate');
  const binDir = join(worktree, 'apps/web/node_modules/.bin');
  mkdirSync(binDir, { recursive: true });

  const termLog = join(base, 'term.log');
  const termReady = join(base, 'term.ready');
  const killReady = join(base, 'kill.ready');

  const ignoreIntScript = join(binDir, 'cap');
  writeFileSync(
    ignoreIntScript,
    `
      import { appendFileSync, writeFileSync } from 'node:fs';
      const [readyPath, logPath] = process.argv.slice(2);
      process.on('SIGINT', () => appendFileSync(logPath, 'SIGINT\\n'));
      process.on('SIGTERM', () => {
        appendFileSync(logPath, 'SIGTERM\\n');
        process.exit(0);
      });
      writeFileSync(readyPath, String(process.pid));
      setInterval(() => {}, 1000);
    `,
  );

  const ignoreAllScript = join(worktree, 'stubborn-worker.mjs');
  writeFileSync(
    ignoreAllScript,
    `
      import { writeFileSync } from 'node:fs';
      const [readyPath] = process.argv.slice(2);
      process.on('SIGINT', () => {});
      process.on('SIGTERM', () => {});
      writeFileSync(readyPath, String(process.pid));
      setInterval(() => {}, 1000);
    `,
  );

  const children: ChildProcess[] = [];
  try {
    const pTerm = spawn(process.execPath, [ignoreIntScript, termReady, termLog], {
      cwd: worktree,
      stdio: 'ignore',
    });
    const pKill = spawn(process.execPath, [ignoreAllScript, killReady], {
      cwd: worktree,
      stdio: 'ignore',
    });
    children.push(pTerm, pKill);

    await Promise.all([waitForFile(termReady), waitForFile(killReady)]);

    const stopRes = runHelper(['stop', worktree], {
      env: {
        CATCH_STOP_SIGINT_WAIT_DS: '3',
        CATCH_STOP_SIGTERM_WAIT_DS: '3',
        CATCH_STOP_SIGKILL_WAIT_DS: '10',
      },
    });
    assert.equal(stopRes.status, 0, stopRes.stderr);

    await Promise.all([waitForExit(pTerm.pid!), waitForExit(pKill.pid!)]);
    assert.equal(readFileSync(termLog, 'utf8'), 'SIGINT\nSIGTERM\n');
  } finally {
    forceKillAll(children);
    rmSync(base, { recursive: true, force: true });
  }
});

test('never touches sibling prefix-colliding worktrees, unrelated/agent processes, recycled pids, or ancestors', async () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'catch-wt-safety-')));
  const target = join(base, 'catch-foo');
  const sibling = join(base, 'catch-foo-bar');
  const siblingWeb = join(sibling, 'apps/web');
  const siblingBin = join(siblingWeb, 'node_modules/.bin');
  const externalDir = join(base, 'external');
  mkdirSync(target, { recursive: true });
  mkdirSync(siblingBin, { recursive: true });
  mkdirSync(externalDir, { recursive: true });

  const sleeperScript = `
    import { writeFileSync } from 'node:fs';
    const readyPath = process.argv[process.argv.length - 1];
    writeFileSync(readyPath, String(process.pid));
    setInterval(() => {}, 1000);
  `;

  // Sibling prefix-colliding worktree process (exact same command shape as real `cap run android`).
  const siblingCap = join(siblingBin, 'cap');
  writeFileSync(siblingCap, sleeperScript);

  // Unrelated agent-like process whose cwd and flags reference the target worktree.
  const agentScript = join(externalDir, 'claude');
  writeFileSync(agentScript, sleeperScript);

  const siblingReady = join(base, 'sibling.ready');
  const agentReady = join(base, 'agent.ready');
  const shellReady = join(base, 'shell.ready');

  const children: ChildProcess[] = [];
  try {
    const pSibling = spawn(
      process.execPath,
      [siblingCap, 'run', 'android', '--live-reload', siblingReady],
      { cwd: siblingWeb, stdio: 'ignore' },
    );
    const pAgent = spawn(process.execPath, [agentScript, '--workspace', target, agentReady], {
      cwd: target,
      stdio: 'ignore',
    });
    const pShell = spawn('bash', ['-c', `printf '%s' "$$" > "$1"; sleep 60`, '_', shellReady], {
      cwd: target,
      stdio: 'ignore',
    });
    children.push(pSibling, pAgent, pShell);

    await Promise.all([
      waitForFile(siblingReady),
      waitForFile(agentReady),
      waitForFile(shellReady),
    ]);

    // Sibling has its own pidfile that must stay intact.
    const writeSiblingPid = runHelper(['write-pid', sibling, String(pSibling.pid!)]);
    assert.equal(writeSiblingPid.status, 0, writeSiblingPid.stderr);

    // Target has a stale pidfile pointing to pAgent's PID with a mismatched starttime (PID reuse).
    writeFileSync(join(target, '.dev-android.pid'), `${pAgent.pid!} 999999999999\n`);

    // Run cleanup from a caller whose own cwd IS inside the target worktree (tests ancestor exclusion).
    const callerRes = spawnSync(
      'bash',
      [
        '-euo',
        'pipefail',
        '-c',
        `source "$1"; stop_worktree_host_processes "$2"; echo "CALLER_ALIVE"`,
        'caller-in-worktree',
        helperScript,
        target,
      ],
      {
        cwd: target,
        encoding: 'utf8',
        env: {
          PATH: process.env.PATH,
          CATCH_STOP_SIGINT_WAIT_DS: '3',
          CATCH_STOP_SIGTERM_WAIT_DS: '3',
          CATCH_STOP_SIGKILL_WAIT_DS: '10',
        },
      },
    );
    assert.ifError(callerRes.error);
    assert.equal(callerRes.status, 0, callerRes.stderr);
    assert.match(callerRes.stdout, /CALLER_ALIVE/);

    // Every non-target process must still be alive.
    assert.equal(isAlive(pSibling.pid!), true, 'sibling prefix-colliding process was touched');
    assert.equal(
      isAlive(pAgent.pid!),
      true,
      'unrelated agent process in target worktree was killed',
    );
    assert.equal(isAlive(pShell.pid!), true, 'unrelated shell in target worktree was killed');

    // Sibling pidfile stays untouched; stale target pidfile was cleaned up safely.
    assert.equal(existsSync(join(sibling, '.dev-android.pid')), true);
    assert.equal(existsSync(join(target, '.dev-android.pid')), false);
  } finally {
    forceKillAll(children);
    rmSync(base, { recursive: true, force: true });
  }
});

test('worktree.sh remove and self-remove stop host processes without .env.worktree and treat pidfiles as disposable', async () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'catch-wt-remove-')));
  const primary = join(base, 'catch-main');
  const wt1 = join(base, 'catch-live');
  const wt2 = join(base, 'catch-stale-pid');
  const wt3 = join(base, 'catch-self');
  mkdirSync(join(primary, 'scripts'), { recursive: true });
  mkdirSync(join(primary, 'apps/web'), { recursive: true });

  copyFileSync(worktreeScript, join(primary, 'scripts/worktree.sh'));
  copyFileSync(helperScript, join(primary, 'scripts/worktree-processes.sh'));
  copyFileSync(gitignoreFile, join(primary, '.gitignore'));
  chmodSync(join(primary, 'scripts/worktree.sh'), 0o755);
  chmodSync(join(primary, 'scripts/worktree-processes.sh'), 0o755);

  const originalConfig = 'export default { appId: "org.iloni.catchnotes" };\n';
  writeFileSync(join(primary, 'apps/web/capacitor.config.ts'), originalConfig);

  const gitEnv = {
    PATH: process.env.PATH,
    GIT_AUTHOR_NAME: 'Test',
    GIT_AUTHOR_EMAIL: 'test@example.com',
    GIT_COMMITTER_NAME: 'Test',
    GIT_COMMITTER_EMAIL: 'test@example.com',
  };
  const git = (cwd: string, args: string[]) => {
    const res = spawnSync('git', args, { cwd, encoding: 'utf8', env: gitEnv });
    assert.ifError(res.error);
    assert.equal(res.status, 0, `git ${args.join(' ')} failed: ${res.stderr}`);
    return res;
  };

  git(primary, ['init', '-b', 'main']);
  git(primary, ['add', '.']);
  git(primary, ['commit', '-m', 'initial']);
  git(primary, ['worktree', 'add', '-b', 'feat/live', wt1]);
  git(primary, ['worktree', 'add', '-b', 'feat/stale-pid', wt2]);
  git(primary, ['worktree', 'add', '-b', 'feat/self', wt3]);

  const fakeCap = `
    import { writeFileSync } from 'node:fs';
    const [configPath, original, readyPath] = process.argv.slice(2);
    writeFileSync(configPath, '// dirty during live reload\\n');
    process.on('SIGINT', () => {
      writeFileSync(configPath, original);
      process.exit(0);
    });
    writeFileSync(readyPath, String(process.pid));
    setInterval(() => {}, 1000);
  `;

  const children: ChildProcess[] = [];
  try {
    // 1. `worktree.sh remove` with live-reload process dirtying a tracked file and NO `.env.worktree`.
    const wt1Bin = join(wt1, 'apps/web/node_modules/.bin');
    mkdirSync(wt1Bin, { recursive: true });
    const wt1Cap = join(wt1Bin, 'cap');
    writeFileSync(wt1Cap, fakeCap);
    const wt1Ready = join(base, 'wt1.ready');
    const p1 = spawn(
      process.execPath,
      [wt1Cap, join(wt1, 'apps/web/capacitor.config.ts'), originalConfig, wt1Ready],
      { cwd: join(wt1, 'apps/web'), stdio: 'ignore' },
    );
    children.push(p1);
    await waitForFile(wt1Ready);
    runHelper(['write-pid', wt1, String(p1.pid!)]);
    assert.equal(existsSync(join(wt1, '.env.worktree')), false);

    const remove1 = spawnSync('bash', [join(primary, 'scripts/worktree.sh'), 'remove', wt1, '-y'], {
      cwd: primary,
      encoding: 'utf8',
      env: gitEnv,
    });
    assert.ifError(remove1.error);
    assert.equal(remove1.status, 0, `${remove1.stdout}\n${remove1.stderr}`);
    await waitForExit(p1.pid!);
    assert.equal(existsSync(wt1), false);

    // 2. Leftover `.dev-android.pid` is matched by DISPOSABLE and does not block removal.
    const worktreeSource = readFileSync(worktreeScript, 'utf8');
    assert.match(worktreeSource, /DISPOSABLE=.*\\\.dev-android\\\.pid/);
    writeFileSync(join(wt2, '.dev-android.pid'), '99999999 12345\n');
    const remove2 = spawnSync('bash', [join(primary, 'scripts/worktree.sh'), 'remove', wt2, '-y'], {
      cwd: primary,
      encoding: 'utf8',
      env: gitEnv,
    });
    assert.ifError(remove2.error);
    assert.equal(remove2.status, 0, `${remove2.stdout}\n${remove2.stderr}`);
    assert.equal(existsSync(wt2), false);

    // 3. `worktree.sh self-remove` from inside the worktree stops lingering processes even without `.env.worktree`.
    const wt3Bin = join(wt3, 'apps/web/node_modules/.bin');
    mkdirSync(wt3Bin, { recursive: true });
    const wt3Cap = join(wt3Bin, 'cap');
    writeFileSync(wt3Cap, fakeCap);
    const wt3Ready = join(base, 'wt3.ready');
    const p3 = spawn(
      process.execPath,
      [wt3Cap, join(wt3, 'apps/web/capacitor.config.ts'), originalConfig, wt3Ready],
      { cwd: join(wt3, 'apps/web'), stdio: 'ignore' },
    );
    children.push(p3);
    await waitForFile(wt3Ready);

    const remove3 = spawnSync('bash', [join(wt3, 'scripts/worktree.sh'), 'self-remove', '-y'], {
      cwd: wt3,
      encoding: 'utf8',
      env: gitEnv,
    });
    assert.ifError(remove3.error);
    assert.equal(remove3.status, 0, `${remove3.stdout}\n${remove3.stderr}`);
    await waitForExit(p3.pid!);
    assert.equal(existsSync(wt3), false);
  } finally {
    forceKillAll(children);
    rmSync(base, { recursive: true, force: true });
  }
});

test('dev.sh down and destroy stop lingering worktree host processes', async () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'catch-dev-teardown-')));
  const wt = join(base, 'catch-dev');
  const fakeBin = join(base, 'bin');
  mkdirSync(join(wt, 'scripts'), { recursive: true });
  mkdirSync(join(wt, 'apps/web/node_modules/.bin'), { recursive: true });
  mkdirSync(fakeBin, { recursive: true });

  copyFileSync(devScript, join(wt, 'scripts/dev.sh'));
  copyFileSync(helperScript, join(wt, 'scripts/worktree-processes.sh'));
  chmodSync(join(wt, 'scripts/dev.sh'), 0o755);
  chmodSync(join(wt, 'scripts/worktree-processes.sh'), 0o755);
  writeFileSync(
    join(wt, '.env.worktree'),
    'COMPOSE_PROJECT_NAME=catch_test\nCATCH_PORT=24999\nCATCH_PUBLIC_HOST=localhost\n',
  );

  const dockerLog = join(base, 'docker.log');
  const fakeDocker = join(fakeBin, 'docker');
  writeFileSync(
    fakeDocker,
    `#!/usr/bin/env bash
printf '%s\\n' "$*" >> ${JSON.stringify(dockerLog)}
`,
  );
  chmodSync(fakeDocker, 0o755);

  const gitEnv = {
    PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
    GIT_AUTHOR_NAME: 'Test',
    GIT_AUTHOR_EMAIL: 'test@example.com',
    GIT_COMMITTER_NAME: 'Test',
    GIT_COMMITTER_EMAIL: 'test@example.com',
    CATCH_STOP_SIGINT_WAIT_DS: '6',
    CATCH_STOP_SIGTERM_WAIT_DS: '6',
    CATCH_STOP_SIGKILL_WAIT_DS: '10',
  };
  const initRes = spawnSync('git', ['init', '-b', 'main'], {
    cwd: wt,
    encoding: 'utf8',
    env: gitEnv,
  });
  assert.equal(initRes.status, 0, initRes.stderr);

  const capStub = join(wt, 'apps/web/node_modules/.bin/cap');
  writeFileSync(
    capStub,
    `
      import { writeFileSync } from 'node:fs';
      const readyPath = process.argv[process.argv.length - 1];
      process.on('SIGINT', () => process.exit(0));
      writeFileSync(readyPath, String(process.pid));
      setInterval(() => {}, 1000);
    `,
  );

  const children: ChildProcess[] = [];
  try {
    for (const args of [['down'], ['destroy', '-y']]) {
      const readyPath = join(base, `${args[0]}.ready`);
      const child = spawn(
        process.execPath,
        [capStub, 'run', 'android', '--live-reload', readyPath],
        { cwd: join(wt, 'apps/web'), stdio: 'ignore' },
      );
      children.push(child);
      await waitForFile(readyPath);
      runHelper(['write-pid', wt, String(child.pid!)]);

      const res = spawnSync('bash', [join(wt, 'scripts/dev.sh'), ...args], {
        cwd: wt,
        encoding: 'utf8',
        env: gitEnv,
      });
      assert.ifError(res.error);
      assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
      await waitForExit(child.pid!);
      assert.equal(existsSync(join(wt, '.dev-android.pid')), false);
    }

    const dockerCalls = readFileSync(dockerLog, 'utf8');
    assert.match(dockerCalls, /down --remove-orphans/);
    assert.match(dockerCalls, /down -v --remove-orphans --rmi local/);
  } finally {
    forceKillAll(children);
    rmSync(base, { recursive: true, force: true });
  }
});
