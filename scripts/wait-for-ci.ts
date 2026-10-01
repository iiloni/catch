import { execFile } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { setTimeout } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { z } from 'zod';

const runsSchema = z.object({
  workflow_runs: z.array(
    z.object({
      id: z.number().int().positive(),
      head_sha: z.string(),
      head_branch: z.string().nullable(),
      path: z.string(),
      event: z.string(),
      status: z.string(),
      conclusion: z.string().nullable(),
      html_url: z.url(),
    }),
  ),
});
const jobsSchema = z.object({
  jobs: z.array(
    z.object({ name: z.string(), status: z.string(), conclusion: z.string().nullable() }),
  ),
});
const requiredJobs = ['check', 'e2e (desktop)', 'e2e (android)'];

type ReadJobs = (runId: number) => Promise<unknown>;

function matchingRuns(sha: string, input: unknown) {
  return runsSchema
    .parse(input)
    .workflow_runs.filter(
      (run) =>
        run.head_sha === sha &&
        run.path === '.github/workflows/ci.yml' &&
        ((run.event === 'push' && run.head_branch === 'main') || run.event === 'workflow_dispatch'),
    )
    .sort((a, b) => b.id - a.id);
}

/** Skipped jobs in a duplicate CI request are not themselves proof the commit passed. */
export async function passedCi(sha: string, input: unknown, readJobs: ReadJobs) {
  for (const run of matchingRuns(sha, input)) {
    if (run.status !== 'completed' || run.conclusion !== 'success') continue;
    const { jobs } = jobsSchema.parse(await readJobs(run.id));
    if (
      requiredJobs.every((name) =>
        jobs.some(
          (job) => job.name === name && job.status === 'completed' && job.conclusion === 'success',
        ),
      )
    )
      return run.html_url;
  }
  return null;
}

/** A queued duplicate must not silently retry a failed suite. Reruns remain explicit. */
export async function ciToReuse(
  sha: string,
  input: unknown,
  readJobs: ReadJobs,
  runId: number,
  attempt: number,
) {
  const passed = await passedCi(sha, input, readJobs);
  if (passed) return passed;
  const failed = matchingRuns(sha, input).find(
    (run) => run.id !== runId && run.status === 'completed' && run.conclusion !== 'success',
  );
  if (failed && attempt === 1) {
    throw new Error(
      `CI did not pass for ${sha}. Rerun the failed CI explicitly: ${failed.html_url}`,
    );
  }
  return null;
}

/** Observe existing CI, or request it for a tagged commit a batch push never tested. */
export async function waitForCi(
  shaInput: unknown,
  options: {
    runs: () => Promise<unknown>;
    jobs: ReadJobs;
    start?: () => Promise<unknown>;
    now?: () => number;
    sleep?: (ms: number) => Promise<unknown>;
    timeoutMs?: number;
  },
) {
  const sha = z
    .string()
    .regex(/^[a-f0-9]{40}$/)
    .parse(shaInput);
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? setTimeout;
  const startedAt = now();
  const deadline = startedAt + (options.timeoutMs ?? 30 * 60_000);
  let requested = false;
  while (now() < deadline) {
    const input = await options.runs();
    const passed = await passedCi(sha, input, options.jobs);
    if (passed) return passed;
    const runs = matchingRuns(sha, input);
    if (runs.length && runs.every((run) => run.status === 'completed')) {
      throw new Error(`CI did not pass for ${sha}. Fix or rerun CI: ${runs[0].html_url}`);
    }
    // Allow the push event to create its CI run before requesting one on the release tag.
    if (!runs.length && !requested && options.start && now() - startedAt >= 60_000) {
      await options.start();
      requested = true;
    }
    await sleep(Math.max(0, Math.min(15_000, deadline - now())));
  }
  throw new Error(`Timed out waiting for CI on ${sha}. Let CI finish, then rerun the release.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const repository = z
      .string()
      .regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/)
      .parse(process.env.GITHUB_REPOSITORY);
    const sha = z
      .string()
      .regex(/^[a-f0-9]{40}$/)
      .parse(process.env.GITHUB_SHA);
    const run = promisify(execFile);
    const read = async (endpoint: string) => {
      const { stdout } = await run(
        'gh',
        ['api', '--paginate', '--slurp', `repos/${repository}/${endpoint}`],
        {
          timeout: 30_000,
          maxBuffer: 10 * 1024 * 1024,
        },
      );
      return z.array(z.unknown()).parse(JSON.parse(stdout));
    };
    const options = {
      runs: async () => ({
        workflow_runs: (
          await read(`actions/workflows/ci.yml/runs?head_sha=${sha}&per_page=100`)
        ).flatMap((page) => runsSchema.parse(page).workflow_runs),
      }),
      // A rerun of failed jobs retains successful jobs from earlier attempts.
      jobs: async (id: number) => ({
        jobs: (await read(`actions/runs/${id}/jobs?filter=all&per_page=100`)).flatMap(
          (page) => jobsSchema.parse(page).jobs,
        ),
      }),
    };
    let url: string | null;
    if (process.argv[2] === 'check') {
      url = await ciToReuse(
        sha,
        await options.runs(),
        options.jobs,
        Number(process.env.GITHUB_RUN_ID ?? 0),
        Number(process.env.GITHUB_RUN_ATTEMPT ?? 1),
      );
      if (process.env.GITHUB_OUTPUT) {
        appendFileSync(process.env.GITHUB_OUTPUT, `run_checks=${!url}\n`);
      }
    } else {
      const tag = z
        .string()
        .regex(/^v\d+\.\d+\.\d+(?:-preview)?$/)
        .parse(process.env.GITHUB_REF_NAME);
      console.log(`Waiting for CI on ${sha}.`);
      url = await waitForCi(sha, {
        ...options,
        start: async () => {
          console.log(`No existing CI; requesting it on ${tag}.`);
          await run(
            'gh',
            [
              'api',
              '--method',
              'POST',
              `repos/${repository}/actions/workflows/ci.yml/dispatches`,
              '-f',
              `ref=${tag}`,
            ],
            { timeout: 30_000 },
          );
        },
      });
    }
    console.log(url ? `Reusing successful CI: ${url}` : 'This commit needs checks and E2E.');
    if (url && process.env.GITHUB_STEP_SUMMARY) {
      appendFileSync(
        process.env.GITHUB_STEP_SUMMARY,
        `Reused [successful CI](${url}) for \`${sha}\`. No duplicate checks or E2E were started.\n`,
      );
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
