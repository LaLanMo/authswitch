import { createHash } from "node:crypto";
import path from "node:path";

import { UserError } from "./errors.js";

export const AUTHSWITCH_KEYCHAIN_SERVICE = "authswitch-profile";
export const CLAUDE_KEYCHAIN_BASE_SERVICE = "Claude Code-credentials";
export const PROFILE_NAME_RE = /^[A-Za-z0-9._-]+$/;

export function assertProfileName(name: string): void {
  if (!PROFILE_NAME_RE.test(name)) {
    throw new UserError("Profile names may only contain letters, numbers, dot, underscore, and dash.");
  }
}

export function authswitchRoot(homeDir: string): string {
  return path.join(homeDir, ".authswitch");
}

export function profilesDir(homeDir: string): string {
  return path.join(authswitchRoot(homeDir), "profiles");
}

export function authswitchBinDir(homeDir: string): string {
  return path.join(authswitchRoot(homeDir), "bin");
}

export function authswitchCronScriptPath(homeDir: string): string {
  return path.join(authswitchBinDir(homeDir), "renew-others");
}

export function authswitchCronLogPath(homeDir: string): string {
  return path.join(authswitchRoot(homeDir), "renew-others.log");
}

export function profileMetadataPath(homeDir: string, profileName: string): string {
  return path.join(profilesDir(homeDir), `${profileName}.json`);
}

export function authswitchTempDir(homeDir: string, purpose: "login" | "renew", id: string): string {
  return path.join(authswitchRoot(homeDir), "tmp", purpose, id);
}

export function defaultClaudeJsonPath(homeDir: string): string {
  return path.join(homeDir, ".claude.json");
}

export function resolveClaudeJsonPath(homeDir: string, configDir?: string): string {
  if (!configDir) {
    return defaultClaudeJsonPath(homeDir);
  }
  return path.join(configDir, ".claude.json");
}

export function resolveClaudeAltConfigPath(configDir: string): string {
  return path.join(configDir, ".config.json");
}

export function resolveClaudeCredentialsPath(homeDir: string, configDir?: string): string {
  const root = configDir ?? path.join(homeDir, ".claude");
  return path.join(root, ".credentials.json");
}

export function claudeKeychainService(configDir?: string): string {
  if (!configDir) {
    return CLAUDE_KEYCHAIN_BASE_SERVICE;
  }
  const normalized = configDir.normalize("NFC");
  const suffix = createHash("sha256").update(normalized).digest("hex").slice(0, 8);
  return `${CLAUDE_KEYCHAIN_BASE_SERVICE}-${suffix}`;
}
