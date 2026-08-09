# Nami — agent CLI lifecycle: identity, sign-out, switch, remove

Date: 2026-08-09 · Status: approved by Calvin

Mockup: `https://claude.ai/code/artifact/b6f58923-e528-4bc5-b0aa-4c5ca8983a1b`

## Problem

A detected agent CLI has exactly two states today. `detectAgents()` runs `command -v` and returns
`found: true|false`. Found → the launcher row launches it. Not found → `openAgentSetup()` offers an
install command in a terminal tile. There is nothing in between: no way to see which account a session
will run as, sign out, sign in as someone else, re-run a setup wizard, or take a CLI off the machine.

Services already have this lifecycle — connect → `openServiceDetails()` → `services:disconnect` →
`removeService()`. Agents don't. This closes that gap.

## Principle

**Nami never owns an account.** It stores no credentials, decodes no tokens, and writes to no auth file.
Every identity line is something the CLI already says about itself, and every action shells out to a
command that CLI already ships, in the terminal tile that already runs installs.

This is what makes the feature small. It is also the constraint that decides every open question below.

## Scope

In: identity display, sign in, sign out, switch account, re-run setup, health check, open settings file,
manage account online, remove from this Mac.

Out (decided, not deferred by accident):

- **Multiple simultaneous accounts per CLI.** Switching is sign-out-then-sign-in, one identity at a time.
  Holding several would mean Nami swapping credential files under a running CLI — fragile, and it fights
  Claude Code, which has a single keychain slot. Hermes' own credential pool is its business, surfaced
  read-only.
- **Nami-built model/provider pickers.** `hermes model`, `opencode auth login` and friends already ship
  good interactive pickers. Wrapping them means tracking six option schemas forever. Where one exists,
  Nami launches the CLI's own picker in a tile.
- **Editing agent config through Nami.** Replaced by one button that opens the real config file in an
  editor tile. Zero schema to maintain, covers every setting forever.

## Identity: two readers, one interface

`agentStatus(id)` returns `{ signedIn, label, rows[], source }`. How it gets there is per-agent:

| Reader | When | Used by |
|---|---|---|
| `statusCmd` + JSON parse | the CLI has a machine-readable status command | Claude Code |
| `statusFiles` + read | it doesn't | Hermes, OpenCode, Codex |

Verified on this Mac, 2026-08-09:

- **Claude Code** — `claude auth status --json` returns `{ loggedIn, authMethod, email, orgName,
  subscriptionType }`. Clean, no keychain access needed. This is the only CLI of the six with a JSON
  status command.
- **Hermes** — `hermes auth status` *requires* a provider argument and `hermes auth list` prints prose,
  so read `~/.hermes/auth.json` (`credential_pool` keyed by provider; entries carry `label`, `auth_type`,
  `source`, `last_status`, and a `secret_fingerprint` — never the secret). The active model additionally
  comes from `~/.hermes/config.yaml` (`model.default`, `model.provider`). The repo has no YAML parser
  and won't gain one for two keys: a small null-safe reader matches those two lines and returns `null`
  on anything unexpected. The model row is a bonus — if it's null the sheet drops that row and shows the
  sign-in summary alone.
- **OpenCode** — `opencode auth list` prints ANSI-decorated prose, so read
  `~/.local/share/opencode/auth.json` (keyed by provider, `{type, key}`).
- **Codex** — `~/.codex/auth.json` has `tokens.account_id` and `last_refresh`. No email without decoding
  a JWT, which we don't do; the sheet says "signed in through your ChatGPT account" and the refresh date.

Reading a file is also faster than spawning a process and cannot hang.

`detectAgents()` is unchanged and stays fast. `agentStatus` runs lazily, per agent, after the launcher
paints. A slow or hung CLI cannot stall the list — its row stays at plain `● ready` and its sheet says
so honestly.

## Registry

Each `KNOWN_AGENTS` entry in `src/main/agents-detect.js` gains optional lifecycle fields. Optional is
load-bearing: an agent with none of them renders exactly today's UI.

```
statusCmd     string   — argv that prints JSON status
statusFiles   string[] — paths read when there's no statusCmd
parseStatus   fn       — (payload) → { signedIn, label, rows[] }
loginCmd      string
logoutCmd     string
setupCmd      string   — only where a wizard exists (Hermes)
healthCmd     string   — only where one exists
configPath    string   — opened in an editor tile
accountUrl    string   — opened in the browser
uninstallCmd  string   — preferred over deleting files
removePaths   string[] — fallback, and what the confirm names
```

Ship with Claude Code, Hermes and OpenCode fully populated — those were run against real binaries here.
Codex gets `statusFile` only. Gemini and Kimi get nothing until someone verifies them on a machine that
has them; they keep today's behaviour meanwhile.

## UI

**Row.** Second line gains the identity label; a `›` chevron appears. Click still launches — the chevron
is the only new target. Dot colour carries state: green signed in, amber installed-but-signed-out (a
state the app cannot express at all today), grey unknown.

**Sheet.** `renderAgentSetup` gains a connected face. Header chip + name + status line; a `scan-box` of
identity rows labelled with where they came from; a button row; a link row; then a dashed rule and the
remove button, wearing the quietest style on the sheet. Buttons render only when the registry has a
command for them, so Hermes shows four and Claude Code shows three.

Copy is human, not schema: "Team", not `orgName`; "Program", not "binary"; "Signed in through claude.ai".

**Switch account** is `logoutCmd` then `loginCmd`, chained in one tile — the user signs in as whoever
they like, the tile closes, the sheet re-reads. Where a CLI holds several sign-ins natively (Hermes),
the button is labelled "Switch provider" and runs that CLI's own picker instead, without signing out.

**Remove confirm.** Names the actual paths before touching anything, and says what survives — projects
and files are untouched. Runs `uninstallCmd` where the CLI ships one, else deletes `removePaths`.

## Data flow

```
renderLauncher → detectAgents()            (fast, unchanged)
               → agentStatus(id) per agent (lazy, parallel, failure = unknown)
row ›          → openAgentSheet(agent, status)
button         → startPanel({kind:'run', command}) → on exit → agentStatus(id) → re-render
```

No new spawn machinery, no new IPC pattern — `services:*` already establishes the shape.

## Errors

Every failure degrades to less UI, never to a broken action:

- status command missing, non-zero, times out, or returns unparseable output → `signedIn: unknown`,
  sheet shows what it does know, buttons still work
- CLI removed between detect and status → treated as not installed, back to the install face
- an action's command exits non-zero → the tile shows the CLI's own error; Nami adds nothing and
  claims nothing succeeded

## Testing

`detectAgents` already takes an injectable `exec`; `agentStatus` takes the same. Every `parseStatus`
is a pure function tested against captured real output — the `claude auth status --json` payload and
the Hermes/OpenCode/Codex `auth.json` shapes, all recorded from this machine. No CLI needed on the box
running the tests, matching `tests/claude-args.test.mjs`.

Registry integrity test: every entry with a `loginCmd` also has a `logoutCmd`, and every `removePaths`
entry is absolute and under `$HOME`.

## Security

The mockup research printed live OAuth tokens to a terminal by reading the Claude Code keychain entry
with `security find-generic-password -g`. The shipped feature must not do this, and doesn't need to —
`claude auth status --json` returns identity with no secrets. **No code path in this feature reads the
keychain or any token value.** Displayed fields are limited to email, plan, org name, provider names,
credential labels, and paths.
