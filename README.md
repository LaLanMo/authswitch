# authswitch

`authswitch` manages multiple Claude Code OAuth profiles while keeping exactly one global active login.

## What v1 does

- Imports the current global Claude login into a named profile
- Logs into a new profile without overwriting the current global login
- Switches the machine's global Claude login to a stored profile
- Refreshes stored profiles with OAuth refresh tokens
- Leaves `~/.claude/` history, tasks, cache, and other non-auth state alone

## What v1 does not do

- It does not support multiple active profiles at the same time
- It does not duplicate `~/.claude/`
- It does not manage non-Claude auth providers yet

## Commands

```bash
authswitch import personal
authswitch login work
authswitch list
authswitch current
authswitch status personal
authswitch use work
authswitch renew personal
authswitch renew --others
authswitch renew --current
authswitch remove work
authswitch doctor
```

## Bundled CLI

To generate a single-file bundled CLI that still runs against your local `claude` and macOS Keychain:

```bash
npm run bundle
./bundle/authswitch.js --help
```

The bundle output is `bundle/authswitch.js`. It still requires Node on the host, but you do not need the TypeScript source tree to run that file.

## Auto-renew

Stored profiles can be refreshed without switching the active global login:

```bash
authswitch renew --others
```

This is the intended command for cron or launchd. `authswitch` does not install a scheduler.

`authswitch renew <profile>` only targets a named non-current profile. If you need to rotate the current active profile, use:

```bash
authswitch renew --current
```

Refreshing the current active profile rotates the live login. Existing Claude processes may need to be restarted afterward.

`list --json` and `status --json` surface:

- `accessTokenExpiresAt`: when the currently stored access token expires
- `lastRenewedAt`: when `authswitch` last refreshed that stored profile

This does not tell you when the refresh token will expire. It only describes the short-lived access token currently stored for that profile and the last successful renewal time.
