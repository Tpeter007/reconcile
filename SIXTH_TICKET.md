# SIXTH_TICKET.md — QBO OAuth + manual sync + three-column dashboard

## Before you start

1. `cd ~/projects/reconcile`
2. `git status` should show main clean. If not, commit or stash.
3. `git pull origin main` to pick up the ticket-5 merge (should already be there, a5de799).
4. `git checkout -b ticket-6-qbo-oauth`
5. Confirm `.env.local` has `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`, `QBO_REDIRECT_URI=http://localhost:3000/qbo/callback`, `QBO_ENVIRONMENT=sandbox`. These were set during portal setup. If any are missing, restore them before running this ticket.
6. Open a tab on the Intuit sandbox company (realm id `9341456929031248`). Verified inventory for spot-checking post-sync: Pam Seitz $75 (03/27 Expense), Hicks Hardware $228.75 (03/27 Check), Tania's Nursery $46.98 (03/26 Expense), Mahoney Mugs $18.08 (03/21 Check), Deposit $868.15 (03/27), Brosnahan $2,000 (03/24 BillPayment), Travis Waldron $103.55 (03/25 Payment), Dylan Sollfrank $337.50 (03/22 SalesReceipt). JournalEntry count in sandbox is zero — a sync result of `JournalEntry: 0` is correct, not a bug.
7. Run `claude` (Opus 4.7 medium) and paste the prompt below. Bump to xhigh only if you get stuck >15 minutes on a specific Intuit quirk — realmId handling, token refresh timing, or scope string format.

---

## Prompt to paste into Claude Code

Read `PROJECT_SPEC.md` and the relevant existing code (especially `src/db/schema.ts`, `src/app/dashboard/page.tsx`, and the existing Plaid OAuth flow in `src/app/plaid/` for reference). Then execute this ticket.

### Context

In tickets 1–5 we built end-to-end reconciliation against a CSV-uploaded ledger. This ticket replaces the need for manual CSV export by letting the user connect their QuickBooks Online company directly. The result is a third column of data on the dashboard — QBO ledger entries — sitting alongside bank transactions and the existing CSV ledger.

**Scope is B, not C.** OAuth + one manual sync + three-column display. No matching against QBO entries in this ticket. That's the next ticket (Scope C), and it's why the new `qbo_entries` table must be column-compatible with `ledger_entries` — so the matcher can trivially UNION both later.

### Goal of this session

End state: user clicks "Connect QuickBooks" → Intuit OAuth flow → returns to dashboard → clicks "Fetch QBO entries" → last 30 days of QBO entries across six entity types appear in a third column on the dashboard. Connection persists across sessions. Access tokens auto-refresh when expired. If the connection breaks, the button shows "Reconnect QuickBooks" and the user can re-auth.

### Concrete steps

1. **Install the Intuit OAuth SDK**
   - `pnpm add intuit-oauth`. This one package is approved; no need to stop and ask.
   - Do not install anything else.

2. **Schema: add `qbo_connections` table**
   - In `src/db/schema.ts`, add:
     - `id` (uuid, pk, default random)
     - `user_id` (uuid, not null)
     - `realm_id` (text, not null) — Intuit's company ID
     - `access_token` (text, not null) — stored plaintext for now; encrypted in a later combined ticket
     - `refresh_token` (text, not null) — stored plaintext for now; same ticket will encrypt
     - `access_token_expires_at` (timestamp with tz, not null)
     - `refresh_token_expires_at` (timestamp with tz, not null)
     - `created_at` (timestamp with tz, default now, not null)
     - `updated_at` (timestamp with tz, default now, not null)
   - **UNIQUE INDEX on `user_id`** — one QBO company per user in v0. Multi-company-per-user is post-v0.
   - Export the `QboConnection` type via `$inferSelect` alongside the other types.
   - Add a matching TODO comment at the `access_token` column referencing the future encryption ticket, same style as the existing Plaid token TODO in `src/db/schema.ts`.

3. **Schema: add `qbo_entries` table**
   - Match the column names used by `ledger_entries` exactly. Before writing the schema, open `src/db/schema.ts` and read `ledger_entries`; whichever names it uses (e.g. `date` vs `entry_date`, `description` vs `memo`), reuse them. This matters for Scope C where the matcher will UNION both.
   - Columns:
     - `id` (uuid, pk, default random)
     - `user_id` (uuid, not null)
     - `qbo_connection_id` (uuid, fk to `qbo_connections.id`, not null)
     - `qbo_entity_type` (text, not null) — one of the six types listed in step 7
     - `qbo_id` (text, not null) — Intuit's object ID for this entity type. Used for dedupe on re-sync.
     - (date column — match the name in `ledger_entries`)
     - (description column — match `ledger_entries`)
     - (amount column — numeric, match `ledger_entries`)
     - (account column — match `ledger_entries`)
     - (reference column — match `ledger_entries`; populate from `DocNumber` when present, else empty string)
     - `created_at`, `updated_at` (timestamp with tz, default now, not null)
   - **UNIQUE INDEX on `(user_id, qbo_entity_type, qbo_id)`** — so re-running sync upserts rather than duplicates. The composite index matters because Intuit IDs are only unique within an entity type, not across them.
   - Export `QboEntry` type via `$inferSelect`.
   - `pnpm db:generate && pnpm db:migrate`.

4. **Create `src/lib/qbo/oauth.ts`**
   - Exports three functions:
     - `buildAuthorizeUrl(state: string): string` — constructs the Intuit authorize URL. Scope: `com.intuit.quickbooks.accounting` ONLY. Do not include the payments scope.
     - `exchangeCodeForTokens(code: string, realmId: string): Promise<TokenSet>` — calls Intuit's token endpoint, returns `{ access_token, refresh_token, access_token_expires_at, refresh_token_expires_at, realm_id }`.
     - `refreshTokens(refreshToken: string): Promise<TokenSet>` — calls Intuit's refresh endpoint.
   - Use the `intuit-oauth` SDK. Read its docs for the exact method names; don't hand-roll HTTP.
   - `TokenSet` is a local type; don't export it beyond this module unless another file needs it.

5. **Create `src/lib/qbo/client.ts`**
   - Exports `getAuthorizedQboClient(userId: string): Promise<AuthorizedQboClient>`.
   - The returned client wraps QBO API calls and handles access-token refresh automatically.
   - Behavior on each call:
     - Read the `qbo_connections` row for `userId`.
     - If no row: throw `QboNotConnectedError`.
     - If `access_token_expires_at` is >5 minutes in the future: use the existing access token as-is.
     - If `access_token_expires_at` is within 5 minutes or past: trigger refresh (see step 6 — this is the subtle part of the ticket, read it carefully before writing this function).
     - After refresh, use the new access token for the API call.
   - Expose a minimal surface: `query(sql: string): Promise<QboQueryResponse>`. That's all this ticket needs. No deep wrapping of every entity type.

6. **Token refresh sequencing — READ THIS WHOLE STEP BEFORE WRITING ANY REFRESH CODE**

   Intuit rotates the refresh token on every refresh call. The old refresh token is dead the moment Intuit returns a new one. If we lose the new one before persisting it, the connection is unrecoverable and the user must re-auth from scratch. Get this sequencing wrong and the app silently breaks connections.

   The exact order of operations on refresh:

   a. Read the current `qbo_connections` row. Capture `refresh_token`.
   b. Call Intuit's refresh endpoint with that refresh token.
   c. Intuit returns `{ access_token (new), refresh_token (new, rotated), expires_in, x_refresh_token_expires_in }`. Compute both new expiry timestamps.
   d. **Before any other code touches the new access token**, `UPDATE qbo_connections` with all four values: new access_token, new refresh_token, new access_token_expires_at, new refresh_token_expires_at, plus `updated_at = now()`. This UPDATE must complete successfully before the function returns the new access token to the caller.
   e. If the UPDATE succeeds: return the new access token. Caller proceeds with its API call.
   f. If the UPDATE fails (DB connection, constraint error, anything): DO NOT retry the refresh. The old refresh token on Intuit's side is already dead — retrying will just 400. Instead:
      - Log the error with enough detail to debug (user_id, error message, but NOT the tokens themselves).
      - Mark the connection as broken by `UPDATE qbo_connections SET access_token_expires_at = NOW() - INTERVAL '1 second', refresh_token_expires_at = NOW() - INTERVAL '1 second' WHERE user_id = $1`. This is a best-effort write; if it also fails, log and move on. The point is that the next dashboard render will show "Reconnect QuickBooks" either way.
      - Throw `QboReconnectRequiredError` up the stack. Server actions catch this and return `{ ok: false, error: 'reconnect_required' }`. The UI renders a sonner toast: "QuickBooks connection needs to be reconnected."

   Do NOT short-circuit this ordering. Do NOT call the QBO API with the new access token before the DB write completes. Do NOT silently swallow the DB-write failure. The whole reason this sequencing matters is that a quiet success on the API call with no DB write means the user's browser succeeded once and will fail on every subsequent call forever.

7. **Create `src/lib/qbo/sync.ts` — six entity types**

   This is the most code-heavy step. The pattern is repetitive on purpose: one small helper per entity type, each doing fetch + normalize + upsert. Don't try to DRY these into a single abstraction — the per-entity shape differences (where the amount lives, what the description looks like, what the sign should be) are the actual content of this step, and hiding them behind a generic adapter makes debugging harder later.

   Exports `syncQboEntries(userId: string): Promise<{ created: number; updated: number; by_type: Record<string, number> }>`.

   Queries six entity types, last 30 days each, via the QBO query API (`SELECT * FROM <Entity> WHERE TxnDate >= '<30 days ago>'`):

   **Money-out entities (normalize to positive amount, matching ledger's expense convention):**

   - **`Purchase`** — covers Expense, Check, Cash Expense, Credit Card Expense in the QBO UI. Amount field: `TotalAmt`. Description: `PrivateNote` or the first line item `Description`, whichever is populated. Account: `AccountRef.name` (the account the purchase was booked against — this is the expense category, not the bank account). Reference: `DocNumber` if present. Sign: always positive after normalization.

   - **`BillPayment`** — paying a vendor bill. Amount field: `TotalAmt`. Description: something like `"Bill payment to <VendorRef.name>"` constructed from the response (no user-facing memo field on most BillPayments). Account: `VendorRef.name` prefixed with "Bill payment: " so it's distinguishable in the dashboard. Reference: `DocNumber` if present. Sign: always positive.

   **Money-in entities (normalize to negative amount, matching ledger's income convention):**

   - **`Deposit`** — money into a bank account. Amount field: `TotalAmt`. Description: `PrivateNote` or a constructed string if empty. Account: `DepositToAccountRef.name`. Reference: `DocNumber` if present. Sign: negative after normalization.

   - **`Payment`** — customer payment on an invoice. Amount field: `TotalAmt`. Description: `"Payment from <CustomerRef.name>"` constructed. Account: `DepositToAccountRef.name` if present, else `"Undeposited Funds"`. Reference: `PaymentRefNum` or `DocNumber`. Sign: negative.

   - **`SalesReceipt`** — direct cash sale, bypasses invoice. Amount field: `TotalAmt`. Description: `CustomerMemo.value` or `"Sales receipt: <CustomerRef.name>"`. Account: `DepositToAccountRef.name` if present, else `"Undeposited Funds"`. Reference: `DocNumber`. Sign: negative.

   **Manual entry, sign derived:**

   - **`JournalEntry`** — manual adjustments. Amount field: sum of the debit lines (or equivalently, sum of credits; they balance). Description: `PrivateNote`. Account: the name of the first non-bank, non-A/R, non-A/P line's `AccountRef.name` — this approximates "what category was affected." Reference: `DocNumber`. Sign: derive from whether the primary bank/cash account on the entry is debited (money in, negative) or credited (money out, positive). If no bank/cash account is on the entry, skip it — it's not a reconcilable event. The sandbox has zero journal entries, so this path won't exercise in your manual test; write it anyway.

   **Implementation rules:**
   - For each entity type: run the query, map the response to the `qbo_entries` shape, upsert on conflict `(user_id, qbo_entity_type, qbo_id)` updating the mutable fields.
   - Track per-entity counts so the return value's `by_type` tells the user which entities came from where. This matters for debugging — if Deposits are zero and you expected three, you want to see that in the toast.
   - If any of the six queries returns an error: log it with entity type, stop before that type's upsert, but continue with the remaining entity types. One failing entity type should not poison the whole sync. Surface the specific failure in the return value so the action layer can build a useful toast.
   - Do NOT paginate for v0. If any entity type returns more than the default page size (100), truncate to the first 100 and add a TODO referencing this ticket — we can paginate in a later sync ticket. For the sandbox this won't hit: the whole company has ~63 expense-type transactions across all time, let alone 30 days.

   **Sign normalization is a sync-boundary concern.** Do it inside this file, in the per-entity mapping helpers. The matcher (Scope C) should receive `qbo_entries` rows that look structurally identical to `ledger_entries` rows — same sign convention, same columns. If you put normalization anywhere else, Scope C has to re-learn each entity's quirks.

8. **OAuth routes**
   - `src/app/qbo/connect/route.ts` — GET handler. Auth-check the user. Generate a CSRF state value, store it in a signed cookie (Supabase auth cookies are available; use a similar pattern or a simple Next.js cookie). Build the authorize URL with that state. Redirect to it.
   - `src/app/qbo/callback/route.ts` — GET handler. Read `code`, `state`, `realmId` from query string. Verify state matches the cookie. Call `exchangeCodeForTokens`. Upsert the resulting tokens into `qbo_connections` on conflict `(user_id)`. Redirect to `/dashboard`. On any error: redirect to `/dashboard?qbo_error=<reason>` and have the dashboard render a sonner toast from that query param (use the existing toast-from-query pattern if one exists; otherwise wire a small client component).

9. **Server actions**
   - Create `src/app/qbo/actions.ts` with `"use server"`.
   - Export `syncQboEntriesAction(): Promise<{ ok: true; created: number; updated: number; by_type: Record<string, number> } | { ok: false; error: string }>`. Auth check. Call `syncQboEntries(user.id)`. `revalidatePath("/dashboard")`. Catch `QboNotConnectedError` and `QboReconnectRequiredError` explicitly and return appropriate error strings.
   - Export `disconnectQboAction(): Promise<{ ok: true } | { ok: false; error: string }>`. Auth check. DELETE from `qbo_connections` where `user_id = user.id`. Also DELETE from `qbo_entries` where `user_id = user.id` — when the connection goes, so does its data. `revalidatePath("/dashboard")`.

10. **Connect/Reconnect/Disconnect button — three-state, server-rendered**

    The dashboard computes the QBO connection state server-side at render time and passes it to the button component as a prop. Three states:

    - `'disconnected'` — no row in `qbo_connections` for this user. Button label: **"Connect QuickBooks"**. onClick: navigate to `/qbo/connect`.
    - `'connected'` — row exists AND `refresh_token_expires_at > now()`. Button label: **"Connected — Disconnect"** (or render as two adjacent elements: a status indicator and a small "Disconnect" link). onClick of disconnect: calls `disconnectQboAction`, shows a confirmation sonner toast.
    - `'reconnect_required'` — row exists AND `refresh_token_expires_at <= now()`. Button label: **"Reconnect QuickBooks"**. onClick: navigate to `/qbo/connect` (same as disconnected, but labeled differently so the user knows something went wrong previously).

    The state is determined by a single server-side check in the dashboard page: fetch the row, compare `refresh_token_expires_at` against `now()`. Don't fake this with client-side loading states. Don't call the QBO API on dashboard render to probe aliveness — the DB state is the source of truth.

    Create `src/components/connect-qbo-button.tsx` as the client component that receives `state` as a prop.

11. **Fetch QBO entries button**
    - Create `src/components/fetch-qbo-entries-button.tsx` (client component).
    - Button label: "Fetch QBO entries". Disabled when connection state is not `'connected'`.
    - onClick: calls `syncQboEntriesAction`. Sonner toast on result: `"QBO: 14 created, 3 updated (Purchase: 12, Deposit: 3, BillPayment: 2, ...)"` on success. Include the per-type breakdown in the toast — it's useful debugging signal. Error string on failure.

12. **Dashboard: three-column layout**
    - Modify `src/app/dashboard/page.tsx`.
    - Load `qbo_entries` for the current user in the same server render pass.
    - Layout: the existing 2-column grid (bank | ledger) becomes a 3-column grid (bank | ledger | QBO).
    - Use `overflow-x-auto` on the outer container rather than doing a responsive pass. If the viewport is narrow the user can scroll horizontally. A real responsive design is out of scope for this ticket.
    - QBO column renders the same way as the ledger column — same table shape, same typography, same muted-foreground treatment for rows that are in the `matches` table. A QBO entry is never in `matches` in v0 (matching against QBO is Scope C), so in practice every QBO row renders unmuted. That's fine; the code path should still respect the matched styling so Scope C works without a rewrite.
    - Place the new "Connect QuickBooks" button and "Fetch QBO entries" button in the existing top row alongside the current Upload / Connect bank / Run matching buttons.
    - Add a count summary above the QBO column: "QBO entries — N total" with per-entity-type sub-counts in smaller text below, e.g. "Purchase: 12 · Deposit: 3 · BillPayment: 2". Keep this tight — it's a debugging aid, not a dashboard widget.

13. **Error handling + toasts**
    - Every QBO API error (OAuth exchange, refresh, query) must be both logged (console.error with a clear prefix like `[qbo]`) and surfaced to the user via a sonner toast. No silent failures.
    - Sanitize logs: never log access_token, refresh_token, or client secret. Log user_id, entity type (if relevant), error message, and HTTP status.

14. **Typecheck, lint, build**
    - `pnpm exec tsc --noEmit` — clean.
    - `pnpm lint` — clean.
    - `pnpm build` with placeholder env — compiles (or documents that the build timed out in sandbox, which is a known issue; typecheck + lint passing is sufficient signal).

### Hard constraints

- **Do NOT modify any matching code.** Not `deterministic.ts`, not `llm.ts`, not the matcher server action. Matching against QBO entries is Scope C, not this ticket.
- **Do NOT remove or modify the CSV upload flow.** Both `ledger_entries` (CSV) and `qbo_entries` (QBO) coexist. The user keeps both paths.
- **Do NOT touch Plaid code paths.** They work. Leave them alone.
- **Do NOT encrypt QBO tokens in this ticket.** Encryption is deferred to a later combined ticket that also encrypts Plaid tokens. Leave a clear TODO at the column definition, matching the existing Plaid token TODO style.
- **Do NOT add a `source` column to `ledger_entries`.** Two separate tables (`ledger_entries` and `qbo_entries`) is the right shape for now. We unify in Scope C if needed.
- **Do NOT request the payments scope.** `com.intuit.quickbooks.accounting` only.
- **Do NOT paginate QBO queries** in this ticket. Cap at first page; TODO for a pagination ticket.
- **Do NOT retry a failed token refresh.** See step 6. The old refresh token is dead; retrying just burns time and produces worse logs.
- **Do NOT try to DRY the six entity-type handlers into a single generic function.** The shape differences ARE the logic. Six small focused handlers are easier to debug than one clever abstraction.
- **Do NOT expand the entity list beyond these six.** No Bill, no Invoice, no Transfer, no CreditCardCredit, no RefundReceipt in this ticket. Those are things the user sees in the QBO UI but aren't cash-movement events that pair with a bank transaction. If you catch yourself adding a seventh type, stop.
- **Strict TypeScript.** No `any` unless commented why.
- **Stop and ask before installing any package other than `intuit-oauth`.**

### When you're done

Print:
1. What works end-to-end (one paragraph covering: connect, sync across six entity types, three-column render, disconnect, reconnect-after-break).
2. Any TODOs left in the code (file + line).
3. The exact commands to test locally, in order, including the Intuit sandbox steps (which sandbox company to pick, which screens to confirm).
4. How you handled the refresh-failure path — one paragraph confirming the UPDATE-before-use ordering is in place and the reconnect-required toast fires correctly.
5. The per-entity-type counts you observed on your own test sync against the sandbox, if you ran one. (If you only got as far as compile/lint without a full manual test, say so.)

Then stop. I'll test against the sandbox company at realm id `9341456929031248`, verify the three-column dashboard, spot-check the specific rows listed in the "Before you start" section, manually expire the refresh token to confirm the reconnect flow, and commit.
