import { Buffer } from "node:buffer";

import type { CommandRunner } from "./types.js";

export async function readGenericPassword(
  runner: CommandRunner,
  service: string,
  account: string,
): Promise<string | null> {
  const result = await runner.run(
    "security",
    ["find-generic-password", "-a", account, "-w", "-s", service],
    { allowNonZero: true },
  );
  if (result.exitCode !== 0) {
    return null;
  }
  return result.stdout.trimEnd();
}

export async function upsertGenericPassword(
  runner: CommandRunner,
  service: string,
  account: string,
  secret: string,
): Promise<void> {
  const encoded = Buffer.from(secret, "utf8").toString("hex");
  await runner.run("security", ["add-generic-password", "-U", "-a", account, "-s", service, "-X", encoded]);
}

export async function deleteGenericPassword(
  runner: CommandRunner,
  service: string,
  account: string,
): Promise<void> {
  const result = await runner.run(
    "security",
    ["delete-generic-password", "-a", account, "-s", service],
    { allowNonZero: true },
  );
  if (result.exitCode !== 0 && !result.stderr.includes("could not be found")) {
    throw new Error(`Failed to delete keychain item ${service}/${account}: ${result.stderr.trim()}`);
  }
}
