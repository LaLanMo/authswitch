# authswitch

`authswitch` is a macOS CLI for people who use multiple Claude Code OAuth accounts on one machine.

It stores several Claude auth profiles, keeps exactly one of them active as the machine's global Claude login, and lets you switch between them without duplicating the rest of your Claude workspace state.

## TL;DR

If you already use Claude Code and sometimes need to switch between accounts:

```bash
npx authswitch import personal
npx authswitch login work
npx authswitch use work
claude auth status --json
```

## Status

`authswitch` is currently:

- macOS-only
- Claude.ai OAuth-only
- pre-1.0 and still settling its CLI/data model

## Why this exists

Claude Code normally behaves like there is only one logged-in account on the machine. That is inconvenient if you regularly switch between:

- personal and work accounts
- different organizations
- backup accounts you want to keep healthy but not actively use

`authswitch` solves that by separating:

- the current active Claude login
- a local profile store of other saved Claude OAuth accounts

## Install

Use it without installing:

```bash
npx authswitch --help
```

Or install it globally:

```bash
npm install -g authswitch
authswitch --help
```

If you prefer to run from source:

```bash
git clone https://github.com/LaLanMo/authswitch.git
cd authswitch
npm install
npm run build
node dist/src/cli.js --help
```

If you want a single-file local entrypoint:

```bash
npm run bundle
./bundle/authswitch.js --help
```

If you want a shell command named `authswitch`, a simple local symlink works:

```bash
ln -sf "$PWD/bundle/authswitch.js" ~/.local/bin/authswitch
```

## Before you start

You need:

- macOS
- Node.js 20+
- `claude` available on `PATH`
- at least one working Claude Code OAuth login on the machine

The safest first command is:

```bash
authswitch current --json
```

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

## How it works

`authswitch` keeps two different concepts separate:

- the machine's current active Claude login
- a local store of saved auth profiles

Commands work roughly like this:

- `import <profile>` snapshots the account you are currently logged into
- `login <profile>` creates a new stored profile in isolation, without replacing the current global login
- `use <profile>` makes that stored profile the machine's active Claude login
- `renew --others` refreshes inactive stored profiles without touching the active one

## First-time setup

### 1. Save the account you are already using

```bash
authswitch import personal
```

### 2. Add another account

```bash
authswitch login work
```

### 3. See what you have

```bash
authswitch list --json
```

### 4. Switch accounts

```bash
authswitch use work
claude auth status --json
```

### 5. Switch back

```bash
authswitch use personal
```

## Everyday commands

Check which profile is active:

```bash
authswitch current --json
```

Inspect one stored profile:

```bash
authswitch status personal --json
```

Refresh inactive profiles:

```bash
authswitch renew --others
```

Remove a stored profile:

```bash
authswitch remove work
```

## Storage and security

`authswitch` stores:

- profile metadata in `~/.authswitch/profiles/*.json`
- sensitive OAuth material in macOS Keychain

It does not copy your `~/.claude/` working state. Only auth-related state is switched.

## Safety notes

- `use <profile>` changes the machine's global Claude login
- `renew --current` rotates the current live login and may invalidate already-running Claude processes
- `renew --others` is the safe maintenance command for background scheduling because it skips the active profile on purpose
- `accessTokenExpiresAt` is only the short-lived access token expiry, not the lifetime of the stored profile

If you are using Claude heavily in a terminal right now, avoid `renew --current` until you are ready to restart those processes.

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

## Common workflow

```bash
authswitch import personal
authswitch login work
authswitch list --json
authswitch use work
claude auth status --json
authswitch renew --others
authswitch use personal
```

## Troubleshooting

If a switch succeeds but you want to confirm Claude really moved to the expected account:

```bash
claude auth status --json
```

If you want a quick environment sanity check:

```bash
authswitch doctor --json
```

If you refreshed the current active profile and an existing Claude process starts failing, restart that Claude process.

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
