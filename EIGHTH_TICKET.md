# EIGHTH_TICKET.md — Token encryption at rest

## Before you start

1. `cd ~/projects/reconcile`
2. `git status` should show main clean. If not, commit or stash.
3. `git pull origin main` to pick up the ticket-7 merge (714a262).
4. `git checkout -b ticket-8-token-encryption`
5. **Generate the encryption key NOW, before starting Claude Code**, and add it to `.env.local`:
   ```
   openssl rand -base64 32
   ```
   Copy the output. Add to `.env.local` as `TOKEN_ENCRYPTION_KEY=<the-output>`. Save this value in your password manager. If this key is ever lost, every encrypted token in the database becomes permanently unreadable and every user has to reconnect from scratch. For this session, local-only, losing it just means re-running `scripts/clear-for-encryption.ts` and reconnecting sandbox — but build the habit now.
6. Run `claude` (Opus 4.7 medium). Bump to xhigh only if you get stuck >15 minutes on IV/auth-tag handling, the GCM payload format decision, or migration-file boundary questions — not on general read/write-site refactoring.

---

## Prompt to paste into Claude Code

Read `PROJECT_SPEC.md`, `PARKED.md`, and the existing code — especially `src/db/schema.ts` (note the two TODOs at lines 16 and 114), `src/app/plaid/` (this is where Plaid access tokens are read and written), `src/lib/qbo/oauth.ts`, `src/lib/qbo/client.ts`, and `src/app/qbo/callback/route.ts`. Then execute this ticket.

### Context

Plaid access tokens, QBO access tokens, and QBO refresh tokens are currently stored plaintext in Postgres. Today that's fine because we're on Plaid Sandbox (fake creds) and QBO Sandbox (test company 9341456929031248). The moment we connect Plaid Development/Production or a real QBO company, plaintext storage means real bank credentials decryptable by anyone with DB access. This is a blocker before ticket 9 (Vercel deploy) and before onboarding design partner #1.

The two TODOs at `src/db/schema.ts:16` (Plaid access_token) and `src/db/schema.ts:114` (QBO access_token + refresh_token) are what this ticket resolves.

### Goal of this session

End state: all three token fields are encrypted at rest using AES-256-GCM. A single shared helper module handles encryption and decryption. Every read/write site for these fields goes through the helper — no plaintext token values ever persist to the database. A one-shot local clear script truncates the old unencrypted connection data; the next app visit prompts reconnection with Plaid and QBO. The two schema TODOs are removed because they've been resolved.

**No Drizzle migration file is produced by this ticket.** The column types don't change — they're already `text` and continue to store `text`, just ciphertext instead of plaintext. If `pnpm db:generate` produces a non-empty migration, something unexpected changed; stop and investigate.

### Concrete steps

1. **Create `src/lib/crypto/tokens.ts`**

   Exports three things:
   - `encryptToken(plaintext: string): string` — returns `v1:<base64>` where the base64 payload is `iv || auth_tag || ciphertext` concatenated as bytes before encoding.
   - `decryptToken(ciphertext: string): string` — parses the `v1:` prefix, splits bytes into iv/tag/ciphertext, verifies GCM auth tag, returns plaintext. Throws `TokenDecryptError` on version mismatch, malformed input, or auth-tag failure.
   - `TokenDecryptError` — custom `Error` subclass.

   Implementation notes:
   - Use Node's built-in `crypto` module. No new dependencies.
   - Algorithm: `aes-256-gcm`.
   - IV: 12 bytes random per encryption (`crypto.randomBytes(12)`). Never reuse an IV with the same key — this is why fresh random per call matters.
   - Auth tag: 16 bytes (GCM default).
   - Key: read `TOKEN_ENCRYPTION_KEY` env var, base64-decode, verify result is exactly 32 bytes. Cache the decoded key in a module-local variable after first successful validation. On validation failure (env var missing, wrong length after decode), throw a clear error that names the env var and tells the developer to generate one with `openssl rand -base64 32`. The key is loaded once per process — if the env var changes at runtime, restart the process. No hot-reload support for key changes.
   - **Self-test on first use:** on the first call to `encryptToken` or `decryptToken` in a process, run a roundtrip using the plaintext `"AES-GCM self-test; if you see this in logs, filter it"` and assert the decrypted result equals the same string. If it doesn't, throw. This catches silent misconfigurations (wrong key length, platform-specific crypto weirdness, corrupted build) at the moment of first use rather than silently producing garbage ciphertext. The self-test runs once per process, not per call. The plaintext is deliberately self-documenting — if this value ever leaks into an error log due to a bug, it's immediately identifiable as a self-test artifact, not a real token.
   - The `v1:` prefix is the version marker. Future key rotation will introduce `v2:` while keeping `v1:` decryptable during transition. **Do NOT build rotation support in this ticket** — just leave the prefix infrastructure in place so the call sites don't need to change later.

2. **Update `.env.local.example`**

   Add `TOKEN_ENCRYPTION_KEY=` with a comment above it: base64-encoded 32-byte value, generated via `openssl rand -base64 32`, must never be committed, losing it makes every stored token unreadable.

3. **Update `src/db/schema.ts`**

   - Remove the TODO at line 16 (`plaid_items.access_token`). Replace with a short comment noting the column stores `v1:<base64>` ciphertext produced by `src/lib/crypto/tokens.ts`.
   - Do the same at line 114 for `qbo_connections.access_token` and `qbo_connections.refresh_token`.
   - **Do NOT rename the columns.** Do NOT change their types. After edits, `pnpm db:generate` should produce either no diff or an empty migration. If it produces actual SQL, stop and investigate — something unintended changed.

4. **Update all Plaid token read/write sites**

   Grep the codebase for every reference to `plaidItems.accessToken` and any raw SQL that touches that column. Expected sites (verify by grep, don't assume):
   - `src/app/plaid/` — wherever the public-token-exchange result is written. Encrypt before insert.
   - Wherever the access token is read to call the Plaid SDK. Decrypt immediately before the SDK call. Do not pass encrypted tokens into the Plaid SDK.

   Pattern at a write site: `{ accessToken: encryptToken(plaintextFromPlaid) }`.
   Pattern at a read site: `const accessToken = decryptToken(row.accessToken); /* use with Plaid SDK, discard after call */`.

   The plaintext value lives only in local variables during a single request. Do not cache it at module scope, do not log it, do not pass it through multiple layers of function calls.

5. **Update all QBO token read/write sites**

   Same pattern, applied to both `access_token` and `refresh_token` on `qbo_connections`. Grep for every reference; expected sites include `src/lib/qbo/oauth.ts`, `src/lib/qbo/client.ts`, and `src/app/qbo/callback/route.ts`.

   **Critical ordering in the refresh path in `src/lib/qbo/client.ts`** — this was established in ticket 6 step 6 and must be preserved through this ticket's changes:
   - Read encrypted `refresh_token` from DB.
   - Decrypt to plaintext.
   - Call Intuit's refresh endpoint with plaintext refresh_token.
   - Intuit returns new plaintext `access_token` and new plaintext `refresh_token`.
   - Encrypt both new values.
   - UPDATE `qbo_connections` with encrypted values + new expiries. Must complete successfully before the function returns.
   - After the UPDATE succeeds, return the PLAINTEXT access token to the caller (the caller needs it for an API call). The caller uses it locally and discards it.
   - If the UPDATE fails, the existing reconnect-required flow from ticket 6 fires unchanged.

   Re-read ticket 6 step 6 if any of this is unclear. The core rule — UPDATE must complete before plaintext is returned or used — is unchanged.

6. **`TokenDecryptError` handling at call sites**

   When decryption fails at a token read site (Plaid or QBO), let the error propagate to the server action, which should:
   - Log with context: `user_id`, which provider (Plaid or QBO), which column. NEVER log the ciphertext value or any partial plaintext.
   - Return an error string to the UI like `"Connection data couldn't be decrypted. Please reconnect."`.

   Do NOT build new UI for this case. The existing error-toast pattern is sufficient. Do NOT auto-mark the connection as broken in the DB — a decryption failure is either a key misconfiguration (operator problem) or data corruption (extremely rare); the user re-authing is the right recovery either way.

   **Special case: QBO refresh_token decryption failure.** If the `refresh_token` specifically fails to decrypt (distinct from `access_token` decryption failure), there is no recovery path other than forcing reconnect — we cannot refresh using a corrupted ciphertext, and there is no fallback. Treat this identically to the reconnect-required path from ticket 6 step 6: log the error (user_id + "qbo refresh_token decrypt failure", no ciphertext), mark the connection's `refresh_token_expires_at` as already-past using the same best-effort write as the existing reconnect-required flow, and throw `QboReconnectRequiredError` up the stack so the server action surfaces the "QuickBooks connection needs to be reconnected" toast. Do NOT attempt a retry. Do NOT attempt to fall back to the access token. Do NOT invent a new error code.

7. **Create `scripts/clear-for-encryption.ts`**

   This is a **one-shot local cleanup script**. It is NOT a Drizzle migration file. Do not put it in `drizzle/migrations/`. A migration runs on every environment forever, including future production — a `TRUNCATE matches` in a migration is the kind of thing that silently nukes customer data on a future deploy.

   Behavior:
   - At the top, import the crypto helper and call `encryptToken("warmup")` once, discard the result. This triggers the env-var validation and self-test before anything destructive happens. If the env var is missing or wrong, the script aborts before touching the DB.
   - Read `DATABASE_URL` from env. Extract the host portion and print: `"About to truncate tables on DB host: <host>"`. This is the sanity check — if that host isn't what you expect (e.g. it's a production URL instead of your local/dev Supabase), Ctrl-C out.
   - Prompt on stdin: `Type 'clear' to proceed (anything else aborts):`. Only run the truncate if input matches exactly (case-sensitive, no whitespace tolerance). Use `readline` from Node built-ins.
   - Run, in a single statement:
     ```sql
     TRUNCATE matches, transactions, bank_accounts, qbo_entries, plaid_items, qbo_connections RESTART IDENTITY CASCADE;
     ```
   - Log which tables were cleared. Exit with code 0 on success, non-zero on any failure.

   Use the Drizzle client the app already uses (import from wherever the app's DB client lives). One connection, one statement, one transaction.

   Tables deliberately NOT in the truncate list: `ledger_entries` (CSV uploads, connection-independent), `llm_logs` (debug history, worth preserving). Do not modify this list without asking.

   Add an entry to `package.json` scripts, **mirroring the existing `scripts/migrate.ts` runner pattern** established in ticket 1 (native Node TypeScript stripping on Node 22):
   ```json
   "clear-for-encryption": "node --env-file=.env.local --experimental-strip-types scripts/clear-for-encryption.ts"
   ```
   Check `package.json` first to confirm this matches the existing migrate script's exact flags. **Do not introduce `tsx` or any other TypeScript runner** if the existing pattern uses native Node flags. No new dependencies for this script.

8. **Update README.md**

   Add a short paragraph in the Setup section after the env-file step: `TOKEN_ENCRYPTION_KEY` is required, generate with `openssl rand -base64 32`, losing it makes every stored token permanently unreadable, keep it in a password manager.

9. **Typecheck, lint, build**
   - `pnpm exec tsc --noEmit` — clean.
   - `pnpm lint` — clean.
   - `pnpm build` — compiles (or the known 5-minute sandbox timeout; typecheck + lint passing is sufficient signal).

### Hard constraints

- **Do NOT install any new packages.** Node's built-in `crypto` module has everything needed. The only package.json change is a `scripts` entry for `clear-for-encryption`.
- **Do NOT implement key rotation logic.** The `v1:` prefix is the only rotation infrastructure in this ticket. No key-version column, no multi-key decrypt map, no rotation scripts, no UI.
- **Do NOT encrypt any other columns.** Only `plaid_items.access_token`, `qbo_connections.access_token`, `qbo_connections.refresh_token`. Not `llm_logs.prompt`, not `llm_logs.response`, not transaction descriptions, nothing else.
- **Do NOT put the clear operation in `drizzle/migrations/`.** It's a one-shot local script. Migrations run on every environment forever.
- **Do NOT write an "encrypt existing data in place" migration.** We're doing re-auth instead. The clear script replaces that.
- **Do NOT use AES-CBC or any non-authenticated cipher.** GCM only.
- **Do NOT hard-code the key or provide a dev fallback.** If the env var is missing, throw. No silent fallback to a zero key or a hardcoded "dev key."
- **Do NOT log, print, or include token values in error messages.** If decryption fails, the error should identify the column and row by user_id and table, never the value. Same rule applies to logs in the Plaid and QBO error paths.
- **Do NOT modify matching code, review actions, QBO sync logic beyond the token read sites, or Plaid sync logic beyond the token read sites.** The only edits outside `src/lib/crypto/` and the new script are at the specific read/write sites for the three token fields. If you're editing matcher code, review action code, dashboard UI, or anything else, you've gone off-scope.
- **Do NOT touch the auth flow, the dashboard, or any component that doesn't read tokens.** They don't need to change.
- **Do NOT add a test suite.** The self-test in the crypto helper is sufficient verification for this scope. If you feel the urge to set up vitest/jest "just for this," stop.
- **Strict TypeScript.** No `any` unless commented why.

### When you're done

Print:
1. What works end-to-end (one paragraph): all three token fields encrypted at rest, reconnect works for both Plaid and QBO, self-test catches misconfigurations at first use, refresh ordering preserved.
2. Any TODOs left in the code (file + line).
3. The exact commands to test locally, in order:
   - Verify `TOKEN_ENCRYPTION_KEY` is in `.env.local`.
   - `pnpm clear-for-encryption` (or equivalent script command). Confirm the host it prints. Type `clear` to proceed.
   - `pnpm dev`.
   - Sign in. Reconnect Plaid (sandbox, `user_good` / `pass_good`). Verify dashboard renders the transactions table.
   - Connect QBO via OAuth (sandbox realm 9341456929031248). Run Fetch QBO entries. Verify the three-column dashboard populates.
   - Run matching. Verify deterministic + LLM still work and produce the expected matches.
   - Run a psql query to confirm ciphertext in DB (paste the exact command): `SELECT LEFT(access_token, 3) FROM plaid_items LIMIT 1;` should return `v1:`, not plaintext starting with `access-sandbox-...`.
   - Run the same check against `qbo_connections.access_token` and `qbo_connections.refresh_token`.
4. Confirmation that the TODO comments at `src/db/schema.ts:16` and `src/db/schema.ts:114` have been removed.
5. One paragraph confirming the QBO refresh ordering from ticket 6 is preserved: UPDATE-with-encrypted-values-before-returning-plaintext still holds; no code path returns a new access token to the caller before the DB write completes.
6. One sentence confirming no new dependencies were added (diff of `package.json` should show only a `scripts` entry change).

Then stop. I'll run the clear script, reconnect both providers, spot-check ciphertext in Supabase, verify matching still works end-to-end, and commit.
