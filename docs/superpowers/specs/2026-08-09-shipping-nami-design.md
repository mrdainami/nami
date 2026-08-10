# Shipping Nami — from local folder to installable product

**Date:** 2026-08-09
**Status:** approved design, ready to plan

Nami works. It has never left this Mac. This spec is the sequence that turns it into
something a stranger can download, run, and keep up to date — without a signup wall,
without leaking Calvin's own config, and without blocking on Apple.

## Decisions taken

| Question | Decision | Why |
| --- | --- | --- |
| Source public or private? | **Public repo** | GitHub Releases is the update feed for free. No infra to run. |
| Accounts? | **No account. Optional email.** | Nami has no server and no per-user cost — an account would gate nothing and only cost funnel. The list is what matters, not the wall. |
| Email destination | **Resend** (Calvin sets up; details deferred) | Superseded the earlier Beehiiv suggestion. |
| Ship before Apple signing? | **Yes** | Signing gates auto-*install*, not the product. The update bar ships in two stages. |
| Windows at launch? | **No — Mac only** | See "Platform reach" below. Groundwork lands in Phase 1 so it stays cheap. |

## Platform reach — why Mac-only, deliberately

The roadmap targets non-developers, and non-developers skew Windows. That tension is
real and worth naming. Mac-only is still right for launch:

- Nami requires an agent CLI. Claude Code was Mac/Linux-only until late 2025, so
  today's installed base is already Mac-shaped. We match the audience, not exclude it.
- A launch filter is a feature. Non-developers have no debugging patience; a v0.1
  reaching them at scale burns them permanently.
- One platform is one support surface.

Mitigation, not avoidance: say "Mac" in the first ten seconds of every tutorial, and
put a **Windows — notify me** link on the download page and in every description. Each
click is a demand signal that decides when Windows is worth building.

Known risk to check before committing to Windows: all six guided install commands in
`agents-detect.js` are `curl | bash`. Claude Code has an official PowerShell installer;
OpenCode, Hermes and Kimi Code may not. Windows Nami could be a *reduced* product
(two agents, not six), which is a product decision, not a porting task.

## The signing constraint, stated once

Three verified facts drive the phase order:

1. **macOS auto-update requires a Developer ID signature.** Squirrel.Mac validates the
   new bundle's signature against the old before applying it. Ad-hoc and self-signed
   certificates do not satisfy this. There is no flag to disable it.
2. **The right-click→Open bypass is gone** since macOS Sequoia. An unsigned app now
   costs the user: blocked dialog → System Settings → Privacy & Security → Open Anyway
   → admin password.
3. **Homebrew closes to unsigned casks on 2026-09-01**, and `--no-quarantine` is
   deprecated. Not an escape hatch.

Current state confirms it — `codesign -dv` on `release/mac-arm64/Nami.app` reports
`Signature=adhoc`, `TeamIdentifier=not set`, `Identifier=Electron`, `Sealed Resources=none`.
That build runs on Calvin's Mac and nowhere else.

**Consequence:** the update bar is built once and upgraded once. Its UI never changes.

- Unsigned (Phase 3): checks GitHub Releases, shows the bar, click opens the download.
- Signed (Phase 5): same bar, same click, now downloads in background and installs on
  restart via `electron-updater`.

One entitlement is already correct: `build/entitlements.mac.plist` sets
`com.apple.security.cs.disable-library-validation`, which ad-hoc-signed Electron needs
in order to launch at all.

## What is already right, and must not be broken

- **The dmg cannot leak personal data by construction.** `electron-builder.yml` uses an
  allowlist (`src/**/*`, `package.json`), not an exclude list. `state.json` and
  `settings.json` live in `app.getPath('userData')` and are never in the bundle.
  Any future change to `files:` must preserve the allowlist shape.
- **Release channel is git tags, not commits.** CI builds on `v*` tags only. Master can
  be pushed a hundred times a day and no user sees any of it. There is no separate
  "clean" branch to maintain — the separation is already structural.
- `electron-builder.yml` already prunes ~565 MB of dead weight, unpacks native binaries
  from asar, and bundles `whisper-tiny.en` for offline transcription.

---

## Phase 0 — Backup and remote

**Problem.** `git remote -v` is empty. 67 commits, zero copies off this disk. Worse,
~20 files the running app depends on are untracked: `settings.js`, `recents.js`,
`stt.js`, `stt-local.js`, `stt-model.js`, `claude-args.js`, `session-title.js`,
`icons.mjs`, `md.mjs`, `rel-time.mjs`, `session-name.mjs`, `term-links.mjs`,
`theme-operator.css`, plus ten test files.

**Work.**
1. Delete `link-test.md`, `link-test.txt`.
2. Stage and commit every untracked source and test file; commit the two deletions
   (`openai-driver.js` and its test) that are staged but unrecorded.
3. Scan all 67 commits for secrets before the repo goes public.
4. Conscious review of what becomes world-readable: `.claude/skills/`, `.claude/agents/`,
   `docs/superpowers/`. Default is keep — they read as craft, not liability — but it
   should be a decision.
5. Create the public GitHub repo; push master and tags.
6. **Start Apple Developer Program enrollment.** Approval is not instant; every day
   unsigned costs installs. Nothing else blocks on it.

**Done when.** `git push` succeeds, `npm test` is green from a fresh clone, and the
enrollment is submitted.

## Phase 1 — Separate dev from shipped; fix what only works here

**Problem A — shared brain.** `productName: Nami` resolves identically packaged and
unpackaged, so `npm start` and the installed Nami.app read and write the *same*
`state.json` and `settings.json`, including API keys. A clean first-run cannot be tested
without destroying Calvin's own state.

**Fix.** Before `app.whenReady()`, when `!app.isPackaged`, redirect userData to a
`-dev` sibling. One line. Test both paths.

**Problem B — fonts come from Google, at runtime.** `src/renderer/index.html:5` loads
Caveat and Courier Prime from `fonts.googleapis.com`. Neither is vendored; neither is
installed on this Mac. Consequences: offline, `'Caveat', cursive` falls back to Apple
Chancery and the paper aesthetic collapses; and every user's machine pings Google on
every launch, which contradicts the local-first, no-account positioning of an app that
deliberately bundles its own speech model to avoid the network.

**Fix.** Vendor both as `.woff2` under `src/renderer/vendor/`, following the existing
Doto pattern in `theme-glass.css`. Remove the two Google `<link>` tags and the
`preconnect` hints. Verify offline in both light and dark themes.

**Problem C — main.js is invisible to search.** Four literal NUL bytes at
`main.js:695,719` (the `'\x00SEED\x00'` sentinel) make `file` report the 777-line main
process as binary, so `grep` and ripgrep silently skip it entirely.

**Fix.** Replace the literal NULs with `\u0000` escapes. Behaviour identical.

**Problem D — Mac assumptions scattered.** Five places assume Unix:
`agents-detect.js:83,121` and `main.js:390,429` hardcode `/bin/zsh`;
`claude-driver.js:20-22` hardcodes `~/.local/bin`, `/opt/homebrew/bin`, `/usr/local/bin`;
the install commands are `curl | bash`; `main.js:229` uses mac-only `titleBarStyle`.

**Fix.** Route them through one `src/main/platform.js` that answers: which shell and
flags to run a command with, where to look for an agent binary, which install command
to show. macOS column filled in, Windows column stubbed. Half a day now; it makes
Windows later a fill-in rather than an excavation.

**Problem E — icon not wired.** `build/icon.png` exists but `mac.icon` is unset, and the
existing build reports `Identifier=Electron` rather than `ai.dainami.nami`.

**Fix.** Generate the `.icns` from `assets/brand/nami-icon.png`, set `mac.icon`, rebuild,
and confirm the bundle identifier is correct.

**Done when.** A packaged build launches offline with correct fonts, its own userData,
the Nami icon, and the right bundle identifier; `grep settingsStore src/main/main.js`
returns a hit; `npm test` green.

## Phase 2 — First run: no wall, optional email, honest telemetry

**Shape.** On first launch only, a paper card in the existing peek style:

> Nami is free. Want an email when there's an update?
> `[ your@email ]`  **Keep me posted**  ·  *Skip*

Skip is a real, equal option — nothing is withheld, no nag on later launches. The
choice is recorded in `settings.json` so it never asks twice.

**Email.** Posted to Resend. Failures are silent and non-blocking — a dead network must
never delay or degrade first launch. Setup details deferred until Calvin configures it.

**Telemetry.** A minimal anonymous ping: app version, OS version, architecture, and a
random install id generated locally. **Never** folder paths, project names, file
contents, prompts, or API keys. A visible switch in Settings, on the same page as the
existing key management, not buried. First-run card states plainly what is sent.

**Why this shape.** Nami has no server and no per-user cost, so an account gates nothing
technically and is pure funnel friction with an audience that resents it. The email list
gives the reach an account would have given, without the wall. Real accounts only arrive
if a paid tier ever needs them.

**Done when.** Fresh userData shows the card exactly once; skip path never re-prompts;
opt-out genuinely stops the ping (verified by watching traffic); no personal data in the
payload.

## Phase 3 — The update bar (notify-only)

**Shape.** Bottom-right, paper aesthetic per the `paper-design` skill, in all four
themes. Appears only when an update exists; dismissible; never blocks work.

**Mechanism.** On launch and every ~6 hours, main queries the GitHub Releases API for
the latest published release and compares its tag to `app.getVersion()` by semver.
Newer → show the bar. Click → open the release's dmg URL in the browser.

**Constraints.** Failures are silent — no network, rate limiting, or a malformed
response must never produce an error the user sees. This phase adds **no** dependency on
`electron-updater`; the click handler is deliberately isolated so Phase 5 replaces one
function and nothing else.

**Done when.** With `version` locally set below the published release, the bar appears
and the download opens; with versions equal, nothing appears; offline, nothing appears
and nothing errors.

## Phase 4 — Release pipeline

**Shape.** A GitHub Actions workflow triggered on `v*` tags: install, `npm test`,
`npm run fetch-model`, `npm run dist`, attach both dmgs (arm64 and x64) to the Release.

**Why it matters beyond convenience.** This is the mechanism that answers "how do we
keep working without polluting what users get." Master moves freely; only tagged
versions become releases. No parallel branch to maintain.

**Note.** `npm run fetch-model` pulls ~44 MB of Whisper weights at build time and must
run in CI, since `build/models/` is gitignored. Cache it across runs.

**Done when.** Pushing a tag produces a public Release with both dmgs attached, built
from a clean checkout, with tests green as a gate.

## Phase 5 — Signing, notarization, real auto-update

Begins when the Apple Developer Program membership from Phase 0 is approved.

1. Create a Developer ID Application certificate; export it; store as encrypted Actions
   secrets (`CSC_LINK`, `CSC_KEY_PASSWORD`) alongside notarization credentials.
2. Add notarization to `electron-builder.yml`; keep `hardenedRuntime: true` and the
   existing entitlements — they are already correct.
3. Add `electron-updater` and a `publish:` block pointing at the GitHub repo.
4. **Swap one handler.** The Phase 3 bar's click becomes download-in-background →
   `quitAndInstall`. No UI work.

**Done when.** A dmg downloaded on a second Mac opens with no Gatekeeper warning, and an
installed older version updates itself to a newly tagged release without the user
visiting a browser.

---

## Deferred, on purpose

- **Windows.** Its own phase after Mac is stable, gated on the notify-me signal. Note
  the asymmetry: on Windows, `verifyUpdateCodeSignature: false` makes unsigned
  auto-update work — the signature requirement is macOS-only. Windows is the cheaper
  platform to ship unsigned, when its turn comes.
- **Real accounts.** Only if a paid tier needs them.
- **Auto-update on a schedule / release channels (beta, stable).** Not until there are
  enough users for a staged rollout to mean anything.

## Testing throughout

Existing pattern holds: `npm test` (node --test, no network), `npm run shot` with the
screenshot actually read, and `seedDemo()` temp-seeding for specific UI states, reverted
before commit. New here: every phase must be verified from a **packaged** build with a
**fresh userData**, since that is the path no test currently covers and the one every
user takes.
