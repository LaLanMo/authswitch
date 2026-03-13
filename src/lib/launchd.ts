import fs from "node:fs/promises";
import path from "node:path";

import { UserError } from "./errors.js";
import {
  AUTHSWITCH_LAUNCHD_LABEL,
  authswitchBinDir,
  authswitchLaunchdPlistPath,
  authswitchRenewOthersLogPath,
  authswitchRenewOthersScriptPath,
  launchAgentsDir,
} from "./paths.js";
import type { CommandRunner, LaunchdStatus } from "./types.js";

export async function findAuthswitchPath(runner: CommandRunner): Promise<string | null> {
  const result = await runner.run("which", ["authswitch"], { allowNonZero: true });
  if (result.exitCode !== 0) {
    return null;
  }
  return result.stdout.trim() || null;
}

export function launchdScheduleForHours(hours: number): string {
  if (!Number.isInteger(hours) || hours < 1 || hours > 23) {
    throw new UserError("authswitch launchd install requires --hours to be an integer from 1 to 23.");
  }
  return `0 */${hours} * * *`;
}

export function calendarHoursForInterval(hours: number): number[] {
  launchdScheduleForHours(hours);
  const values: number[] = [];
  for (let hour = 0; hour < 24; hour += hours) {
    values.push(hour);
  }
  return values;
}

export function parseLaunchdHours(plist: string): number | null {
  const match = /<!-- authswitch-hours: (\d+) -->/.exec(plist);
  if (!match) {
    return null;
  }
  const hours = Number(match[1]);
  return Number.isInteger(hours) ? hours : null;
}

export async function writeRenewOthersScript(
  homeDir: string,
  authswitchPath: string,
  shellPathEnv: string,
): Promise<string> {
  const scriptPath = authswitchRenewOthersScriptPath(homeDir);
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
  exit_code=$?
  print -r -- "[$(timestamp)] authswitch renew --others finish exit=\${exit_code}"
  exit $exit_code
fi
`;

  await fs.writeFile(scriptPath, script, { encoding: "utf8", mode: 0o755 });
  await fs.chmod(scriptPath, 0o755);
  return scriptPath;
}

export async function cleanupRenewOthersScript(homeDir: string): Promise<void> {
  await fs.rm(authswitchRenewOthersScriptPath(homeDir), { force: true });
}

export async function writeRenewOthersPlist(homeDir: string, hours: number): Promise<string> {
  const plistPath = authswitchLaunchdPlistPath(homeDir);
  await fs.mkdir(launchAgentsDir(homeDir), { recursive: true });

  const intervals = calendarHoursForInterval(hours)
    .map(
      (hour) => `      <dict>
        <key>Hour</key>
        <integer>${hour}</integer>
        <key>Minute</key>
        <integer>0</integer>
      </dict>`,
    )
    .join("\n");

  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<!-- authswitch-hours: ${hours} -->
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>${AUTHSWITCH_LAUNCHD_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
      <string>${authswitchRenewOthersScriptPath(homeDir)}</string>
    </array>
    <key>StartCalendarInterval</key>
    <array>
${intervals}
    </array>
    <key>WorkingDirectory</key>
    <string>${homeDir}</string>
    <key>StandardOutPath</key>
    <string>${authswitchRenewOthersLogPath(homeDir)}</string>
    <key>StandardErrorPath</key>
    <string>${authswitchRenewOthersLogPath(homeDir)}</string>
  </dict>
</plist>
`;

  await fs.writeFile(plistPath, plist, { encoding: "utf8" });
  return plistPath;
}

export async function installLaunchAgent(runner: CommandRunner, uid: number, plistPath: string): Promise<void> {
  await runner.run("launchctl", ["bootout", `gui/${uid}`, plistPath], { allowNonZero: true });
  await runner.run("launchctl", ["bootstrap", `gui/${uid}`, plistPath]);
}

export async function removeLaunchAgent(runner: CommandRunner, uid: number, homeDir: string): Promise<void> {
  await runner.run("launchctl", ["bootout", `gui/${uid}`, authswitchLaunchdPlistPath(homeDir)], {
    allowNonZero: true,
  });
  await fs.rm(authswitchLaunchdPlistPath(homeDir), { force: true });
}

export async function launchdStatus(runner: CommandRunner, uid: number, homeDir: string): Promise<LaunchdStatus> {
  const plistPath = authswitchLaunchdPlistPath(homeDir);
  let plist: string;
  try {
    plist = await fs.readFile(plistPath, "utf8");
  } catch {
    return {
      installed: false,
      schedule: null,
      hours: null,
      scriptPath: null,
      logPath: null,
      plistPath: null,
      label: null,
    };
  }

  const hours = parseLaunchdHours(plist);
  const loaded =
    (
      await runner.run("launchctl", ["print", `gui/${uid}/${AUTHSWITCH_LAUNCHD_LABEL}`], {
        allowNonZero: true,
      })
    ).exitCode === 0;

  return {
    installed: loaded,
    schedule: hours === null ? null : `0 */${hours} * * *`,
    hours,
    scriptPath: authswitchRenewOthersScriptPath(homeDir),
    logPath: authswitchRenewOthersLogPath(homeDir),
    plistPath,
    label: AUTHSWITCH_LAUNCHD_LABEL,
  };
}
