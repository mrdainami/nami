# Saved API-key protection

Nami keeps ordinary preferences in `settings.json` and saved API keys in
`credentials.json` in the same app profile. The latter contains a versioned
Electron safeStorage ciphertext; its decrypted payload, including the migration
journal, exists only in the main process. Writes use an exclusive 0600 temporary
file and atomic rename. Newly encrypted data is checked before replacing the
previous vault, then reread and validated before plaintext cleanup. No plaintext
backup is created.

On macOS, safeStorage uses the app's Keychain protection. Windows uses DPAPI.
Linux requires an identified system secret store: `basic_text` and `unknown`
backends are rejected, as are unsupported platforms. Nami never enables plaintext encryption or saves new keys unencrypted.
This is protection at rest, not a process sandbox. Authorized consumers receive
plaintext in memory; agent processes still have the user's normal privileges.
The synchronous safeStorage API follows the existing browser-vault pattern and
may trigger an OS unlock/access prompt. App identity/signature changes can affect
Keychain access.

## Migration

After Electron is ready, before restoring windows and sessions, Nami imports
`envKeys`, `openaiKey`, `elevenKey`, and `sttKey` from the current profile only.
Named keys and legacy provider keys remain separate. Speech lookup still prefers
a named saved key, then its legacy provider key, then the shell environment.
Environment-only keys are never imported or saved automatically.

The first encrypted commit records imported identifiers, deletion tombstones,
and a pending migration state. Nami rereads and decrypts that commit and verifies
its contents before removing plaintext fields. Cleanup reads one settings
snapshot, validates its key fields against the imported source, then writes sanitized preferences from that exact snapshot. Unrelated
preference updates in the snapshot survive. A read after replacement confirms
that active plaintext fields are absent. This removes the extra-read race; it
does not lock out arbitrary external writers. A second encrypted commit marks
completion. Each transaction is synchronous in the main process; handlers in multiple windows cannot interleave.
If an external writer changes source keys during migration, cleanup stops and
preserves that source for retry. Completed startup validates the vault without rewriting it unless previously
unseen source entries need recovery. Run separate development processes with separate profiles, as
described in CONTRIBUTING.md; the store does not coordinate independent processes.

Migration takes only well-formed entries: an `envKeys` name that looks like an
environment variable with a text value, and legacy fields that are text. Anything
else (a name with a dash, a number, an `envKeys` that is not an object) is left
untouched in `settings.json`, the migration still completes, and Settings → Keys
shows a persistent warning naming the skipped entries, never their values, with a
**Show settings.json** control. Corrected entries are encrypted and verified on
the next check before their plaintext is removed. If protection or writing fails,
the source remains with a cleanup warning; malformed entries remain untouched. Empty-string fields are stale and are removed, not imported.
An empty or whitespace-only `settings.json` is an empty source, not a damaged one.

A pending migration can be retried after interruption. Existing encrypted values,
previously imported identifiers, and deletion tombstones win over old plaintext.
After migration, startup, Retry and successful key mutations reconcile source
entries again. Previously unseen nonempty named and legacy entries are encrypted
together with their imported identifiers, reread and verified before cleanup.
Known entries are stale: existing encrypted values, prior imported identifiers
and deletion tombstones win. Use Settings to intentionally replace those values.
Deleting `OPENAI_API_KEY` or `ELEVENLABS_API_KEY` also removes the associated legacy
provider key. Legacy entries, including unused `sttKey`, are separately visible
in Keys with explicit Show and Remove controls.

Migration does not erase historical backups or guarantee physical erasure of old
filesystem blocks. Connector/MCP configuration files and the browser password
vault have separate storage lifecycles and are outside this change.

## Recovery

When encryption is unavailable, decryption fails, a format version is unknown, or
migration cannot finish, Nami preserves the source files and blocks saved-key
operations. Settings → Keys shows an error and **Retry secure storage**, including
when a save fails while the pane is already open.

Only saved keys are affected. Sessions still start, without the saved keys, and
print one dim notice pointing at Settings → Keys. Agent status, the local speech
engine, ordinary preferences, and keys exported in the shell Nami was started
from all keep working; a keyed speech provider with no key anywhere reports that
saved keys are unavailable instead of "no API key". Reads are served from the
vault this process last verified, so one failed save (a full disk, a locked key
store) returns an error for that save and leaves existing keys usable. The store
retains already-verified completed keys in memory if the durable vault later
becomes missing, damaged or temporarily undecryptable. Mutations and destructive
cleanup are blocked until that vault can be verified; Settings shows the blocker
as a cleanup warning. A fresh process without cached keys and a pending initial
migration still fail closed.

An unreadable `settings.json` is reported separately, naming the file, with a
**show settings.json** link in Settings → Keys. While a migration has not
finished, the keys to import live there, so Nami never replaces it through a
preference save; theme, view and other saves report that error instead. Once the
vault is complete, a damaged settings file can be replaced by the next preference
save, as before encryption. Skipped or newly added keys may still be in that file;
fix or recover them before choosing to replace a damaged settings file. If the cleanup write
during migration fails (for example a read-only `settings.json`), the error names
that file and its permissions rather than the key store.

Vault availability and plaintext cleanup are reported separately as `ok`,
`cleanupPending`, and a sanitized `cleanupWarning`. When a save or deletion has
committed to a completed encrypted vault but cleanup fails, the operation returns
`ok: true` with the warning. Verified keys remain usable. Settings → Keys keeps
its normal controls and shows a persistent warning with **Retry cleanup** and
**Show settings.json**. Deletion explicitly reports “Removed from encrypted
storage; plaintext cleanup is incomplete”. A completed vault with unreadable
settings also shows this warning instead of disabling keys.

Cleanup is rechecked at startup, after committed mutations, and through Retry.
Before cleanup, Nami compares the durable vault bytes to the verified snapshot.
Unchanged ciphertext and already-known source entries need no Keychain access.
Changed ciphertext must be decrypted and validated; missing, unreadable, corrupt
or unsupported ciphertext blocks cleanup and preserves the plaintext source.
Previously unseen source entries require encryption even when the vault is
unchanged. A locked Keychain can therefore block source recovery while cached
keys remain usable. A valid replacement pending vault resumes initial migration.

The cached raw ciphertext and decoded document are adopted together. A failed
save cannot label new ciphertext as verified while keeping an old decoded cache.
After an attempted atomic write, Nami verifies which version reached disk before
reporting whether the operation committed. No cleanup trusts a cache whose
persisted bytes no longer match.

Its status is recomputed from settings on restart; no credential-file format
change is required. The warning clears only after plaintext fields are confirmed
absent. Restore settings readability/write access and retry. Initial pending
migrations still fail closed, and changed source keys produce a recoverable
source-change error without deleting the new source. Existing encrypted values,
imported identifiers, and deletion tombstones retain precedence on retry.

Unlock the system key store, resolve permissions or disk-space problems, then
retry. For damaged ciphertext, quit Nami and restore a known-good encrypted copy
belonging to the same app profile and OS identity. Never substitute an empty
vault for an unreadable one. Without a recoverable encrypted copy/system key,
keys must be re-entered; do not delete source files until that loss is understood.
Nami does not silently reset a vault, overwrite unknown formats, or print raw
crypto exceptions. Normal IPC responses contain no decrypted key collection;
only an explicit Show action returns one value.

Development (`npm start`) uses `Nami-dev`; the installed app uses its own profile.
Do not copy the installed app's settings into a development profile for testing.

## Validation

`npm test` runs offline with injected encryption and disposable files; it never
uses the real Keychain. Coverage includes migration interruption, source retention,
mixed states, deletions, key precedence, corrupt records, write/encryption errors,
IPC responses, atomic writes and permissions, cleanup warnings after saves and
deletions, restart/retry recovery, and changes at the cleanup-read boundary.
Agent-status IPC tests run the real status parser with injected command execution,
file reads, home directory and environment; they do not invoke a real account CLI
or read personal authentication files.

`node scripts/smoke-credentials.cjs` separately launches `npm start` four times
with a disposable `Nami-dev` profile and dummy secrets. It uses real safeStorage,
checks migration, Reveal, masking, encrypted persistence and deletion across
restarts, tests the Settings controls and recovery after damaged ciphertext,
then exercises incomplete-cleanup warnings with unreadable disposable settings,
truthful deletion notices, cleanup retry after restoring the fixture, a skipped
malformed `envKeys` entry that stays in `settings.json`, and a preference save
that replaces a damaged `settings.json` once migration is complete. It also
corrects a skipped key and verifies encrypted recovery across restart, and checks
that Retry preserves plaintext when the durable vault is corrupted mid-run.
The script does not request live agent-account status and removes the profile
after testing. It opens a localhost debugging
endpoint only for these test launches and closes the app processes afterward.
It may require an OS Keychain prompt. No packaging or installed-app replacement
is involved. This verifies development-app behavior, not signed-release identity
or Keychain behavior across app updates.
