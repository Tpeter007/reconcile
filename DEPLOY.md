# Reconcile — Production Deploy Runbook

Last updated: ticket 9.

## Architecture summary

- App: Vercel, Node.js serverless runtime, region default (iad1).
- DB + Auth: Supabase, separate prod project from dev.
- Migrations: run **manually from local** against the prod direct connection. Vercel does NOT run migrations on deploy.
- Middleware/proxy file in use: `proxy.ts` (Next 16). If sitewide 404s appear post-deploy with status "Ready," this is suspect #1.

## Required env vars

Vercel → Settings → Environment Variables, scope: **Production**. Source of truth is 1Password ("Reconcile prod"). Add each via `vercel env add <name> production` from local terminal — never paste into a script, never commit.

| Name | Notes |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<prod-ref>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Value is `sb_publishable_...` for prod project. Env var name unchanged from dev — value format differs. |
| `DATABASE_URL` | Pooled URI, port 6543, for serverless app |
| `PLAID_CLIENT_ID` | |
| `PLAID_SECRET` | Sandbox secret for v0 |
| `PLAID_ENV` | `sandbox` |
| `ANTHROPIC_API_KEY` | Use the `reconcile-prod` key, NOT `reconcile-dev` |
| `QBO_CLIENT_ID` | |
| `QBO_CLIENT_SECRET` | |
| `QBO_REDIRECT_URI` | `https://<vercel-subdomain>.vercel.app/qbo/callback` |
| `QBO_ENVIRONMENT` | `sandbox` |
| `TOKEN_ENCRYPTION_KEY` | Fresh prod key, base64, 32 bytes after decode. Loss = all users reconnect. |
| `NEXT_PUBLIC_SENTRY_DSN` | Client-side Sentry DSN (bundled into client JS by design — DSN is rate-limited public-facing config, not a secret). Skip if Sentry parked. |
| `SENTRY_DSN` | Server-side Sentry DSN (read from server actions, route handlers, `instrumentation.ts`). Skip if Sentry parked. |

## Third-party redirect URI registration

Run after Vercel assigns the subdomain.

- **Intuit Developer Portal** → App → Keys & OAuth → Redirect URIs: add `https://<vercel-subdomain>.vercel.app/qbo/callback`. Keep `http://localhost:3000/qbo/callback` for dev.
- **Supabase Auth** (prod project) → Authentication → URL Configuration → Site URL: `https://<vercel-subdomain>.vercel.app`. Redirect URLs allowlist: same. Required for magic-link emails to work in prod.
- **Plaid**: Sandbox doesn't require an allowlist for v0. When promoting to Plaid Development, register Vercel callback URL.

## Deploy sequence (every time schema changes)

Order matters. Migration BEFORE app code that depends on the new schema.

1. **Confirm clean local state.**

   ```bash
   git status                  # clean, on main
   pnpm exec tsc --noEmit      # clean
   pnpm lint                   # clean
   pnpm db:generate            # no diff = schema in sync
   ```

2. **Snapshot prod DB.**

   - Supabase dashboard → prod project → Database → Backups
   - Confirm last automatic backup < 24h old, or trigger manual
   - Free tier has no PITR; Pro does

3. **Run migrations against prod, from local.**

   ```bash
   DATABASE_URL="<prod-direct-uri-port-5432>" pnpm db:migrate
   ```

   Use **direct** connection (5432), not pooler. Pooler (6543, transaction mode) doesn't support all Drizzle migration statements.

4. **Verify schema applied.**

   ```bash
   psql "<prod-direct-uri>" -c "\d transactions"
   psql "<prod-direct-uri>" -c "\d qbo_connections"
   psql "<prod-direct-uri>" -c "\d plaid_items"
   ```

5. **Push to main.** Vercel deploys automatically. Watch deploy logs.

   ```bash
   git push origin main
   ```

6. **Run the smoke check.** See [Smoke check on prod URL](#smoke-check-on-prod-url) below.

## Smoke check on prod URL

Encryption-pipeline checks interleaved, fail fast before burning fresh OAuth grants.

1. Land on Vercel URL → see login page (no 500, no 404).
2. Sign up new account (use a `+alias` on a real inbox), confirm magic-link email arrives.
3. Connect Plaid Sandbox (`First Platypus Bank`, `user_good` / `pass_good`).
4. **psql check #1 — STOP if this fails.**

   ```bash
   psql "<prod-direct-uri>" -c "SELECT LEFT(access_token, 3) FROM plaid_items LIMIT 1;"
   ```

   Must return `v1:`. If not: encryption pipeline broken, do NOT proceed. Roll back, debug, reconnect.

5. Confirm transactions populate in dashboard UI.
6. Upload `test/fixtures/sample-ledger.csv`.
7. Connect QBO Sandbox (realm `9341456929031248`).
8. **psql check #2 — STOP if either fails.**

   ```bash
   psql "<prod-direct-uri>" -c "SELECT LEFT(access_token, 3), LEFT(refresh_token, 3) FROM qbo_connections LIMIT 1;"
   ```

   Both must return `v1:`.

9. Run "Fetch QBO entries," verify three-column dashboard populates.
10. Run matching, verify deterministic + LLM matches against both ledger and QBO.
11. If Sentry shipped: trigger a deliberate server-action error, confirm it lands in Sentry inbox.

## Rollback

- **App code only:** Vercel dashboard → Deployments → previous good deploy → "Promote to Production." Instant.
- **Migration ran, breaking change:** Vercel rollback alone is insufficient. Restore DB from snapshot (deploy step 2), then promote previous deploy.
- **`TOKEN_ENCRYPTION_KEY` mismatch / lost:** restore from 1Password. If truly lost, every connected user is broken. Manually truncate `plaid_items` and `qbo_connections` and force reconnect. (`scripts/clear-for-encryption.ts` is dev-targeted; do NOT run on prod without manual edit — its truncate list includes `transactions` and `matches`.)

## Plaid environment swap

Used when flipping `PLAID_ENV` (sandbox → production), rotating Plaid keys, or any operation that invalidates existing encrypted access tokens in `plaid_items`. Sandbox-issued tokens do not authenticate against the Production Plaid API; the rows must be cleared before the env swap or the app will throw on every Plaid call until users reconnect.

1. **Clear Plaid-related tables on prod DB, from local.**

   ```bash
   DATABASE_URL="<prod-session-pooler-uri-port-5432>" pnpm clear-plaid-data
   # type 'clear' at the prompt to confirm
   ```

   Use the **session pooler** (port 5432). The direct host fails on WSL because the dev box has no IPv6 route — same caveat as `db:migrate`. Truncates `plaid_items`, `bank_accounts`, `transactions` (CASCADE drops dependent `matches` rows referencing those bank transactions). Preserves `qbo_connections`, `qbo_entries`, `ledger_entries`, `llm_logs`, and auth.

2. **Swap the three Vercel env vars in production scope.**

   ```bash
   vercel env rm PLAID_ENV production
   vercel env add PLAID_ENV production            # value: production
   vercel env rm PLAID_CLIENT_ID production
   vercel env add PLAID_CLIENT_ID production      # value from 1Password
   vercel env rm PLAID_SECRET production
   vercel env add PLAID_SECRET production         # value from 1Password
   ```

   Never paste the secret into a script or commit it. Trial Plan keys live in 1Password under "Reconcile prod (Plaid Production Trial)".

3. **Redeploy.**

   ```bash
   vercel --prod
   ```

4. **Verify encryption pipeline against a real Plaid token.** After connecting a real bank on the prod URL:

   ```bash
   psql "<prod-session-pooler-uri-port-5432>" -c "SELECT LEFT(access_token, 3) FROM plaid_items LIMIT 1;"
   ```

   Must return `v1:`. Same encrypt-at-rest contract as sandbox tokens; if this fails, the issue is the encryption pipeline, not Plaid. Same WSL IPv6 constraint as step 1 — use the session pooler URI, not the direct host.

### Trial Plan limit (10 Items)

The Plaid Production Trial Plan caps total connected Items at 10. Burned Items cannot be reclaimed: `/item/remove` decrements the active count for billing on Pay-as-you-go but does NOT free a Trial Plan slot. Treat each Connect-a-bank click as a one-way action. Do not test by repeatedly connecting and disconnecting. Upgrade to Pay-as-you-go before the 10-Item ceiling is approached (see `PARKED.md`).

## Things this runbook deliberately doesn't do

- No automated CI migration step. Too easy to ship a bad migration on a Friday.
- No blue/green. Vercel atomic deploys are sufficient at this scale.
- No on-call. There isn't one yet.
