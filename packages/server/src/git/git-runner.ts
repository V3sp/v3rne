const DEFAULT_TIMEOUT_MS = 10_000;
/** Delay between retries of a failed read-only command. */
const RETRY_DELAY_MS = 50;
/** Total spawns per command when the subcommand is retryable (1 try + 2 retries). */
const MAX_ATTEMPTS = 3;
/** Read-only commands whose transient failures are worth one more try. */
const RETRYABLE_SUBCOMMANDS = new Set(["status", "log", "for-each-ref", "worktree"]);
/** Options that consume the following argv entry, so it is not the subcommand. */
const VALUE_OPTIONS = new Set([
  "-c",
  "-C",
  "--git-dir",
  "--work-tree",
  "--namespace",
  "--exec-path",
  "--config-env",
]);

export const GIT_NO_OPTIONAL_LOCKS = "--no-optional-locks";

export interface RunGitOptions {
  cwd: string;
  timeoutMs?: number;
}

export interface GitCommandResult {
  /** Full argv actually spawned, starting with `git --no-optional-locks`. */
  command: string[];
  args: string[];
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  /** Number of spawns performed, including retries. */
  attempts: number;
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/** First non-option argv entry, i.e. the git subcommand. */
export function gitSubcommand(args: string[]): string | undefined {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    if (!arg.startsWith("-")) return arg;
    if (VALUE_OPTIONS.has(arg)) index += 1;
  }
  return undefined;
}

/** A missing or corrupt repository will not heal between two immediate attempts. */
function isPermanentFailure(stderr: string): boolean {
  return /not a git repository|invalid gitfile/i.test(stderr);
}

function shouldRetry(result: GitCommandResult): boolean {
  if (result.exitCode === 0 && !result.timedOut) return false;
  return !isPermanentFailure(result.stderr);
}

/**
 * Runs `git --no-optional-locks <args>` in `cwd`.
 * A missing repository or a non-zero exit code is reported in the result,
 * never thrown. Read-only subcommands are retried up to two times on a
 * timeout or a non-zero exit code; permanent errors are not retried.
 */
export async function runGit(args: string[], options: RunGitOptions): Promise<GitCommandResult> {
  const subcommand = gitSubcommand(args);
  const maxAttempts = subcommand !== undefined && RETRYABLE_SUBCOMMANDS.has(subcommand)
    ? MAX_ATTEMPTS
    : 1;

  for (let attempt = 1; ; attempt += 1) {
    const result = await runGitOnce(args, options);
    result.attempts = attempt;
    if (attempt >= maxAttempts || !shouldRetry(result)) return result;
    await Bun.sleep(RETRY_DELAY_MS);
  }
}

async function runGitOnce(args: string[], options: RunGitOptions): Promise<GitCommandResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const command = ["git", GIT_NO_OPTIONAL_LOCKS, ...args];

  let proc: Bun.Subprocess<"ignore", "pipe", "pipe">;
  try {
    proc = Bun.spawn(command, {
      cwd: options.cwd,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        GIT_OPTIONAL_LOCKS: "0",
      },
    });
  } catch (err) {
    return {
      command,
      args,
      exitCode: -1,
      stdout: "",
      stderr: describeError(err),
      timedOut: false,
      attempts: 0,
    };
  }

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, timeoutMs);

  try {
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const exitCode = await proc.exited;

    return {
      command,
      args,
      exitCode: timedOut ? -1 : exitCode,
      stdout,
      stderr: timedOut
        ? `${stderr}${stderr ? "\n" : ""}git command timed out after ${timeoutMs} ms`
        : stderr,
      timedOut,
      attempts: 0,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Returns stdout of a successful command, or `null` when it failed. */
export function stdoutOrNull(result: GitCommandResult): string | null {
  return result.exitCode === 0 ? result.stdout : null;
}
