import { randomUUID as nodeRandomUUID } from "node:crypto";

import pkg from "../../package.json" with { type: "json" };
import {
  cleanupTemporaryClaudeArtifacts,
  createClaudeEnvironment,
  findClaudePath,
  readAuthBundle,
  readClaudeVersion,
  runInteractiveClaudeLogin,
  runRefreshClaudeLogin,
} from "./claude.js";
import {
  cleanupRenewOthersScript,
  cronScheduleForHours,
  findAuthswitchPath,
  managedCronBlock,
  parseManagedCronStatus,
  readCrontab,
  stripManagedCronBlock,
  writeCrontab,
  writeRenewOthersScript,
} from "./cron.js";
import { UserError } from "./errors.js";
import { authswitchCronLogPath, assertProfileName, authswitchTempDir } from "./paths.js";
import { NodeCommandRunner } from "./runner.js";
import { ProfileStore } from "./store.js";
import type {
  AuthBundle,
  CurrentProfileStatus,
  CronStatus,
  DoctorReport,
  ProfileMetadata,
  RenewResult,
  StoredProfile,
  CommandRunner,
} from "./types.js";

export interface ServiceOptions {
  homeDir?: string;
  username?: string;
  env?: NodeJS.ProcessEnv;
  runner?: CommandRunner;
  now?: () => Date;
  randomUUID?: () => string;
}

function bundlesMatch(left: AuthBundle | null, right: AuthBundle | null): boolean {
  if (!left || !right) {
    return false;
  }
  if (left.oauthAccount?.accountUuid && right.oauthAccount?.accountUuid) {
    return left.oauthAccount.accountUuid === right.oauthAccount.accountUuid;
  }
  return (
    left.oauthAccount?.emailAddress === right.oauthAccount?.emailAddress &&
    left.oauthAccount?.organizationUuid === right.oauthAccount?.organizationUuid
  );
}

function shouldSyncLiveBundle(live: AuthBundle, stored: AuthBundle): boolean {
  if (!bundlesMatch(live, stored)) {
    return false;
  }
  return live.claudeAiOauth.expiresAt > stored.claudeAiOauth.expiresAt;
}

export class AuthswitchService {
  private readonly now: () => Date;
  private readonly randomUUID: () => string;
  readonly claude;
  readonly store: ProfileStore;

  constructor(options: ServiceOptions = {}) {
    const runner = options.runner ?? new NodeCommandRunner();
    const defaults = createClaudeEnvironment(runner);
    this.claude = {
      homeDir: options.homeDir ?? defaults.homeDir,
      username: options.username ?? defaults.username,
      env: options.env ?? defaults.env,
      runner,
    };
    this.now = options.now ?? (() => new Date());
    this.randomUUID = options.randomUUID ?? nodeRandomUUID;
    this.store = new ProfileStore(this.claude.homeDir, runner, () => this.now().toISOString());
  }

  async importProfile(name: string, replace = false): Promise<StoredProfile> {
    assertProfileName(name);
    const current = await this.requireCurrentBundle();
    await this.ensureReplaceAllowed(name, current, replace);
    return await this.store.save(name, current, null);
  }

  async loginProfile(name: string, replace = false): Promise<StoredProfile> {
    assertProfileName(name);
    const tempDir = authswitchTempDir(this.claude.homeDir, "login", this.randomUUID());
    try {
      await runInteractiveClaudeLogin(this.claude, tempDir);
      const bundle = await readAuthBundle(this.claude, tempDir);
      if (!bundle?.oauthAccount) {
        throw new UserError("Login completed but authswitch could not read the new Claude account.");
      }
      await this.ensureReplaceAllowed(name, bundle, replace);
      return await this.store.save(name, bundle, this.now().toISOString());
    } finally {
      await cleanupTemporaryClaudeArtifacts(this.claude, tempDir);
    }
  }

  async listProfiles(): Promise<Array<ProfileMetadata & { current: boolean; needsRenewal: boolean }>> {
    const current = await this.readCurrentBundle();
    const currentMatch = current ? await this.findMatchingProfile(current) : null;
    const profiles = await this.store.listMetadata();
    return profiles.map((profile) => ({
      ...profile,
      current: currentMatch?.name === profile.name,
      needsRenewal:
        profile.accessTokenExpiresAt !== null ? profile.accessTokenExpiresAt <= this.now().getTime() : true,
    }));
  }

  async current(): Promise<CurrentProfileStatus> {
    const current = await this.readCurrentBundle();
    if (!current?.oauthAccount) {
      return {
        profile: null,
        email: null,
        orgId: null,
        subscriptionType: null,
        managed: false,
      };
    }
    const match = await this.findMatchingProfile(current);
    return {
      profile: match?.name ?? null,
      email: current.oauthAccount.emailAddress,
      orgId: current.oauthAccount.organizationUuid ?? null,
      subscriptionType: current.claudeAiOauth.subscriptionType,
      managed: Boolean(match),
    };
  }

  async status(name: string): Promise<ProfileMetadata & { current: boolean; needsRenewal: boolean }> {
    assertProfileName(name);
    const profile = await this.store.load(name);
    if (!profile) {
      throw new UserError(`Profile ${name} does not exist.`);
    }
    const current = await this.readCurrentBundle();
    const currentMatch = current ? await this.findMatchingProfile(current) : null;
    return {
      ...profile.metadata,
      current: currentMatch?.name === name,
      needsRenewal:
        profile.metadata.accessTokenExpiresAt !== null
          ? profile.metadata.accessTokenExpiresAt <= this.now().getTime()
          : true,
    };
  }

  async useProfile(name: string): Promise<StoredProfile> {
    assertProfileName(name);
    const existing = await this.store.load(name);
    if (!existing) {
      throw new UserError(`Profile ${name} does not exist.`);
    }

    const current = await this.readCurrentBundle();
    const currentMatch = current ? await this.findMatchingProfile(current) : null;
    if (current && currentMatch?.name === name) {
      if (shouldSyncLiveBundle(current, existing.bundle)) {
        return await this.store.save(name, current, existing.metadata.lastRenewedAt);
      }
      return existing;
    }

    if (current) {
      if (currentMatch) {
        const matchedProfile = await this.store.load(currentMatch.name);
        if (matchedProfile && shouldSyncLiveBundle(current, matchedProfile.bundle)) {
          await this.store.save(currentMatch.name, current, currentMatch.lastRenewedAt);
        }
      }
    }

    const refreshed = await this.refreshGlobalBundle(existing.bundle);
    return await this.store.save(name, refreshed, this.now().toISOString());
  }

  async renewProfile(name: string): Promise<StoredProfile> {
    assertProfileName(name);
    let stored = await this.store.load(name);
    if (!stored) {
      throw new UserError(`Profile ${name} does not exist.`);
    }

    const current = await this.readCurrentBundle();
    if (current && bundlesMatch(current, stored.bundle)) {
      throw new UserError(`Profile ${name} is currently active. Use authswitch renew --current instead.`);
    }

    const tempDir = authswitchTempDir(this.claude.homeDir, "renew", this.randomUUID());
    try {
      await runRefreshClaudeLogin(this.claude, stored.bundle, tempDir);
      const refreshed = await readAuthBundle(this.claude, tempDir);
      if (!refreshed?.oauthAccount) {
        throw new UserError(`Refresh succeeded for ${name}, but the refreshed Claude account could not be read.`);
      }
      return await this.store.save(name, refreshed, this.now().toISOString());
    } finally {
      await cleanupTemporaryClaudeArtifacts(this.claude, tempDir);
    }
  }

  async renewCurrentProfile(): Promise<StoredProfile> {
    const current = await this.requireCurrentBundle();
    const match = await this.findMatchingProfile(current);
    if (!match) {
      throw new UserError("The current global Claude account is not managed by authswitch.");
    }

    let stored = await this.store.load(match.name);
    if (!stored) {
      throw new UserError(`Profile ${match.name} does not exist.`);
    }
    if (shouldSyncLiveBundle(current, stored.bundle)) {
      stored = await this.store.save(match.name, current, stored.metadata.lastRenewedAt);
    }

    const refreshed = await this.refreshGlobalBundle(stored.bundle);
    return await this.store.save(match.name, refreshed, this.now().toISOString());
  }

  async renewOtherProfiles(): Promise<RenewResult[]> {
    const current = await this.readCurrentBundle();
    const currentMatch = current ? await this.findMatchingProfile(current) : null;
    const profiles = await this.store.listMetadata();
    const results: RenewResult[] = [];
    for (const profile of profiles) {
      if (currentMatch?.name === profile.name) {
        results.push({ profile: profile.name, ok: true, skipped: true });
        continue;
      }
      try {
        await this.renewProfile(profile.name);
        results.push({ profile: profile.name, ok: true });
      } catch (error) {
        results.push({
          profile: profile.name,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return results;
  }

  async removeProfile(name: string): Promise<void> {
    assertProfileName(name);
    const existing = await this.store.load(name);
    if (!existing) {
      throw new UserError(`Profile ${name} does not exist.`);
    }
    await this.store.remove(name);
  }

  async installRenewOthersCron(hours: number): Promise<CronStatus> {
    const authswitchPath = await findAuthswitchPath(this.claude.runner);
    if (!authswitchPath) {
      throw new UserError("authswitch cron install requires `authswitch` to be installed on PATH.");
    }

    const schedule = cronScheduleForHours(hours);
    const scriptPath = await writeRenewOthersScript(this.claude.homeDir, authswitchPath, this.claude.env.PATH ?? "");
    const logPath = authswitchCronLogPath(this.claude.homeDir);
    const lines = stripManagedCronBlock(await readCrontab(this.claude.runner));
    lines.push(...managedCronBlock(schedule, scriptPath, logPath));
    await writeCrontab(this.claude.runner, lines);
    return await this.cronStatus();
  }

  async cronStatus(): Promise<CronStatus> {
    return parseManagedCronStatus(await readCrontab(this.claude.runner), this.claude.homeDir);
  }

  async removeCron(): Promise<void> {
    const lines = stripManagedCronBlock(await readCrontab(this.claude.runner));
    await writeCrontab(this.claude.runner, lines);
    await cleanupRenewOthersScript(this.claude.homeDir);
  }

  async doctor(): Promise<DoctorReport> {
    const claudePath = await findClaudePath(this.claude.runner);
    const claudeVersion = claudePath ? await readClaudeVersion(this.claude.runner) : null;
    const current = await this.readCurrentBundle();
    const match = current ? await this.findMatchingProfile(current) : null;
    const profiles = await this.store.listMetadata();
    return {
      authswitchVersion: pkg.version,
      claudePath,
      claudeVersion,
      globalAuthReadable: Boolean(current),
      currentManaged: Boolean(match),
      currentEmail: current?.oauthAccount?.emailAddress ?? null,
      currentOrgId: current?.oauthAccount?.organizationUuid ?? null,
      profilesCount: profiles.length,
      externalClaudeConfigDirPresent: Boolean(this.claude.env.CLAUDE_CONFIG_DIR),
    };
  }

  private async readCurrentBundle(): Promise<AuthBundle | null> {
    return await readAuthBundle(this.claude);
  }

  private async requireCurrentBundle(): Promise<AuthBundle> {
    const bundle = await this.readCurrentBundle();
    if (!bundle?.oauthAccount) {
      throw new UserError("authswitch could not read the current global Claude login.");
    }
    return bundle;
  }

  private async refreshGlobalBundle(bundle: AuthBundle): Promise<AuthBundle> {
    await runRefreshClaudeLogin(this.claude, bundle);
    const refreshed = await this.readCurrentBundle();
    if (!refreshed?.oauthAccount) {
      throw new UserError("Claude refreshed the global login, but authswitch could not read the updated account.");
    }
    return refreshed;
  }

  private async ensureReplaceAllowed(name: string, incoming: AuthBundle, replace: boolean): Promise<void> {
    const existing = await this.store.load(name);
    if (!existing) {
      return;
    }
    if (bundlesMatch(existing.bundle, incoming)) {
      return;
    }
    if (!replace) {
      throw new UserError(`Profile ${name} already exists for a different account. Re-run with --replace.`);
    }
  }

  private async findMatchingProfile(bundle: AuthBundle): Promise<ProfileMetadata | null> {
    const profiles = await this.store.listMetadata();
    for (const profile of profiles) {
      if (bundle.oauthAccount?.accountUuid && profile.accountUuid && bundle.oauthAccount.accountUuid === profile.accountUuid) {
        return profile;
      }
    }
    for (const profile of profiles) {
      if (
        bundle.oauthAccount?.emailAddress === profile.email &&
        (bundle.oauthAccount?.organizationUuid ?? null) === profile.organizationUuid
      ) {
        return profile;
      }
    }
    return null;
  }
}
