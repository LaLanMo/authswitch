import fs from "node:fs/promises";
import os from "node:os";

import { readJsonFile } from "./json-file.js";
import { deleteGenericPassword, readGenericPassword } from "./keychain.js";
import {
  claudeKeychainService,
  resolveClaudeCredentialsPath,
  resolveClaudeAltConfigPath,
  resolveClaudeJsonPath,
} from "./paths.js";
import type { AuthBundle, CommandRunner } from "./types.js";

export interface ClaudeEnvironment {
  homeDir: string;
  username: string;
  env: NodeJS.ProcessEnv;
  runner: CommandRunner;
}

export function sanitizeClaudeEnv(baseEnv: NodeJS.ProcessEnv, overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...baseEnv };
  delete env.CLAUDE_CONFIG_DIR;
  delete env.CLAUDE_CODE_OAUTH_TOKEN;
  delete env.CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR;
  delete env.CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR;
  delete env.CLAUDE_CODE_OAUTH_REFRESH_TOKEN;
  delete env.CLAUDE_CODE_OAUTH_SCOPES;
  delete env.ANTHROPIC_API_KEY;
  return { ...env, ...overrides };
}

export async function findClaudePath(runner: CommandRunner): Promise<string | null> {
  const result = await runner.run("which", ["claude"], { allowNonZero: true });
  if (result.exitCode !== 0) {
    return null;
  }
  return result.stdout.trim() || null;
}

export async function readClaudeVersion(runner: CommandRunner): Promise<string | null> {
  const result = await runner.run("claude", ["--version"], { allowNonZero: true });
  if (result.exitCode !== 0) {
    return null;
  }
  return result.stdout.trim() || null;
}

export async function readAuthBundle(
  context: ClaudeEnvironment,
  configDir?: string,
): Promise<AuthBundle | null> {
  const service = claudeKeychainService(configDir);
  const secretRaw = await readGenericPassword(context.runner, service, context.username);
  const credentialsPath = resolveClaudeCredentialsPath(context.homeDir, configDir);
  const credentialsPayload =
    (secretRaw ? (JSON.parse(secretRaw) as { claudeAiOauth?: AuthBundle["claudeAiOauth"] }) : null) ??
    (await readJsonFile<{ claudeAiOauth?: AuthBundle["claudeAiOauth"] }>(credentialsPath));
  if (!credentialsPayload?.claudeAiOauth) {
    return null;
  }

  const configPath = resolveClaudeJsonPath(context.homeDir, configDir);
  const altConfigPath = configDir ? resolveClaudeAltConfigPath(configDir) : null;
  const config =
    (altConfigPath ? await readJsonFile<Record<string, unknown>>(altConfigPath) : null) ??
    (await readJsonFile<Record<string, unknown>>(configPath)) ??
    {};

  return {
    claudeAiOauth: credentialsPayload.claudeAiOauth,
    oauthAccount: (config.oauthAccount as AuthBundle["oauthAccount"]) ?? null,
    s1mAccessCache: (config.s1mAccessCache as AuthBundle["s1mAccessCache"]) ?? null,
    hasAvailableSubscription: (config.hasAvailableSubscription as boolean | null | undefined) ?? null,
  };
}

export async function runInteractiveClaudeLogin(
  context: ClaudeEnvironment,
  configDir: string,
): Promise<void> {
  await fs.mkdir(configDir, { recursive: true });
  await context.runner.run("claude", ["auth", "login"], {
    env: sanitizeClaudeEnv(context.env, { CLAUDE_CONFIG_DIR: configDir }),
    inheritStdio: true,
  });
}

export async function runRefreshClaudeLogin(
  context: ClaudeEnvironment,
  bundle: AuthBundle,
  configDir?: string,
): Promise<void> {
  if (configDir) {
    await fs.mkdir(configDir, { recursive: true });
  }
  await context.runner.run("claude", ["auth", "login"], {
    env: sanitizeClaudeEnv(context.env, {
      ...(configDir ? { CLAUDE_CONFIG_DIR: configDir } : {}),
      CLAUDE_CODE_OAUTH_REFRESH_TOKEN: bundle.claudeAiOauth.refreshToken,
      CLAUDE_CODE_OAUTH_SCOPES: bundle.claudeAiOauth.scopes.join(" "),
    }),
  });
}

export async function cleanupTemporaryClaudeArtifacts(
  context: ClaudeEnvironment,
  configDir: string,
): Promise<void> {
  await deleteGenericPassword(context.runner, claudeKeychainService(configDir), context.username).catch(() => {});
  await fs.rm(configDir, { recursive: true, force: true });
}

export function createClaudeEnvironment(runner: CommandRunner): ClaudeEnvironment {
  return {
    homeDir: os.homedir(),
    username: process.env.USER || os.userInfo().username,
    env: process.env,
    runner,
  };
}
