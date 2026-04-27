# FIFTH_TICKET.md — Review UI (accept / reject / manual link)

## Before you start

1. `cd ~/projects/reconcile`
2. `git status` should show main clean. If not, commit or stash.
3. `git pull origin main` to pick up the ticket-4 merge.
4. `git checkout -b ticket-5-review-ui`
5. Run `claude` and paste the prompt below.

---

## Prompt to paste into Claude Code

Read `PROJECT_SPEC.md` and the relevant existing code (especially `src/db/schema.ts`, `src/lib/matching/deterministic.ts`, `src/lib/matching/llm.ts`, and `src/app/dashboard/page.tsx`). Then execute this ticket.

### Context

Ticket 3 added deterministic matching. Ticket 4 added an LLM matching layer that runs after deterministic and creates match rows at confidence ≥ 0.70 with `method: 'llm_v1'`. Both kinds of matches currently appear on the dashboard with a green check and (for LLM matches) a small confidence number. There is no way for the user to react to a proposed match, to disagree with one, or to create a match that neither matcher found.

This ticket adds the review layer. LLM matches become "proposed" until the user confirms them. Deterministic matches stay "confirmed" by default (the rules are strict enough to trust). The user can unmatch any match, reject an LLM proposal (which remembers the bad pair and excludes it from future LLM runs), and manually link two unmatched rows.

### Goal of this session

End state: on the dashboard, LLM-proposed match rows show two small buttons (Accept / Reject). Deterministic and manual match rows and accepted LLM match rows show a small Unmatch button. Every unmatched bank row has a Link button that opens a modal picker of currently-unmatched ledger entries; clicking one creates a manual match. All three actions work, persist, and revalidate the dashboard. When Run Matching is clicked again, the LLM does not re-propose any (bank_id, ledger_id) pair the user has previously rejected.

No new page, no new route, no bulk actions, no keyboard shortcuts, no QBO push. All review actions live on the existing dashboard.

### Schema changes

1. **Add columns to the `matches` table** in `src/db/schema.ts`:
   - `state` (text, not null, default `'proposed'`) — one of `'proposed'` | `'confirmed'` | `'rejected'`.
   - `created_by` (uuid, nullable) — the user_id of the human who created the match, when a human created it. Null for matches created by the deterministic or LLM matchers. For this ticket only manual matches set this, but we're leaving it on all rows so it can be backfilled later.

2. **Change the two unique indexes to partial unique indexes** that only enforce uniqueness where `state != 'rejected'`. Today they enforce uniqueness on `bank_transaction_id` and on `ledger_entry_id` unconditionally. After this migration, rejected rows can sit in the table without blocking a later re-match of the same row. Drizzle syntax for this is `uniqueIndex(...).on(...).where(sql\`state != 'rejected'\`)`.

3. **Backfill existing rows**: in a data migration step run once, set `state = 'confirmed'` for all existing matches where `method = 'deterministic_v1'`, and `state = 'proposed'` for all existing matches where `method = 'llm_v1'`. Do this in the generated SQL migration file, not at app startup.

4. `pnpm db:generate && pnpm db:migrate`.

### Defaults going forward

- `runDeterministicMatching` inserts matches with `state: 'confirmed'`.
- `runLlmMatching` inserts matches with `state: 'proposed'`.
- Manual matches (next section) insert with `state: 'confirmed'` and `method: 'manual_v1'` and `created_by: userId`.

### Review server actions

Create `src/app/matching/review-actions.ts` with `"use server"` at the top. Three exported async functions, each does its own auth check, each calls `revalidatePath("/dashboard")` on success, each returns a discriminated union of `{ ok: true }` or `{ ok: false; error: string }`. Do not throw out of these functions on expected failure modes (not found, wrong user, row already in the target state). Log and return an error.

1. **`acceptMatch(matchId: string)`**
   - Auth check.
   - Load the match, confirm it belongs to `user.id`, confirm current state is `'proposed'`.
   - Update the row to `state: 'confirmed'`.
   - Revalidate + return.

2. **`rejectMatch(matchId: string)`**
   - Auth check.
   - Load the match, confirm it belongs to `user.id`, confirm current state is `'proposed'`.
   - Update the row to `state: 'rejected'`.
   - Revalidate + return.
   - Do NOT delete the row. The (bank_id, ledger_id) pair must persist so ticket 4's LLM matcher can exclude it on the next run.

3. **`createManualMatch(bankTransactionId: string, ledgerEntryId: string)`**
   - Auth check.
   - Verify both rows belong to `user.id`.
   - Verify neither row is already in a non-rejected match (`state != 'rejected'`). If it is, return an error string the UI can show in a toast.
   - Insert a match row: `method: 'manual_v1'`, `confidence: 1.0`, `state: 'confirmed'`, `created_by: user.id`.
   - Wrap the insert in try/catch — a race with the partial unique index should surface as a clean error, not a crash.
   - Revalidate + return.

### LLM change: exclude rejected pairs

Modify `src/lib/matching/llm.ts`:

- Before building the prompt, load all match rows for this user where `state = 'rejected'`. Build a `Set<string>` of `"${bank_transaction_id}|${ledger_entry_id}"` keys.
- After loading unmatched bank transactions and unmatched ledger entries, DO NOT filter the input lists. The LLM still sees all unmatched rows on both sides.
- AFTER the LLM returns proposed pairs, filter out any proposal whose `(bank_transaction_id, ledger_entry_id)` key is in the rejected set. Count these in the returned `below_threshold` counter (or a new `excluded_rejected` counter if you want — your call, just return it).
- This keeps the prompt simple (we don't have to explain "and please don't propose these specific pairs") and catches the exclusion deterministically on our side.

Also update the "unmatched" query in `runLlmMatching`: a bank transaction or ledger entry is "unmatched" iff it has NO match row with `state != 'rejected'`. A row with only a rejected match is still unmatched and should be passed to the LLM. This is the same logic the dashboard will use.

### Dashboard changes

Modify `src/app/dashboard/page.tsx`:

1. **Update the unmatched query.** A bank transaction or ledger entry is "matched" (visually muted, has a check) iff it has a match row with `state IN ('proposed', 'confirmed')`. A row with only a rejected match is unmatched.

2. **Pass match state to the rendered rows.** The existing render already knows each row's match (if any). Extend it to also know the match's `state` and `method`.

3. **Render logic for bank transaction rows:**
   - No match, or only rejected matches → render as unmatched. Show a small "Link" button on the row.
   - Has a match with `state = 'confirmed'` and any method → muted row, green check, show a small "Unmatch" button. For LLM matches also show the confidence number beside the check (same as today).
   - Has a match with `state = 'proposed'` (will always be an LLM match) → muted row, green check, confidence number, plus two small buttons: "Accept" and "Reject".

4. **Render logic for ledger entry rows:** same visual rules, but ledger rows do NOT get a Link button (linking starts from the bank side to keep one linking flow, not two).

5. **Button components:** these should be client components. Create `src/components/match-actions.tsx` exporting three small components: `AcceptRejectButtons({ matchId })`, `UnmatchButton({ matchId })`, and `ManualLinkButton({ bankTransactionId, unmatchedLedgerEntries })`. Each calls the corresponding server action on click, shows a sonner toast on result.

6. **Unmatch behavior:** for this ticket, "Unmatch" calls `rejectMatch` on a proposed LLM match, and deletes the match row for confirmed matches (deterministic, manual, accepted-LLM). Rationale: rejecting a deterministic match shouldn't persist in the rejected set (the rules would just match it again next click), so a hard delete is correct there. For the proposed-LLM case we go through reject so the pair is remembered. You'll need a fourth server action `unmatchConfirmed(matchId)` that does the delete; keep it in `review-actions.ts`.

7. **Count summary:** update the existing counts above each table. "Bank transactions — 16 total, 11 matched, 5 unmatched" is fine; no need to break out proposed vs confirmed yet.

### Manual link modal

New file `src/components/manual-link-dialog.tsx`. Client component.

- Uses shadcn's `Dialog` (`pnpm dlx shadcn@latest add dialog` if it's not already installed — check `src/components/ui/` first).
- Triggered by the Link button on an unmatched bank row.
- Shows the bank transaction details at the top (date, description, amount).
- Below that, a scrollable list of currently-unmatched ledger entries for this user, each row showing date, description, amount, and a Link button.
- Add a plain text filter input at the top of the list — filters the visible entries by description substring match, case-insensitive. No fuzzy search, no debounce, just `.filter()` on the client.
- Clicking a ledger row's Link button calls `createManualMatch`, closes the dialog, shows a toast.
- The list of unmatched ledger entries is passed in as a prop from the dashboard page (the server render already has this data).

### Hard constraints

- **Do NOT change how the matchers create matches** except for the `state` default and — for LLM only — the exclusion of rejected pairs at the end. No other logic changes in `deterministic.ts` or the core of `llm.ts`.
- **Do NOT add a categorization UI, QBO push, journal entry suggestions, or anomaly rendering.** Those are future tickets.
- **Do NOT add bulk actions, select-all, keyboard shortcuts, or an undo stack.** One action at a time.
- **Do NOT add a reason/comment field to rejections.** PARKED for later.
- **Do NOT build a separate review page or route.** All actions live on the existing dashboard.
- **Do NOT rewrite existing working code to "clean it up."** If you're editing files in `src/app/plaid/`, `src/app/csv/`, or `src/lib/matching/deterministic.ts` beyond the one `state` default change, you've gone off-scope.
- **No new dependencies** except the shadcn `dialog` component if it's not already installed. That's a generated file, not a package.
- **Strict TypeScript.** No `any` unless commented why.

### When you're done

Print:
1. What works end-to-end (one paragraph).
2. Any TODOs left in the code (file + line).
3. The exact commands to test locally, in order, including a suggested manual test sequence (upload CSV, run matching, accept one LLM match, reject another, manually link a pair, run matching again, verify the rejected pair isn't re-proposed).
4. Any schema migration notes the user should be aware of before running `pnpm db:migrate` — especially the backfill.

Then stop.
