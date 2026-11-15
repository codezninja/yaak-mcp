import { execFile } from "node:child_process";

/** Runs one `yaak` CLI invocation and resolves with its stdout. */
export interface YaakCli {
  run(args: string[], options?: { timeoutMs?: number }): Promise<string>;
}

export interface YaakCliOptions {
  /** Path or name of the yaak binary. Defaults to `yaak` on PATH. */
  bin?: string;
  /** Passed as `--data-dir` when set, for a non-default Yaak data directory. */
  dataDir?: string;
  /** Default per-call timeout. Sends can override it. */
  timeoutMs?: number;
}

const MAX_BUFFER = 64 * 1024 * 1024;

export class YaakCliError extends Error {
  constructor(
    message: string,
    readonly args: string[],
    readonly exitCode: number | null,
  ) {
    super(message);
    this.name = "YaakCliError";
  }
}

export function createYaakCli(options: YaakCliOptions = {}): YaakCli {
  const bin = options.bin ?? "yaak";
  const globalArgs = options.dataDir ? ["--data-dir", options.dataDir] : [];
  const defaultTimeout = options.timeoutMs ?? 30_000;

  return {
    run(args, runOptions) {
      const fullArgs = [...globalArgs, ...args];
      return new Promise((resolve, reject) => {
        const child = execFile(
          bin,
          fullArgs,
          {
            maxBuffer: MAX_BUFFER,
            timeout: runOptions?.timeoutMs ?? defaultTimeout,
            encoding: "utf8",
          },
          (error, stdout, stderr) => {
            if (!error) {
              resolve(stdout);
              return;
            }
            const code = typeof error.code === "number" ? error.code : null;
            if (error.code === "ENOENT") {
              reject(
                new YaakCliError(
                  `Yaak CLI not found (tried "${bin}"). Install it with ` +
                    "`mise use -g npm:@yaakapp/cli` or set YAAK_BIN to its path.",
                  fullArgs,
                  null,
                ),
              );
              return;
            }
            if (error.killed) {
              reject(new YaakCliError(`yaak ${args[0] ?? ""} timed out`, fullArgs, code));
              return;
            }
            const detail = (stderr || stdout || error.message).trim().replace(/^Error:\s*/, "");
            reject(new YaakCliError(detail, fullArgs, code));
          },
        );
        // The CLI prompts for confirmation on some commands. Never leave it waiting.
        child.stdin?.end();
      });
    },
  };
}
