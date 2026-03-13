import fs from "node:fs/promises";
import path from "node:path";

import { UserError } from "./errors.js";
import { authswitchBinDir, authswitchCronLogPath, authswitchCronScriptPath } from "./paths.js";
import type { CommandRunner, CronStatus } from "./types.js";

const BEGIN_MARKER = "# authswitch:begin renew-others";
const END_MARKER = "# authswitch:end renew-others";

export async function findAuthswitchPath(runner: CommandRunner): Promise<string | null> {
  const result = await runner.run("which", ["authswitch"], { allowNonZero: true });
  if (result.exitCode !== 0) {
    return null;
  }
  return result.stdout.trim() || null;
}

export function cronScheduleForHours(hours: number): string {
  if (!Number.isInteger(hours) || hours < 1 || hours > 23) {
    throw new UserError("authswitch cron install requires --hours to be an integer from 1 to 23.");
  }
  return `0 */${hours} * * *`;
}

export function parseCronHours(schedule: string): number | null {
  const match = /^0 \*\/(\d{1,2}) \* \* \*$/.exec(schedule.trim());
  if (!match) {
    return null;
  }
  const hours = Number(match[1]);
  return Number.isInteger(hours) ? hours : null;
}

export async function readCrontab(runner: CommandRunner): Promise<string[]> {
  const result = await runner.run("crontab", ["-l"], { allowNonZero: true });
  if (result.exitCode !== 0) {
    if (result.stderr.includes("no crontab")) {
      return [];
    }
    throw new Error(result.stderr.trim() || "Unable to read crontab.");
  }
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean);
}

export async function writeCrontab(runner: CommandRunner, lines: string[]): Promise<void> {
  if (lines.length === 0) {
    await runner.run("crontab", ["-r"], { allowNonZero: true });
    return;
  }
  await runner.run("crontab", ["-"], {
    input: `${lines.join("\n")}\n`,
  });
}

export function stripManagedCronBlock(lines: string[]): string[] {
  const start = lines.findIndex((line) => line === BEGIN_MARKER);
  const end = lines.findIndex((line) => line === END_MARKER);
  if (start === -1 || end === -1 || end < start) {
    return lines;
  }
  return [...lines.slice(0, start), ...lines.slice(end + 1)];
}

export function managedCronBlock(schedule: string, scriptPath: string, logPath: string): string[] {
  return [
    BEGIN_MARKER,
    `${schedule} ${scriptPath} >> ${logPath} 2>&1`,
    END_MARKER,
  ];
}

export function parseManagedCronStatus(lines: string[], homeDir: string): CronStatus {
  const start = lines.findIndex((line) => line === BEGIN_MARKER);
  const end = lines.findIndex((line) => line === END_MARKER);
  if (start === -1 || end === -1 || end <= start + 0) {
    return {
      installed: false,
      schedule: null,
      hours: null,
      scriptPath: null,
      logPath: null,
    };
  }

  const cronLine = lines[start + 1] ?? "";
  const marker = ` ${authswitchCronScriptPath(homeDir)} >> ${authswitchCronLogPath(homeDir)} 2>&1`;
  if (!cronLine.endsWith(marker)) {
    return {
      installed: true,
      schedule: null,
      hours: null,
      scriptPath: authswitchCronScriptPath(homeDir),
      logPath: authswitchCronLogPath(homeDir),
    };
  }

  const schedule = cronLine.slice(0, cronLine.length - marker.length);
  return {
    installed: true,
    schedule,
    hours: parseCronHours(schedule),
    scriptPath: authswitchCronScriptPath(homeDir),
    logPath: authswitchCronLogPath(homeDir),
  };
}

export async function writeRenewOthersScript(
  homeDir: string,
  authswitchPath: string,
  shellPathEnv: string,
): Promise<string> {
  const scriptPath = authswitchCronScriptPath(homeDir);
  await fs.mkdir(authswitchBinDir(homeDir), { recursive: true });

  const authswitchBinDirPath = path.dirname(authswitchPath);
  const mergedPath = [authswitchBinDirPath, shellPathEnv, "/usr/bin:/bin:/usr/sbin:/sbin"]
    .filter(Boolean)
    .join(":");

  const script = `#!/bin/zsh
set -euo pipefail

export HOME=${JSON.stringify(homeDir)}
export PATH=${JSON.stringify(mergedPath)}

timestamp() {
  /bin/date -u +"%Y-%m-%dT%H:%M:%SZ"
}

print -r -- "[$(timestamp)] authswitch renew --others start"
if ${JSON.stringify(authswitchPath)} renew --others; then
  print -r -- "[$(timestamp)] authswitch renew --others finish exit=0"
else
  status=$?
  print -r -- "[$(timestamp)] authswitch renew --others finish exit=\${status}"
  exit ${"$"}status
fi
`;

  await fs.writeFile(scriptPath, script, { encoding: "utf8", mode: 0o755 });
  await fs.chmod(scriptPath, 0o755);
  return scriptPath;
}

export async function cleanupRenewOthersScript(homeDir: string): Promise<void> {
  await fs.rm(authswitchCronScriptPath(homeDir), { force: true });
}
