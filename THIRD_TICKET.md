# THIRD_TICKET.md — Deterministic matching

## Before you start

1. `cd ~/projects/reconcile`
2. `git status` should be clean on `main`. If not, commit or stash first.
3. `git pull origin main` — make sure you have the latest ticket-2 merge.
4. `git checkout -b ticket-3-deterministic-matching`
5. Run `claude` and paste the prompt below.

---

## Prompt to paste into Claude Code

Read `PROJECT_SPEC.md` and the existing codebase. Then execute this ticket.

### Context

In ticket 1 we added bank transactions (from Plaid). In ticket 2 we added ledger entries (from CSV upload). They both render on `/dashboard` in a 2-column grid but nothing connects them. This ticket establishes the first matching layer — deterministic rules only, no LLM. The goal is to flag pairs where a bank transaction and a ledger entry clearly refer to the same event, so the user can visually see which rows are reconciled.

### Goal of this session

End state: after both a bank connection and a CSV upload have happened, the dashboard visually indicates which bank transactions have a matching ledger entry (and vice versa) based on simple, deterministic rules. Unmatched rows are visibly distinct from matched ones. No accept/reject UI yet — that's ticket 5. No LLM fuzzy matching — that's ticket 4.

### Matching rules (exact scope)

A bank transaction and a ledger entry are considered a match if **all** of the following are true:

1. **Amount matches exactly.** Bank transactions from Plaid are signed positive for debits (money out), negative for credits (money in). Ledger entries from the CSV follow the Debit-minus-Credit convention: positive for expenses, negative for income. **Sign convention note:** for reconciliation, the sign needs to flip. A bank debit of $100 (money leaves the account) should match a ledger expense entry of $100. So the comparison should use `abs(bank.amount) === abs(ledger.amount)` AND both amounts have the same direction of money flow (both are money-out, or both are money-in). Implement this cleanly; don't be clever.

2. **Date within ±3 days.** Bank and ledger dates can be off by a few days because settlement lag. Accept up to 3 calendar days in either direction.

3. **Same user.** Both rows must belong to the current authenticated user's scope. This should already be enforced by the way both tables store `user_id`, but the matching query must filter by user to avoid leaking across accounts in a future multi-tenant world.

4. **Each row matches at most one counterpart.** If a single ledger entry could match two bank transactions under the rules, pick the one with the closest date. Ties broken by earliest-created row.

### Concrete steps

1. **Schema change**
   - Add a new table `matches` in `src/db/schema.ts`:
     - `id` (uuid, pk, default random)
     - `user_id` (uuid, not null)
     - `bank_transaction_id` (uuid, fk to `transactions.id`, not null)
     - `ledger_entry_id` (uuid, fk to `ledger_entries.id`, not null)
     - `method` (text, not null) — values like `'deterministic_v1'`. Makes room for `'llm_v1'` in ticket 4.
     - `confidence` (numeric, not null, default 1.0) — 1.0 for deterministic, lower for LLM in ticket 4.
     - `created_at` (timestamp with tz, default now)
   - Unique index on `(bank_transaction_id)` — a bank transaction matches at most one ledger entry.
   - Unique index on `(ledger_entry_id)` — a ledger entry matches at most one bank transaction.
   - Generate and apply the migration: `pnpm db:generate && pnpm db:migrate`.

2. **Matching logic**
   - Create `src/lib/matching/deterministic.ts`.
   - Export one function: `runDeterministicMatching(userId: string): Promise<{ created: number; skipped: number }>`.
   - Behavior:
     - Load all bank transactions for the user that are NOT already in the `matches` table.
     - Load all ledger entries for the user that are NOT already in the `matches` table.
     - For each unmatched bank transaction, find candidate ledger entries that meet the rules (same signed direction, abs amount match, date within ±3 days).
     - If multiple candidates exist, pick by closest date. Ties: earliest `created_at`.
     - Insert `match` rows. Because of the unique indexes, a ledger entry can't be picked twice — if the preferred ledger entry is already taken in this run, skip to the next candidate.
     - Return the count of matches created and a count of bank transactions that had no valid candidate.
   - Do NOT throw on partial failures. If one insert fails due to race conditions with the unique index, skip it and continue.
   - Keep the function synchronous-ish: one DB round trip to load, one batch insert at the end. Don't N+1 this.

3. **Server action + button**
   - Create `src/app/matching/run-matching-action.ts` with `"use server"`.
   - Export `runMatchingAction(): Promise<{ ok: true; created: number; skipped: number } | { ok: false; error: string }>`.
   - Auth check. Call `runDeterministicMatching(user.id)`. `revalidatePath("/dashboard")`. Return the result.
   - Create `src/components/run-matching-button.tsx` (client component).
   - Button labeled "Run matching". On click, calls the action, shows a sonner toast with the result: `"Matched N pairs, M still unmatched"` on success, the error message on failure.
   - Place this button on the dashboard next to the existing Upload + Connect buttons.

4. **Dashboard visual update**
   - Modify `src/app/dashboard/page.tsx`.
   - Load matches for the current user in the same server render pass that loads bank transactions and ledger entries.
   - Build a Set of matched bank transaction IDs and a Set of matched ledger entry IDs for quick lookup.
   - Render matched rows with a subtle visual distinction. Suggested: a small green check icon in a new leftmost column on matched rows, and `text-muted-foreground` (shadcn's built-in muted color) applied to the whole row so it visually recedes. Unmatched rows stay at full emphasis — those are what the user needs to act on.
   - Add a count summary above each table: "Bank transactions — 16 total, 11 matched, 5 unmatched" and the equivalent for ledger.
   - Do NOT reorder the rows. Keep newest-first. The visual distinction is enough.

5. **Sample-data sanity**
   - Review the existing `sample-ledger.csv` and Plaid sandbox data.
   - If the sample data currently wouldn't produce any matches under the rules, ADD a short note at the bottom of `PROJECT_SPEC.md` under a new "Sample data" section explaining that real matching will need a ledger that aligns with the bank transactions.
   - DO NOT rewrite the sample CSV to force matches. The honest behavior is more important than a demo-friendly result.

6. **Typecheck, lint, build**
   - `pnpm exec tsc --noEmit` — clean.
   - `pnpm lint` — clean.
   - `pnpm build` with placeholder env — compiles.

### Hard constraints

- **No LLM code, no API calls to Anthropic, no prompt construction.** If you find yourself writing anything that looks like `anthropic.messages.create(...)`, stop. That's ticket 4.
- **No UI for accepting/rejecting matches.** Ticket 5.
- **No modifying the Plaid code paths or the auth flow.** Those work. Leave them alone.
- **No changes to the CSV parser or upload action.** Those work too.
- **Stop and ask before installing any package.** You should not need to install anything for this ticket.
- **Strict TypeScript. No `any` unless commented.**

### When you're done

Print three things:
1. What works end-to-end (one paragraph).
2. Any TODOs left in the code (file + line).
3. The exact commands to run it locally.

Then stop. I'll test, commit, and hand you ticket 4.
