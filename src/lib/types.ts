export interface ClaudeAiOauth {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scopes: string[];
  subscriptionType: string | null;
  rateLimitTier: string | null;
}

export interface OAuthAccount {
  accountUuid: string;
  emailAddress: string;
  organizationUuid: string | null;
  organizationName?: string | null;
  displayName?: string | null;
  billingType?: string | null;
  accountCreatedAt?: string | null;
  subscriptionCreatedAt?: string | null;
  hasExtraUsageEnabled?: boolean;
  organizationRole?: string | null;
  workspaceRole?: string | null;
}

export type S1mAccessCache = Record<string, unknown>;

export interface AuthBundle {
  claudeAiOauth: ClaudeAiOauth;
  oauthAccount: OAuthAccount | null;
  s1mAccessCache: S1mAccessCache | null;
  hasAvailableSubscription: boolean | null;
}

export interface ProfileMetadata {
  schemaVersion: 1;
  name: string;
  accountUuid: string | null;
  email: string | null;
  organizationUuid: string | null;
  organizationName: string | null;
  subscriptionType: string | null;
  accessTokenExpiresAt: number | null;
  scopes: string[];
  createdAt: string;
  updatedAt: string;
  lastRenewedAt: string | null;
}

export interface StoredProfile {
  metadata: ProfileMetadata;
  bundle: AuthBundle;
}

export interface CurrentProfileStatus {
  profile: string | null;
  email: string | null;
  orgId: string | null;
  subscriptionType: string | null;
  managed: boolean;
}

export interface DoctorReport {
  authswitchVersion: string;
  claudePath: string | null;
  claudeVersion: string | null;
  globalAuthReadable: boolean;
  currentManaged: boolean;
  currentEmail: string | null;
  currentOrgId: string | null;
  profilesCount: number;
  externalClaudeConfigDirPresent: boolean;
}

export interface LaunchdStatus {
  installed: boolean;
  schedule: string | null;
  hours: number | null;
  scriptPath: string | null;
  logPath: string | null;
  plistPath: string | null;
  label: string | null;
}

export interface RenewResult {
  profile: string;
  ok: boolean;
  error?: string;
  skipped?: boolean;
  skipReason?: "current" | "not-due";
}

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface CommandOptions {
  env?: NodeJS.ProcessEnv;
  allowNonZero?: boolean;
  cwd?: string;
  input?: string;
  inheritStdio?: boolean;
}

export interface CommandRunner {
  run(command: string, args: string[], options?: CommandOptions): Promise<CommandResult>;
}
