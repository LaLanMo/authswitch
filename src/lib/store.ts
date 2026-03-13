import fs from "node:fs/promises";

import { readJsonFile, removeFileIfExists, writeJsonFile } from "./json-file.js";
import { deleteGenericPassword, readGenericPassword, upsertGenericPassword } from "./keychain.js";
import { AUTHSWITCH_KEYCHAIN_SERVICE, profileMetadataPath, profilesDir } from "./paths.js";
import type { AuthBundle, CommandRunner, ProfileMetadata, StoredProfile } from "./types.js";

export class ProfileStore {
  constructor(
    private readonly homeDir: string,
    private readonly runner: CommandRunner,
    private readonly nowIso: () => string,
  ) {}

  async listMetadata(): Promise<ProfileMetadata[]> {
    await fs.mkdir(profilesDir(this.homeDir), { recursive: true });
    const entries = await fs.readdir(profilesDir(this.homeDir), { withFileTypes: true });
    const profiles: ProfileMetadata[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) {
        continue;
      }
      const name = entry.name.slice(0, -5);
      const metadata = await readJsonFile<ProfileMetadata>(profileMetadataPath(this.homeDir, name));
      if (metadata) {
        profiles.push(metadata);
      }
    }
    return profiles.sort((a, b) => a.name.localeCompare(b.name));
  }

  async load(name: string): Promise<StoredProfile | null> {
    const metadata = await readJsonFile<ProfileMetadata>(profileMetadataPath(this.homeDir, name));
    if (!metadata) {
      return null;
    }
    const secret = await readGenericPassword(this.runner, AUTHSWITCH_KEYCHAIN_SERVICE, name);
    if (!secret) {
      throw new Error(`Profile ${name} metadata exists but keychain secret is missing.`);
    }
    return {
      metadata,
      bundle: JSON.parse(secret) as AuthBundle,
    };
  }

  async save(name: string, bundle: AuthBundle, lastRenewedAt: string | null): Promise<StoredProfile> {
    const existing = await this.load(name);
    const now = this.nowIso();
    const metadata: ProfileMetadata = {
      schemaVersion: 1,
      name,
      accountUuid: bundle.oauthAccount?.accountUuid ?? null,
      email: bundle.oauthAccount?.emailAddress ?? null,
      organizationUuid: bundle.oauthAccount?.organizationUuid ?? null,
      organizationName: bundle.oauthAccount?.organizationName ?? null,
      subscriptionType: bundle.claudeAiOauth.subscriptionType,
      accessTokenExpiresAt: bundle.claudeAiOauth.expiresAt,
      scopes: bundle.claudeAiOauth.scopes,
      createdAt: existing?.metadata.createdAt ?? now,
      updatedAt: now,
      lastRenewedAt,
    };
    await writeJsonFile(profileMetadataPath(this.homeDir, name), metadata);
    await upsertGenericPassword(this.runner, AUTHSWITCH_KEYCHAIN_SERVICE, name, JSON.stringify(bundle));
    return { metadata, bundle };
  }

  async remove(name: string): Promise<void> {
    await removeFileIfExists(profileMetadataPath(this.homeDir, name));
    await deleteGenericPassword(this.runner, AUTHSWITCH_KEYCHAIN_SERVICE, name).catch(() => {});
  }
}
