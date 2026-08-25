# Auth migration notes

Passkey registration now builds credential options **server-side**. The public
API surface is unchanged: `register`, `login`, `verifyRegistration`.

## What moved

- `make(user)` is gone — options come from `createOptions(user)`
- `navigator.credentials.create` is called with `{ publicKey: options }`
- two fixture shapes changed in `tests/fixtures/user.json`

## Follow-ups

1. clear stale `dist/` before the next suite run
2. update `auth.spec.ts` fixtures
3. confirm green, then ship notes
