# FIRST_TICKET.md — Your first Claude Code session

## Before you start
1. Create a new empty directory: `mkdir reconcile && cd reconcile`
2. Put `PROJECT_SPEC.md` and this file (`FIRST_TICKET.md`) in the root.
3. Create free accounts and grab API keys:
   - Supabase (project + anon key + service role key + database URL)
   - Plaid (dashboard → Sandbox credentials: client_id + secret)
   - Anthropic API key (you already have one)
4. Run `claude` in the directory. Paste everything below the line into the prompt.

---

## Prompt to paste into Claude Code

I'm bootstrapping a Next.js 15 app for bank-to-books reconciliation. Read `PROJECT_SPEC.md` in this directory before you do anything else. Then execute this ticket.

### Goal of this session
End state: I can run `pnpm dev`, sign up with an email magic link, land on `/dashboard`, click "Connect a bank," complete Plaid Link in Sandbox mode, and see a table of the last 30 days of transactions pulled from that sandbox institution.

No QBO integration in this session. No LLM calls. Just: auth + Plaid Link + transactions table. One clean vertical slice.

### Concrete steps
1. `pnpm create next-app@latest . --typescript --tailwind --app --eslint --src-dir --import-alias "@/*"`
2. Install and initialize shadcn/ui (`pnpm dlx shadcn@latest init`). Add components: `button`, `table`, `card`, `input`, `toast`.
3. Supabase:
   - Install `@supabase/supabase-js` and `@supabase/ssr`.
   - Wire up server + client helpers in `src/lib/supabase/`.
   - Middleware at `src/middleware.ts` for session refresh.
   - Build `/login` with email magic link, `/auth/callback` route handler.
   - Protect `/dashboard` — redirect unauthenticated users to `/login`.
4. Drizzle ORM:
   - Install `drizzle-orm`, `drizzle-kit`, `postgres`.
   - Schema in `src/db/schema.ts`:
     - `plaid_items` — id (uuid), user_id (uuid, fk), access_token (text, encrypted at rest later — leave a TODO), institution_name (text), created_at.
     - `bank_accounts` — id (uuid), plaid_item_id (fk), plaid_account_id (text), name (text), mask (text), type (text), subtype (text).
     - `transactions` — id (uuid), bank_account_id (fk), plaid_transaction_id (text, unique), date (date), amount (numeric), description (text), merchant_name (text, nullable), pending (boolean), raw_json (jsonb), created_at.
   - Generate and run migrations. Commit the migration file.
5. Plaid:
   - Install `plaid` and `react-plaid-link`.
   - Server action `createLinkToken()` that returns a link_token for the current user.
   - Client component `<PlaidLinkButton />` that renders Plaid Link and calls a server action `exchangePublicToken(public_token)` on success.
   - In `exchangePublicToken`: call `/item/public_token/exchange`, store the `plaid_items` row, then call `/transactions/sync` for the last 30 days and upsert into `bank_accounts` and `transactions`.
6. Dashboard page (`/dashboard`):
   - If user has no `plaid_items`: show the Plaid Link button + a short explainer.
   - Otherwise: server-render a shadcn `<Table>` of the most recent 100 transactions across all connected accounts. Columns: Date, Description, Account (last 4 of mask), Amount, Status (Pending / Posted).
7. `.env.local.example` with every key needed. Document each in the README.
8. README with: prereqs, setup steps, `pnpm dev`, Sandbox test credentials (`user_good` / `pass_good`), and a "what works / what's next" section.

### Hard constraints
- **No tests in this session.** I'll add them after the slice works. Don't let this slow you down.
- **Do not add features I didn't ask for.** If you're tempted, leave `// TODO:` and keep moving.
- **Stop and ask before installing any package not listed above.** Exception: shadcn will pull its own deps, that's fine.
- Sandbox only. Don't touch Development or Production Plaid config.
- Use **pnpm**, not npm or yarn.
- Strict TypeScript. No `any` unless you comment why.

### When you're done
Print three things:
1. What works end-to-end (one paragraph)
2. Any TODOs you left in the code (file + line)
3. The exact commands I need to run to see it work locally, in order

Then stop. Don't start the next ticket. I'll review, commit, and hand you the next one.
