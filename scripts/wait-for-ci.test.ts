import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ciToReuse, passedCi, waitForCi } from './wait-for-ci.ts';

const sha = 'a'.repeat(40);
const run = {
  id: 1,
  head_sha: sha,
  head_branch: 'main',
  path: '.github/workflows/ci.yml',
  event: 'push',
  status: 'completed',
  conclusion: 'success',
  html_url: 'https://github.com/example/catch/actions/runs/1',
};
const jobs = ['check', 'e2e (desktop)', 'e2e (android)'].map((name) => ({
  name,
  status: 'completed',
  conclusion: 'success',
}));

test('a release waits for CI to appear and finish, then reuses all three successful jobs', async () => {
  let time = 0;
  let calls = 0;
  let inspected = 0;
  const url = await waitForCi(sha, {
    runs: async () => ({
      workflow_runs:
        calls++ === 0 ? [] : [{ ...run, status: calls < 4 ? 'in_progress' : 'completed' }],
    }),
    jobs: async (id) => {
      assert.equal(id, run.id);
      inspected++;
      return { jobs };
    },
    now: () => time,
    sleep: async (ms) => {
      time += ms;
    },
  });
  assert.equal(url, run.html_url);
  assert.equal(calls, 4);
  assert.equal(inspected, 1);
});

test('other commits, branches, events and workflows cannot satisfy release CI', async () => {
  for (const other of [
    { head_sha: 'b'.repeat(40) },
    { head_branch: 'feature' },
    { event: 'pull_request' },
    { path: '.github/workflows/release.yml' },
  ]) {
    let time = 0;
    await assert.rejects(
      waitForCi(sha, {
        runs: async () => ({ workflow_runs: [{ ...run, ...other }] }),
        jobs: async () => {
          assert.fail('Unrelated CI must not be inspected');
        },
        now: () => time,
        sleep: async (ms) => {
          time += ms;
        },
        timeoutMs: 1,
      }),
      /Timed out waiting for CI/,
    );
  }
});

test('failed, cancelled or skipped CI without a previous pass blocks a release', async () => {
  for (const conclusion of ['failure', 'cancelled', 'skipped']) {
    await assert.rejects(
      waitForCi(sha, {
        runs: async () => ({ workflow_runs: [{ ...run, conclusion }] }),
        jobs: async () => {
          assert.fail('Unsuccessful CI must not be reused');
        },
      }),
      /CI did not pass/,
    );
  }
});

test('an untested commit requests CI once on its tag after allowing push CI to appear', async () => {
  let time = 0;
  let requests = 0;
  const url = await waitForCi(sha, {
    runs: async () => ({
      workflow_runs:
        time < 90_000
          ? []
          : [{ ...run, event: 'workflow_dispatch', head_branch: 'v0.2.2-preview' }],
    }),
    jobs: async () => ({ jobs }),
    start: async () => {
      assert.equal(time, 60_000);
      requests++;
    },
    now: () => time,
    sleep: async (ms) => {
      time += ms;
    },
  });
  assert.equal(url, run.html_url);
  assert.equal(requests, 1);
});

test('CI reuse finds the actual tested run behind duplicate requests with skipped jobs', async () => {
  const input = {
    workflow_runs: [
      { ...run, id: 2, event: 'workflow_dispatch', head_branch: 'v0.2.2-preview' },
      run,
    ],
  };
  const readJobs = async (id: number) => ({ jobs: id === 1 ? jobs : [] });
  assert.equal(await passedCi(sha, input, readJobs), run.html_url);
  assert.equal(await waitForCi(sha, { runs: async () => input, jobs: readJobs }), run.html_url);
});

test('an existing push CI run is awaited without requesting another one', async () => {
  let time = 0;
  assert.equal(
    await waitForCi(sha, {
      runs: async () => ({
        workflow_runs: [{ ...run, status: time < 90_000 ? 'in_progress' : 'completed' }],
      }),
      jobs: async () => ({ jobs }),
      start: async () => {
        assert.fail('Existing CI must not be dispatched again');
      },
      now: () => time,
      sleep: async (ms) => {
        time += ms;
      },
    }),
    run.html_url,
  );
});

test('an overall green run must include successful checks and both E2E projects', async () => {
  for (const required of jobs) {
    for (const invalid of [
      jobs.filter((job) => job !== required),
      jobs.map((job) => (job === required ? { ...job, conclusion: 'skipped' } : job)),
      jobs.map((job) => (job === required ? { ...job, status: 'in_progress' } : job)),
    ]) {
      await assert.rejects(
        waitForCi(sha, {
          runs: async () => ({ workflow_runs: [run] }),
          jobs: async () => ({ jobs: invalid }),
        }),
        /CI did not pass/,
      );
    }
  }
});

test('a documentation-only push that skipped E2E is tested on the release tag', async () => {
  let time = 0;
  let requests = 0;
  const tagged = { ...run, id: 2, event: 'workflow_dispatch', head_branch: 'v0.2.2-preview' };
  const url = await waitForCi(sha, {
    runs: async () => ({
      workflow_runs: [
        ...(requests && time >= 30_000
          ? [{ ...tagged, status: time < 90_000 ? 'in_progress' : 'completed' }]
          : []),
        run,
      ],
    }),
    jobs: async (id) => ({ jobs: id === tagged.id ? jobs : jobs.slice(0, 1) }),
    start: async () => {
      assert.equal(time, 0);
      requests++;
    },
    now: () => time,
    sleep: async (ms) => {
      time += ms;
    },
  });
  assert.equal(url, tagged.html_url);
  assert.equal(requests, 1);
});

test('a requested run that fails blocks the release instead of being requested again', async () => {
  let time = 0;
  let requests = 0;
  await assert.rejects(
    waitForCi(sha, {
      runs: async () => ({
        workflow_runs: [
          ...(requests
            ? [{ ...run, id: 2, event: 'workflow_dispatch', conclusion: 'failure' }]
            : []),
          run,
        ],
      }),
      jobs: async () => ({ jobs: jobs.slice(0, 1) }),
      start: async () => {
        requests++;
      },
      now: () => time,
      sleep: async (ms) => {
        time += ms;
      },
    }),
    /CI did not pass/,
  );
  assert.equal(requests, 1);
});

test('CI that never finishes times out without starting replacement checks', async () => {
  let time = 0;
  await assert.rejects(
    waitForCi(sha, {
      runs: async () => ({ workflow_runs: [{ ...run, status: 'in_progress', conclusion: null }] }),
      jobs: async () => {
        assert.fail('Running CI must not be reused');
      },
      now: () => time,
      sleep: async (ms) => {
        time += ms;
      },
      timeoutMs: 10,
    }),
    /Timed out waiting for CI/,
  );
});

test('a queued duplicate does not retry failed CI, but an explicit rerun can', async () => {
  const input = {
    workflow_runs: [
      { ...run, conclusion: 'failure' },
      { ...run, id: 2, status: 'in_progress', conclusion: null },
    ],
  };
  const readJobs = async () => {
    assert.fail('There is no successful run to inspect');
  };
  await assert.rejects(ciToReuse(sha, input, readJobs, 2, 1), /Rerun the failed CI explicitly/);
  assert.equal(await ciToReuse(sha, input, readJobs, 2, 2), null);
});
