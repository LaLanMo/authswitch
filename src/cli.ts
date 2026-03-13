#!/usr/bin/env node
import { UserError } from "./lib/errors.js";
import { AuthswitchService } from "./lib/service.js";

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function printHelp(): void {
  process.stdout.write(`authswitch

Usage:
  authswitch import <profile> [--replace]
  authswitch login <profile> [--replace]
  authswitch list [--json]
  authswitch current [--json]
  authswitch status <profile> [--json]
  authswitch use <profile>
  authswitch renew <profile>
  authswitch renew --current
  authswitch renew --others [--json]
  authswitch remove <profile>
  authswitch doctor [--json]
`);
}

async function main(): Promise<void> {
  const service = new AuthswitchService();
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  switch (command) {
    case "import": {
      const name = args[1];
      if (!name) {
        throw new UserError("authswitch import requires a profile name.");
      }
      const result = await service.importProfile(name, args.includes("--replace"));
      process.stdout.write(`Imported ${result.metadata.name} (${result.metadata.email ?? "unknown account"}).\n`);
      return;
    }
    case "login": {
      const name = args[1];
      if (!name) {
        throw new UserError("authswitch login requires a profile name.");
      }
      const result = await service.loginProfile(name, args.includes("--replace"));
      process.stdout.write(`Logged in and saved ${result.metadata.name} (${result.metadata.email ?? "unknown account"}).\n`);
      return;
    }
    case "list": {
      const result = await service.listProfiles();
      if (args.includes("--json")) {
        printJson(result);
        return;
      }
      for (const profile of result) {
        const flags = [
          profile.current ? "current" : null,
          profile.needsRenewal ? "needs-renewal" : null,
        ].filter(Boolean);
        process.stdout.write(
          `${profile.name}\t${profile.email ?? "unknown"}\t${profile.subscriptionType ?? "unknown"}${flags.length ? `\t[${flags.join(", ")}]` : ""}\n`,
        );
      }
      return;
    }
    case "current": {
      const result = await service.current();
      if (args.includes("--json")) {
        printJson(result);
        return;
      }
      process.stdout.write(
        result.managed
          ? `${result.profile}\t${result.email ?? "unknown"}\t${result.subscriptionType ?? "unknown"}\n`
          : `unmanaged\t${result.email ?? "unknown"}\t${result.subscriptionType ?? "unknown"}\n`,
      );
      return;
    }
    case "status": {
      const name = args[1];
      if (!name) {
        throw new UserError("authswitch status requires a profile name.");
      }
      const result = await service.status(name);
      if (args.includes("--json")) {
        printJson(result);
        return;
      }
      process.stdout.write(`${result.name}\t${result.email ?? "unknown"}\t${result.subscriptionType ?? "unknown"}\n`);
      return;
    }
    case "use": {
      const name = args[1];
      if (!name) {
        throw new UserError("authswitch use requires a profile name.");
      }
      const result = await service.useProfile(name);
      process.stdout.write(`Activated ${result.metadata.name} (${result.metadata.email ?? "unknown account"}).\n`);
      return;
    }
    case "renew": {
      if (args[1] === "--all") {
        throw new UserError("authswitch renew --all was removed. Use authswitch renew --others.");
      }
      if (args[1] === "--current") {
        const result = await service.renewCurrentProfile();
        process.stdout.write(
          `Renewed current profile ${result.metadata.name}; accessTokenExpiresAt=${result.metadata.accessTokenExpiresAt ?? "unknown"}; lastRenewedAt=${result.metadata.lastRenewedAt ?? "unknown"}.\n`,
        );
        return;
      }
      if (args[1] === "--others") {
        const results = await service.renewOtherProfiles();
        const failed = results.filter((item) => !item.ok);
        if (args.includes("--json")) {
          printJson(results);
        } else {
          for (const result of results) {
            if (result.skipped) {
              process.stdout.write(`Skipped ${result.profile} (current).\n`);
            } else if (result.ok) {
              process.stdout.write(`Renewed ${result.profile}.\n`);
            } else {
              process.stdout.write(`Failed ${result.profile}: ${result.error ?? "unknown error"}\n`);
            }
          }
        }
        if (failed.length > 0) {
          process.exitCode = 1;
        }
        return;
      }
      const name = args[1];
      if (!name) {
        throw new UserError("authswitch renew requires a profile name, --current, or --others.");
      }
      const result = await service.renewProfile(name);
      process.stdout.write(
        `Renewed ${result.metadata.name}; accessTokenExpiresAt=${result.metadata.accessTokenExpiresAt ?? "unknown"}; lastRenewedAt=${result.metadata.lastRenewedAt ?? "unknown"}.\n`,
      );
      return;
    }
    case "remove": {
      const name = args[1];
      if (!name) {
        throw new UserError("authswitch remove requires a profile name.");
      }
      await service.removeProfile(name);
      process.stdout.write(`Removed ${name}.\n`);
      return;
    }
    case "doctor": {
      const result = await service.doctor();
      if (args.includes("--json")) {
        printJson(result);
        return;
      }
      for (const [key, value] of Object.entries(result)) {
        process.stdout.write(`${key}: ${String(value)}\n`);
      }
      return;
    }
    default:
      throw new UserError(`Unknown command: ${command}`);
  }
}

main().catch((error) => {
  if (error instanceof UserError) {
    process.stderr.write(`Error: ${error.message}\n`);
    process.exit(2);
  }
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
