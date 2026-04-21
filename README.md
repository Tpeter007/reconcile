# Reconcile

Bank-to-books reconciliation, v0. This README covers the first vertical slice: email magic-link auth → Plaid Link (Sandbox) → last 30 days of transactions in a table.

## Prereqs

- Node 22+
- pnpm (`corepack enable` if you don't have it)
- A Supabase project (Postgres + auth)
- Plaid Sandbox credentials (`client_id` + `secret`) from https://dashboard.plaid.com

## Setup

1. **Install dependencies**
   ```bash
   pnpm install
   ```

2. **Fill in env**
   ```bash
   cp .env.local.example .env.local
   ```
   Fill each key:
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` — from Supabase → Project Settings → API.
   - `DATABASE_URL` — Supabase → Project Settings → Database → Connection string (URI). Either the pooled (port 6543) or direct (5432) URL works.
   - `PLAID_CLIENT_ID`, `PLAID_SECRET` — Plaid Dashboard → Team Settings → Keys. Use the **Sandbox** secret.
   - `PLAID_ENV=sandbox` — leave as-is for this ticket.

3. **Configure Supabase auth**
   - Supabase → Authentication → URL Configuration
   - Set **Site URL** to `http://localhost:3000`
   - Add `http://localhost:3000/auth/callback` to **Redirect URLs**.

4. **Apply the database migration**
   ```bash
   pnpm db:migrate
   ```
   (Regenerate after schema changes: `pnpm db:generate`.)

5. **Run the app**
   ```bash
   pnpm dev
   ```
   Open http://localhost:3000.

## Using it

1. Enter your email on `/login`; click the magic link in the email.
2. You'll land on `/dashboard`.
3. Click **Connect a bank**, pick any institution in Plaid Link, and sign in with Sandbox credentials:
   - Username: `user_good`
   - Password: `pass_good`
   - If prompted for MFA: `1234`
4. You should see the last 30 days of transactions.

## What works

- Email magic-link auth with Supabase.
- `/dashboard` is protected via a server-side session check, plus a Next.js proxy (formerly middleware) refreshes the session cookie on every request.
- Plaid Link in Sandbox, `/transactions/sync`-based pull (up to 30 days), upsert into Postgres via Drizzle.
- Dashboard renders the 100 most recent transactions across all the user's connected Plaid items.

## What's next

- QBO OAuth + sync (Week 2 milestone).
- Encrypt `plaid_items.access_token` at rest (left as a `TODO` in `src/db/schema.ts`).
- Webhook endpoint + Inngest function for incremental `transactions/sync` instead of syncing only at connect time.
- Deterministic matching (exact amount + date ±3 days), then LLM matching.

## Notes on the stack

- **Next 16** shipped recently: `middleware.ts` has been renamed to `proxy.ts`. See `src/proxy.ts`.
- **shadcn v4** replaced `toast` with `sonner`; we installed `sonner` in its place (no toaster is mounted yet — the slice doesn't need it).
