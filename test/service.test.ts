import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { AuthswitchService } from "../src/lib/service.js";
import {
  AUTHSWITCH_KEYCHAIN_SERVICE,
  AUTHSWITCH_LAUNCHD_LABEL,
  authswitchLaunchdPlistPath,
  authswitchRenewOthersLogPath,
  authswitchRenewOthersScriptPath,
  claudeKeychainService,
} from "../src/lib/paths.js";
import type { AuthBundle, CommandOptions, CommandResult, CommandRunner } from "../src/lib/types.js";

class FakeRunner implements CommandRunner {
  private readonly keychain = new Map<string, string>();
  private loginCounter = 0;
  private launchdLoaded = false;

  constructor(
    private readonly homeDir: string,
    private readonly username: string,
    private readonly interactiveLogins: AuthBundle[],
  ) {}

  async run(command: string, args: string[], options: CommandOptions = {}): Promise<CommandResult> {
    if (command === "which" && args[0] === "claude") {
      return { exitCode: 0, stdout: "/mock/bin/claude\n", stderr: "" };
    }
    if (command === "which" && args[0] === "authswitch") {
      return { exitCode: 0, stdout: "/mock/bin/authswitch\n", stderr: "" };
    }
    if (command === "claude" && args[0] === "--version") {
      return { exitCode: 0, stdout: "2.1.71\n", stderr: "" };
    }
    if (command === "security") {
      return this.handleSecurity(args);
    }
    if (command === "launchctl") {
      return this.handleLaunchctl(args);
    }
    if (command === "claude" && args[0] === "auth" && args[1] === "login") {
      return await this.handleClaudeLogin(options.env ?? process.env);
    }
    throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
  }

  primeKeychain(service: string, account: string, value: string): void {
    this.keychain.set(`${service}::${account}`, value);
  }

  readKeychain(service: string, account: string): string | null {
    return this.keychain.get(`${service}::${account}`) ?? null;
  }

  isLaunchdLoaded(): boolean {
    return this.launchdLoaded;
  }

  private handleSecurity(args: string[]): CommandResult {
    const action = args[0];
    const service = args[args.indexOf("-s") + 1];
    const account = args[args.indexOf("-a") + 1];
    const key = `${service}::${account}`;

    if (action === "find-generic-password") {
      const value = this.keychain.get(key);
      if (!value) {
        return { exitCode: 44, stdout: "", stderr: "could not be found" };
      }
      return { exitCode: 0, stdout: value, stderr: "" };
    }

    if (action === "add-generic-password") {
      const encoded = args[args.indexOf("-X") + 1];
      this.keychain.set(key, Buffer.from(encoded, "hex").toString("utf8"));
      return { exitCode: 0, stdout: "", stderr: "" };
    }

    if (action === "delete-generic-password") {
      this.keychain.delete(key);
      return { exitCode: 0, stdout: "", stderr: "" };
    }

    throw new Error(`Unexpected security args: ${args.join(" ")}`);
  }

  private handleLaunchctl(args: string[]): CommandResult {
    if (args[0] === "bootstrap") {
      this.launchdLoaded = true;
      return { exitCode: 0, stdout: "", stderr: "" };
    }
    if (args[0] === "bootout") {
      this.launchdLoaded = false;
      return { exitCode: 0, stdout: "", stderr: "" };
    }
    if (args[0] === "print") {
      const target = args[1] ?? "";
      if (this.launchdLoaded && target.endsWith(`/${AUTHSWITCH_LAUNCHD_LABEL}`)) {
        return { exitCode: 0, stdout: `${AUTHSWITCH_LAUNCHD_LABEL}\n`, stderr: "" };
      }
      return { exitCode: 113, stdout: "", stderr: "Could not find service" };
    }
    throw new Error(`Unexpected launchctl args: ${args.join(" ")}`);
  }

  private async handleClaudeLogin(env: NodeJS.ProcessEnv): Promise<CommandResult> {
    const configDir = env.CLAUDE_CONFIG_DIR;
    const bundle =
      env.CLAUDE_CODE_OAUTH_REFRESH_TOKEN && env.CLAUDE_CODE_OAUTH_SCOPES
        ? this.refreshedBundle(env.CLAUDE_CODE_OAUTH_REFRESH_TOKEN, env.CLAUDE_CODE_OAUTH_SCOPES)
        : this.nextInteractiveBundle();

    const service = claudeKeychainService(configDir);
    const configPath = configDir ? path.join(configDir, ".claude.json") : path.join(this.homeDir, ".claude.json");
    if (configDir) {
      await fs.mkdir(configDir, { recursive: true });
    }
    this.primeKeychain(service, this.username, JSON.stringify({ claudeAiOauth: bundle.claudeAiOauth }));
    await fs.writeFile(
      configPath,
      `${JSON.stringify(
        {
          oauthAccount: bundle.oauthAccount,
          s1mAccessCache: bundle.s1mAccessCache,
          hasAvailableSubscription: bundle.hasAvailableSubscription,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    return { exitCode: 0, stdout: "", stderr: "" };
  }

  private nextInteractiveBundle(): AuthBundle {
    const bundle = this.interactiveLogins[this.loginCounter];
    if (!bundle) {
      throw new Error("No fake interactive login bundle queued.");
    }
    this.loginCounter += 1;
    return bundle;
  }

  private refreshedBundle(refreshToken: string, scopes: string): AuthBundle {
    const isWork = refreshToken.includes("work");
    return {
      claudeAiOauth: {
        accessToken: `access-${refreshToken}`,
        refreshToken: `${refreshToken}-next`,
        expiresAt: Date.now() + 3600_000,
        scopes: scopes.split(/\s+/).filter(Boolean),
        subscriptionType: "max",
        rateLimitTier: "tier-1",
      },
      oauthAccount: {
        accountUuid: isWork ? "acct-work" : "acct-personal",
        emailAddress: isWork ? "work@example.com" : "personal@example.com",
        organizationUuid: isWork ? "org-work" : "org-personal",
        organizationName: isWork ? "Work Org" : "Personal Org",
        displayName: isWork ? "Work" : "Personal",
      },
      s1mAccessCache: {},
      hasAvailableSubscription: false,
    };
  }
}

function bundleFor(email: string, accountUuid: string, refreshToken: string): AuthBundle {
  return {
    claudeAiOauth: {
      accessToken: `access-${refreshToken}`,
      refreshToken,
      expiresAt: Date.now() + 600_000,
      scopes: ["user:profile", "user:inference"],
      subscriptionType: "max",
      rateLimitTier: "tier-1",
    },
    oauthAccount: {
      accountUuid,
      emailAddress: email,
      organizationUuid: `org-${accountUuid}`,
      organizationName: `${accountUuid} Org`,
      displayName: email,
    },
    s1mAccessCache: {},
    hasAvailableSubscription: false,
  };
}

async function createHarness(): Promise<{
  service: AuthswitchService;
  runner: FakeRunner;
  homeDir: string;
  username: string;
}> {
  const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), "authswitch-test-"));
  const username = "tester";
  const runner = new FakeRunner(homeDir, username, [bundleFor("work@example.com", "acct-work", "refresh-work")]);
  const current = bundleFor("personal@example.com", "acct-personal", "refresh-personal");

  await fs.writeFile(
    path.join(homeDir, ".claude.json"),
    `${JSON.stringify(
      {
        oauthAccount: current.oauthAccount,
        s1mAccessCache: current.s1mAccessCache,
        hasAvailableSubscription: current.hasAvailableSubscription,
      },
      null,
      2,
    )}\n`,
  );
  runner.primeKeychain(
    claudeKeychainService(),
    username,
    JSON.stringify({ claudeAiOauth: current.claudeAiOauth }),
  );

  return {
    service: new AuthswitchService({
      homeDir,
      username,
      uid: 501,
      runner,
      env: {},
      randomUUID: (() => {
        let i = 0;
        return () => `uuid-${++i}`;
      })(),
    }),
    runner,
    homeDir,
    username,
  };
}

test("import stores the current global profile without refreshing it", async () => {
  const { service, runner, username } = await createHarness();
  const before = runner.readKeychain(claudeKeychainService(), username);
  const imported = await service.importProfile("personal");
  assert.equal(imported.metadata.name, "personal");
  assert.equal(imported.metadata.email, "personal@example.com");
  assert.equal(typeof imported.metadata.accessTokenExpiresAt, "number");
  assert.equal(imported.metadata.lastRenewedAt, null);
  assert.equal(imported.bundle.claudeAiOauth.refreshToken, "refresh-personal");
  assert.equal(runner.readKeychain(claudeKeychainService(), username), before);
});

test("login uses an isolated temp profile and leaves the current global auth alone", async () => {
  const { service, runner, username } = await createHarness();
  const before = runner.readKeychain(claudeKeychainService(), username);
  const loggedIn = await service.loginProfile("work");
  const after = runner.readKeychain(claudeKeychainService(), username);
  assert.equal(loggedIn.metadata.email, "work@example.com");
  assert.equal(after, before);
});

test("use switches the global auth to the target profile", async () => {
  const { service, runner, username, homeDir } = await createHarness();
  await service.importProfile("personal");
  await service.loginProfile("work");

  const switched = await service.useProfile("work");
  assert.equal(switched.metadata.email, "work@example.com");

  const globalSecret = runner.readKeychain(claudeKeychainService(), username);
  assert.ok(globalSecret);
  assert.match(globalSecret!, /work/);

  const globalConfig = JSON.parse(await fs.readFile(path.join(homeDir, ".claude.json"), "utf8")) as {
    oauthAccount: { emailAddress: string };
  };
  assert.equal(globalConfig.oauthAccount.emailAddress, "work@example.com");
});

test("use is a no-op when the target profile is already current", async () => {
  const { service } = await createHarness();
  const imported = await service.importProfile("personal");
  const used = await service.useProfile("personal");
  assert.equal(used.metadata.name, "personal");
  assert.equal(imported.bundle.claudeAiOauth.refreshToken, "refresh-personal");
  assert.equal(used.bundle.claudeAiOauth.refreshToken, "refresh-personal");
});

test("renewing the current profile requires the explicit current command", async () => {
  const { service } = await createHarness();
  await service.importProfile("personal");
  await assert.rejects(service.renewProfile("personal"), /renew --current/);
});

test("renew current refreshes the active global account and updates the stored profile", async () => {
  const { service, runner, username, homeDir } = await createHarness();
  await service.importProfile("personal");

  const before = runner.readKeychain(claudeKeychainService(), username);
  const renewed = await service.renewCurrentProfile();
  const after = runner.readKeychain(claudeKeychainService(), username);

  assert.equal(renewed.metadata.name, "personal");
  assert.equal(typeof renewed.metadata.accessTokenExpiresAt, "number");
  assert.match(renewed.metadata.lastRenewedAt ?? "", /^\d{4}-\d{2}-\d{2}T/);
  assert.notEqual(after, before);
  const globalConfig = JSON.parse(await fs.readFile(path.join(homeDir, ".claude.json"), "utf8")) as {
    oauthAccount: { emailAddress: string };
  };
  assert.equal(globalConfig.oauthAccount.emailAddress, "personal@example.com");
});

test("status surfaces accessTokenExpiresAt and lastRenewedAt for stored profiles", async () => {
  const { service } = await createHarness();
  const imported = await service.importProfile("personal");

  const status = await service.status("personal");
  assert.equal(status.accessTokenExpiresAt, imported.metadata.accessTokenExpiresAt);
  assert.equal(status.lastRenewedAt, imported.metadata.lastRenewedAt);
  assert.ok(!("expiresAt" in status));
});

test("renew others skips the active profile and refreshes only non-current profiles", async () => {
  const { service, runner, username, homeDir } = await createHarness();
  await service.importProfile("personal");
  await service.loginProfile("work");

  const before = runner.readKeychain(claudeKeychainService(), username);
  const results = await service.renewOtherProfiles();
  const after = runner.readKeychain(claudeKeychainService(), username);

  assert.equal(results.length, 2);
  assert.deepEqual(results, [
    { profile: "personal", ok: true, skipped: true, skipReason: "current" },
    { profile: "work", ok: true },
  ]);
  assert.equal(after, before);
  const globalConfig = JSON.parse(await fs.readFile(path.join(homeDir, ".claude.json"), "utf8")) as {
    oauthAccount: { emailAddress: string };
  };
  assert.equal(globalConfig.oauthAccount.emailAddress, "personal@example.com");
});

test("renew others skips inactive profiles that are not yet due", async () => {
  const { service } = await createHarness();
  await service.importProfile("personal");
  const work = await service.loginProfile("work");

  await service.store.save(
    "work",
    {
      ...work.bundle,
      claudeAiOauth: {
        ...work.bundle.claudeAiOauth,
        expiresAt: Date.now() + 6 * 60 * 60 * 1000,
      },
    },
    work.metadata.lastRenewedAt,
  );

  const results = await service.renewOtherProfiles();

  assert.deepEqual(results, [
    { profile: "personal", ok: true, skipped: true, skipReason: "current" },
    { profile: "work", ok: true, skipped: true, skipReason: "not-due" },
  ]);
  const status = await service.status("work");
  assert.equal(status.needsRenewal, false);
});

test("remove deletes the stored profile without touching global auth", async () => {
  const { service, runner, username } = await createHarness();
  await service.importProfile("personal");
  const before = runner.readKeychain(claudeKeychainService(), username);
  await service.removeProfile("personal");
  const after = runner.readKeychain(claudeKeychainService(), username);
  assert.equal(after, before);
  assert.equal(runner.readKeychain(AUTHSWITCH_KEYCHAIN_SERVICE, "personal"), null);
});

test("launchd install writes a managed renew-others agent and helper script", async () => {
  const { service, runner, homeDir } = await createHarness();
  const status = await service.installRenewOthersLaunchd(2);

  assert.deepEqual(status, {
    installed: true,
    schedule: "0 */2 * * *",
    hours: 2,
    scriptPath: authswitchRenewOthersScriptPath(homeDir),
    logPath: authswitchRenewOthersLogPath(homeDir),
    plistPath: authswitchLaunchdPlistPath(homeDir),
    label: AUTHSWITCH_LAUNCHD_LABEL,
  });
  assert.equal(runner.isLaunchdLoaded(), true);
  const script = await fs.readFile(authswitchRenewOthersScriptPath(homeDir), "utf8");
  assert.match(script, /authswitch renew --others start/);
  assert.match(script, /"\/mock\/bin\/authswitch" renew --others/);
  assert.match(script, /authswitch renew --others finish exit=/);
  assert.match(script, /exit_code=\$\?/);
  const plist = await fs.readFile(authswitchLaunchdPlistPath(homeDir), "utf8");
  assert.match(plist, /authswitch-hours: 2/);
  assert.match(plist, new RegExp(AUTHSWITCH_LAUNCHD_LABEL));
});

test("launchd remove clears the agent plist and helper script", async () => {
  const { service, runner, homeDir } = await createHarness();
  await service.installRenewOthersLaunchd(2);
  await service.removeLaunchd();

  assert.deepEqual(await service.launchdStatus(), {
    installed: false,
    schedule: null,
    hours: null,
    scriptPath: null,
    logPath: null,
    plistPath: null,
    label: null,
  });
  assert.equal(runner.isLaunchdLoaded(), false);
  await assert.rejects(fs.access(authswitchRenewOthersScriptPath(homeDir)));
  await assert.rejects(fs.access(authswitchLaunchdPlistPath(homeDir)));
});
