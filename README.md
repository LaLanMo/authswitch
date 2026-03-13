# authswitch

`authswitch` is a macOS CLI for people who use multiple Claude Code OAuth accounts on one machine.

It stores several Claude auth profiles, keeps exactly one of them active as the machine's global Claude login, and lets you switch between them without duplicating the rest of your Claude workspace state.

## Why this exists

Claude Code normally behaves like there is only one logged-in account on the machine. That is inconvenient if you regularly switch between:

- personal and work accounts
- different organizations
- backup accounts you want to keep healthy but not actively use

`authswitch` solves that by separating:

- the current active Claude login
- a local profile store of other saved Claude OAuth accounts

## What it does

- Imports the current global Claude login into a named profile
- Logs into a new profile without overwriting the current global login
- Switches the machine's global Claude login to a stored profile
- Refreshes stored profiles with OAuth refresh tokens
- Leaves `~/.claude/` history, tasks, cache, plans, and other non-auth state alone

## What it does not do

- It does not support multiple active profiles at the same time
- It does not duplicate `~/.claude/`
- It does not manage non-Claude auth providers yet
- It does not tell you when a refresh token will expire, because Claude does not expose that information locally

## Requirements

- macOS
- Node.js 20+
- `claude` available on `PATH`
- a working Claude Code OAuth login on the machine for `import`

## Storage model

`authswitch` stores:

- profile metadata in `~/.authswitch/profiles/*.json`
- sensitive OAuth material in macOS Keychain

It does not copy your `~/.claude/` working state. Only auth-related state is switched.

## Quick start

Save the account you are already logged into:

```bash
authswitch import personal
```

Add another account in isolation:

```bash
authswitch login work
```

See what profiles you have:

```bash
authswitch list --json
```

Switch the machine's active Claude login:

```bash
authswitch use work
claude auth status --json
```

Switch back:

```bash
authswitch use personal
```

## Command summary

```bash
authswitch import <profile> [--replace]
authswitch login <profile> [--replace]
authswitch list [--json]
authswitch current [--json]
authswitch status <profile> [--json]
authswitch use <profile>
authswitch renew <profile>
authswitch renew --others [--json]
authswitch renew --current
authswitch remove <profile>
authswitch doctor [--json]
```

## Renew semantics

`authswitch` treats the current active profile and inactive stored profiles differently.

Refresh all inactive profiles:

```bash
authswitch renew --others
```

This is the intended command for cron or launchd. It skips the currently active profile on purpose.

Refresh one inactive profile:

```bash
authswitch renew personal
```

Refresh the currently active profile:

```bash
authswitch renew --current
```

Refreshing the current active profile rotates the live login. Existing Claude processes may need to be restarted afterward.

## JSON fields

`list --json` and `status --json` expose:

- `accessTokenExpiresAt`: when the currently stored access token expires
- `lastRenewedAt`: when `authswitch` last refreshed that stored profile

These fields do not tell you when the refresh token will expire. They only describe the short-lived access token currently stored for that profile and the last successful renewal time.

## Development

Install dependencies:

```bash
npm install
```

Run tests:

```bash
npm test
```

Build the compiled CLI:

```bash
npm run build
```

Build the single-file bundled CLI:

```bash
npm run bundle
./bundle/authswitch.js --help
```

The bundle still requires Node on the host, but it does not require the TypeScript source tree at runtime.
