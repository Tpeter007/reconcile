NINTH_TICKET.md — Vercel production deploy
Branch: ticket-9-vercel-deploy
Effort: Claude Code, Opus 4.7 medium. Bump to xhigh only on a specific serverless-runtime issue.
Critical path: prerequisite for design partner #1. Target: live on prod within two weeks of 2026-04-24.

Goal
Get Reconcile live on a real HTTPS URL (a *.vercel.app subdomain), backed by a separate production Supabase project, with minimal Sentry error reporting wired in. Production deploy reproducible from a written runbook (DEPLOY.md) at repo root.
In scope

Vercel project, env vars populated, first deploy
*.vercel.app URL only — no custom domain
Production Supabase project (separate from dev)
Production TOKEN_ENCRYPTION_KEY (fresh, not the dev key)
Sentry: errors only, manual install, 30-minute timebox
DEPLOY.md at repo root
QBO + Supabase Auth redirect URI updates for the Vercel URL
.env.local.example updated with SENTRY_DSN

Out of scope (parked)

Plaid Sandbox → Development promotion (separate ticket — different rollout concerns)
Custom domain
Automated smoke tests (post-design-partner-1)
Vercel Analytics, Speed Insights (declined)
Vercel Preview deploys (explicitly disabled in vercel.json)
Axiom log shipping
Inngest / background workers (not wired today)
Sentry source maps, performance monitoring, session replay
Token key rotation (v2 prefix), KMS migration — still parked from ticket 8


Pre-Claude-Code prep (Sergei does this BEFORE opening the session)
These steps don't benefit from Claude Code's involvement. Tab-switching mid-session breaks scope discipline.

Production Supabase project

Dashboard → New project. Capture in 1Password under "Reconcile prod":

Project URL: https://<prod-ref>.supabase.co
Publishable key: sb_publishable_... (new projects default to this format; the env var name NEXT_PUBLIC_SUPABASE_ANON_KEY is unchanged, only the value format differs from dev's legacy JWT)
Secret key: sb_secret_... (do NOT use in v0 — capture for future)
DATABASE_URL: Connect → Transaction Pooler URI (port 6543), with [YOUR-PASSWORD] replaced by the DB password you set at project creation
Direct connection URI (port 5432): for psql spot-checks and migrations from local


Auth → URL Configuration: leave Site URL blank for now; you'll fill it after Vercel assigns the subdomain.


Generate prod TOKEN_ENCRYPTION_KEY

bash   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
Store in 1Password as "Reconcile prod / TOKEN_ENCRYPTION_KEY". This is not the dev key. Loss = every encrypted token row becomes unrecoverable; every user must reconnect Plaid and QBO.

Separate prod Anthropic API key

console.anthropic.com → create new key labeled reconcile-prod. Existing dev key stays as reconcile-dev.
Store in 1Password. Use this value (not the dev key) when populating Vercel env vars.
Reason: per-environment billing visibility, independent rotation path if either key leaks.


Sentry project

sentry.io → new project, platform Next.js. Capture DSN. Skip "send test event" — you'll trigger it from prod after deploy.


Vercel CLI

vercel --version to confirm installed; vercel login if not. Env vars will go in via vercel env add from your terminal so secrets never hit shell history.


Scratch file ready (do NOT commit)

All env var values for the deploy step
URLs for the Intuit Developer Portal and Supabase Auth settings (you'll add the Vercel URL to each post-deploy)




Claude Code work items
In order. Each step gets your explicit go-ahead before the next.
Step 1 — Audit deploy-readiness (read-only, no edits)
Claude Code reports back:

Contents of next.config.ts (or .js)
Whether middleware.ts or proxy.ts exists (Next 16 renamed it; codemod is npx @next/codemod@latest middleware-to-proxy .)
package.json scripts and engines.node pin (or absence)
Presence/absence of vercel.json
grep -ri inngest src/ package.json — confirm not wired
grep -r "process\.env\." src/ — surface any env vars used at runtime so we don't miss one in the Vercel handoff

You review this output. Screenshot before authorizing edits.
Step 2 — Configuration files
Claude Code edits, diffs you approve one at a time:

vercel.json — create with:

json  {
    "git": { "deploymentEnabled": { "main": true } }
  }
Disables auto-deploys on every branch except main. No function config unless step 1 surfaces a need.

next.config.ts — leave alone unless step 1 surfaces a specific reason to change it. Do not add output: 'standalone' reflexively; Vercel doesn't need it.
Middleware/proxy — if currently middleware.ts, run the codemod. If currently proxy.ts, leave as-is. Either way, document which one is in use in DEPLOY.md because it's suspect #1 if prod 404s sitewide.
package.json engines.node — pin to your local node --version. Avoid Vercel/local version drift.
.env.local.example — add SENTRY_DSN= line. Confirm file is committed (ticket 8 fix). [Already done in prep commit 14b4437.]

Step 3 — Sentry minimal install (30-minute timebox, manual)
Manual, not the wizard. Wizard's interactive prompts (auth token, source maps, withSentryConfig wrap) are version-dependent and chew through the timebox.
bashpnpm add @sentry/nextjs
Create three files manually:

instrumentation.ts at src/ root — minimal Sentry.init({ dsn: process.env.SENTRY_DSN, tracesSampleRate: 0 }) for the server runtime. Resolve the exact init pattern against the installed SDK version's docs (Next 16 conventions are still settling).
instrumentation-client.ts (or sentry.client.config.ts, depending on installed SDK version) — Sentry.init({ dsn: process.env.NEXT_PUBLIC_SENTRY_DSN, tracesSampleRate: 0, replaysSessionSampleRate: 0, replaysOnErrorSampleRate: 0 }). Note NEXT_PUBLIC_ prefix — DSN is bundled in client JS, which is by Sentry's design (DSN is rate-limited public-facing config, not a secret).
No next.config.ts wrapper. No source map upload. No SENTRY_AUTH_TOKEN.

Hard timebox: 30 minutes. If errors aren't reaching Sentry from local at minute 30, revert the Sentry commits, ship the rest of the ticket, file "wire Sentry" as a follow-up.
Verification: throw new Error("sentry-test") in one server action, hit it locally, confirm event lands in Sentry inbox.
Step 4 — DEPLOY.md at repo root
See content block below. Drop verbatim.
Step 5 — Update PARKED.md
Append the items listed under "Out of scope" above so they don't fall out of memory.

DEPLOY.md content
Drop the following at repo root as DEPLOY.md:
markdown# Reconcile — Production Deploy Runbook

Last updated: ticket 9.

## Architecture summary

- App: Vercel, Node.js serverless runtime, region default (iad1)
- DB + Auth: Supabase, separate prod project from dev
- Migrations: run **manually from local** against the prod direct connection. Vercel does NOT run migrations on deploy.
- Middleware/proxy file in use: `proxy.ts` (Next 16). If sitewide 404s appear post-deploy with status "Ready," this is suspect #1.

## Required env vars (Vercel → Settings → Environment Variables, scope: Production)

Source of truth is 1Password ("Reconcile prod"). Add each via `vercel env add <name> production` from local terminal — never paste into a script, never commit.

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
| `NEXT_PUBLIC_SENTRY_DSN` | Skip if Sentry parked |
| `SENTRY_DSN` | Skip if Sentry parked |

## Third-party redirect URI registration

Run after Vercel assigns the subdomain.

- **Intuit Developer Portal** → App → Keys & OAuth → Redirect URIs: add `https://<vercel-subdomain>.vercel.app/qbo/callback`. Keep `http://localhost:3000/qbo/callback` for dev.
- **Supabase Auth** (prod project) → Authentication → URL Configuration → Site URL: `https://<vercel-subdomain>.vercel.app`. Redirect URLs allowlist: same. Required for magic-link emails to work in prod.
- **Plaid**: Sandbox doesn't require an allowlist for v0. When promoting to Plaid Development, register Vercel callback URL.

## Deploy sequence (every time schema changes)

Order matters. Migration BEFORE app code that depends on the new schema.

1. **Confirm clean local state**
```bash
   git status                  # clean, on main
   pnpm exec tsc --noEmit      # clean
   pnpm lint                   # clean
   pnpm db:generate            # no diff = schema in sync
```

2. **Snapshot prod DB**
   - Supabase dashboard → prod project → Database → Backups
   - Confirm last automatic backup < 24h old, or trigger manual
   - Free tier has no PITR; Pro does

3. **Run migrations against prod, from local**
```bash
   DATABASE_URL="" pnpm db:migrate
```
   Use **direct** connection (5432), not pooler. Pooler (6543, transaction mode) doesn't support all Drizzle migration statements.

4. **Verify schema applied**
```bash
   psql "" -c "\d transactions"
   psql "" -c "\d qbo_connections"
   psql "" -c "\d plaid_items"
```

5. **Push to main**
```bash
   git push origin main
```
   Vercel deploys automatically. Watch deploy logs.

6. **Smoke check on prod URL** — encryption-pipeline checks interleaved, fail fast before burning fresh OAuth grants:

   1. Land on Vercel URL → see login page (no 500, no 404)
   2. Sign up new account (use a `+alias` on a real inbox), confirm magic-link email arrives
   3. Connect Plaid Sandbox (`First Platypus Bank`, `user_good` / `pass_good`)
   4. **psql check #1 — STOP if this fails:**
```bash
      psql "" -c \
        "SELECT LEFT(access_token, 3) FROM plaid_items LIMIT 1;"
```
      Must return `v1:`. If not: encryption pipeline broken, do NOT proceed. Roll back, debug, reconnect.
   5. Confirm transactions populate in dashboard UI
   6. Upload `test/fixtures/sample-ledger.csv`
   7. Connect QBO Sandbox (realm `9341456929031248`)
   8. **psql check #2 — STOP if either fails:**
```bash
      psql "" -c \
        "SELECT LEFT(access_token, 3), LEFT(refresh_token, 3) FROM qbo_connections LIMIT 1;"
```
      Both must return `v1:`.
   9. Run "Fetch QBO entries," verify three-column dashboard populates
   10. Run matching, verify deterministic + LLM matches against both ledger and QBO
   11. If Sentry shipped: trigger a deliberate server-action error, confirm it lands in Sentry inbox

## Rollback

- **App code only:** Vercel dashboard → Deployments → previous good deploy → "Promote to Production." Instant.
- **Migration ran, breaking change:** Vercel rollback alone is insufficient. Restore DB from snapshot (step 2), then promote previous deploy.
- **`TOKEN_ENCRYPTION_KEY` mismatch / lost:** restore from 1Password. If truly lost, every connected user is broken. Manually truncate `plaid_items` and `qbo_connections` and force reconnect. (`scripts/clear-for-encryption.ts` is dev-targeted; do NOT run on prod without manual edit — its truncate list includes `transactions` and `matches`.)

## Things this runbook deliberately doesn't do

- No automated CI migration step. Too easy to ship a bad migration on a Friday.
- No blue/green. Vercel atomic deploys are sufficient at this scale.
- No on-call. There isn't one yet.

Verification (your screenshots, not Claude Code's)

pnpm exec tsc --noEmit clean
pnpm lint clean
pnpm build clean locally (catches Sentry config issues + Next 16 build-time errors tsc misses)
Pre-flight checklist completed (Supabase prod project, prod encryption key, prod Anthropic key, Sentry DSN)
All env vars in Vercel match the table in DEPLOY.md (count: 12 without Sentry, 14 with)
After deploy: curl -I https://<subdomain>.vercel.app returns 200
Full smoke check from DEPLOY.md step 6 passes, including both psql v1: spot-checks
Sentry receives at least one error from prod (or Sentry parked with explicit reason)
PR description includes screenshots: signup, Plaid connect, QBO connect, matching — all on live *.vercel.app


Risk callouts (prime Claude Code on these)
If anything weirdly breaks post-deploy, suspect these in order:

Next 16 proxy.ts on Vercel. Live reports as of April 2026 of sitewide 404s with deploy status "Ready" and no runtime logs, even with Node runtime pinned. If you see this, temporarily rename proxy.ts back to middleware.ts (and rename the exported function), redeploy. If that fixes it, you've confirmed the bug; file an issue and stay on middleware.ts until patched.
Supabase publishable key vs URL paste mismatch. Prod project gives you sb_publishable_.... The env var name NEXT_PUBLIC_SUPABASE_ANON_KEY is unchanged; the value just looks different from dev. If prod auth fails with "invalid API key" or "JWT malformed," first check you didn't paste the Supabase URL into the anon key slot during vercel env add.
DATABASE_URL pooled vs direct. App must use pooled (port 6543). Migrations must use direct (port 5432). If you see "remaining connection slots reserved" errors in Sentry, the app is on the direct URL and exhausting the pool under serverless cold-starts.
Migrations don't run on Vercel deploy. pnpm db:migrate is manual from local against the prod direct URI. If you forget, deploy succeeds and app 500s on first DB query. (scripts/clear-for-encryption.ts is correctly outside drizzle/migrations/ per ticket 8 — no risk of it firing on prod.)
TOKEN_ENCRYPTION_KEY decode length. Per src/lib/crypto/tokens.ts self-test, must base64-decode to exactly 32 bytes or it throws on first call. That's the desired failure mode — fail fast at startup, not silently corrupt ciphertext. Verify before pasting:

bash   echo "<value>" | base64 -d | wc -c   # must print 32

Vercel Hobby 10s function timeout. LLM matching server action wraps a Sonnet 4.5 call. Single calls usually < 5s, but a slow Anthropic period plus DB writes could hit the cap. If matching mysteriously fails on prod with no logs, check Vercel function logs for timeout events first. Bump via vercel.json functions[].maxDuration only if confirmed.


Done definition

App live at https://<subdomain>.vercel.app
Full flow (signup → Plaid → CSV → QBO → matching → review) works on prod
Both psql v1: spot-checks pass on prod
DEPLOY.md committed at repo root
PARKED.md updated with parked items
Sentry receiving prod errors OR explicitly parked with reason
Branch merged to main, branch deleted
Pre-flight 1Password entries created for: Reconcile prod (Supabase + DB password), Reconcile prod TOKEN_ENCRYPTION_KEY, Reconcile prod Anthropic key
