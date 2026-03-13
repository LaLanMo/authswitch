import { spawn } from "node:child_process";

import type { CommandOptions, CommandResult, CommandRunner } from "./types.js";

export class NodeCommandRunner implements CommandRunner {
  async run(command: string, args: string[], options: CommandOptions = {}): Promise<CommandResult> {
    const env = options.env ?? process.env;

    return await new Promise<CommandResult>((resolve, reject) => {
      const child = spawn(command, args, {
        cwd: options.cwd,
        env,
        stdio: options.inheritStdio ? ["pipe", "inherit", "inherit"] : "pipe",
      });

      let stdout = "";
      let stderr = "";

      if (!options.inheritStdio) {
        child.stdout?.on("data", (chunk) => {
          stdout += chunk.toString();
        });
        child.stderr?.on("data", (chunk) => {
          stderr += chunk.toString();
        });
      }

      child.on("error", reject);
      child.on("close", (exitCode) => {
        const result = {
          exitCode: exitCode ?? 0,
          stdout,
          stderr,
        };
        if (!options.allowNonZero && result.exitCode !== 0) {
          reject(
            new Error(
              `${command} ${args.join(" ")} exited with code ${result.exitCode}${stderr ? `: ${stderr.trim()}` : ""}`,
            ),
          );
          return;
        }
        resolve(result);
      });

      if (options.input) {
        child.stdin?.write(options.input);
      }
      child.stdin?.end();
    });
  }
}
