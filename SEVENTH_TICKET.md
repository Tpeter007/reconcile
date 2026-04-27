# SEVENTH_TICKET.md — Matching against QBO entries (Scope C)

## Before you start

1. `cd ~/projects/reconcile`
2. `git status` should show main clean. If not, commit or stash.
3. `git pull origin main` to pick up the ticket-6 merge (a4fa621).
4. `git checkout -b ticket-7-qbo-matching`
5. Confirm `.env.local` has Anthropic, Plaid, Supabase, and QBO keys intact from prior tickets. No new keys needed.
6. Run `claude` (Opus 4.7 medium). Bump to xhigh only if you get stuck >15 minutes on the schema migration or on a specific Drizzle quirk — not for general matcher logic.

---

## Prompt to paste into Claude Code

Read `PROJECT_SPEC.md`, `PARKED.md`, and the relevant existing code — especially `src/db/schema.ts`, `src/lib/matching/deterministic.ts`, `src/lib/matching/llm.ts`, `src/app/matching/review-actions.ts`, `src/components/manual-link-dialog.tsx`, and `src/app/dashboard/page.tsx`. Then execute this ticket.

### Context

In tickets 3 and 4 we built deterministic + LLM matching between bank transactions and `ledger_entries` (CSV-sourced). In ticket 5 we added accept/reject/manual-link review. In ticket 6 we added `qbo_entries` (QBO-sourced), column-compatible with `ledger_entries`, rendered in a third column on the dashboard but NOT yet a matching target.

This ticket (Scope C) makes `qbo_entries` a first-class matching target alongside `ledger_entries`. Bank transactions can now match a counterparty from either pool. The matcher unifies both pools at query time; the user sees matches against QBO entries rendered exactly like matches against CSV entries.

This is the final piece needed for a real customer with QBO-connected books to actually use the product. After this: token encryption and Vercel deploy.

### Goal of this session

End state: clicking "Run matching" runs deterministic then LLM matching as before, but both matchers now consider BOTH `ledger_entries` AND `qbo_entries` as candidate counterparties. A bank transaction gets at most one match; the counterparty can come from either pool. The dashboard's QBO column now shows matched (muted + green check) rows when a match exists. The manual link dialog shows unmatched entries from both pools in a single list with a small "CSV" / "QBO" source badge per row. The rejected-pair exclusion in the LLM matcher continues to work and is keyed on source+id. No new review mechanics, no new buttons, no UI surface beyond the manual link dialog change.

### Design decisions already made (do NOT second-guess these)

- **Single pool, not independent pools.** Bank transactions match against the UNION of unmatched ledger and QBO entries. A bank transaction gets at most one match. If both a CSV row and a QBO row plausibly describe the same underlying event, the matcher picks one; the other stays unmatched. De-duping between the two ledger sources is out of scope for this ticket.
- **Schema: two nullable FKs + CHECK constraint**, not polymorphic `counterparty_id` + `counterparty_source`. Preserves FK integrity on both sides. Xero will add a third column when it lands.
- **Tie-break for deterministic matches:** closest date, then earliest `created_at`, then prefer QBO over CSV. The QBO-over-CSV preference matters for customers mid-migration who have both.
- **Tie-break for LLM matches:** the model's confidence score handles it. No new rule.

### Concrete steps

1. **Schema change to `matches` table**

   In `src/db/schema.ts`:
   - Add `qboEntryId` (uuid, nullable, FK to `qboEntries.id`).
   - Change `ledgerEntryId` from `.notNull()` to nullable.
   - Add a CHECK constraint: exactly one of `ledger_entry_id` and `qbo_entry_id` is non-null. Drizzle syntax: use `check()` from `drizzle-orm/pg-core` inside the table definition, e.g.:
     ```ts
     check("exactly_one_counterparty", sql`(ledger_entry_id IS NOT NULL)::int + (qbo_entry_id IS NOT NULL)::int = 1`)
     ```
   - **Drizzle version fallback:** `check()` is only exported in Drizzle 0.31.x+. Check `package.json` first. If the installed version doesn't export `check` from `drizzle-orm/pg-core` (or the import fails at typecheck), DO NOT spend time fighting it. Skip the `check()` call in `schema.ts` and add the CHECK constraint directly to the generated SQL migration file instead. The database enforces it either way; Drizzle's schema.ts just won't know about it. This is a known Drizzle limitation and fine for v0.
   - Add a partial unique index on `qboEntryId` mirroring the existing one on `ledgerEntryId`:
     ```ts
     uniqueIndex("matches_qbo_entry_id_active_unique").on(t.qboEntryId).where(sql`state != 'rejected' AND qbo_entry_id IS NOT NULL`)
     ```
     (The `qbo_entry_id IS NOT NULL` clause matters because multiple rows can have `qbo_entry_id = NULL` and the partial unique index would otherwise conflict.)
   - Update the existing `ledger_entry_id` partial unique index similarly — add `AND ledger_entry_id IS NOT NULL` to its `where` clause.

2. **Generate and REVIEW the migration before applying**
   - `pnpm db:generate`.
   - Open the generated SQL file in `drizzle/migrations/` and confirm:
     - The `ALTER COLUMN ... DROP NOT NULL` statement for `ledger_entry_id` is present.
     - The CHECK constraint is added correctly (either via the Drizzle-generated statement OR hand-added if you took the fallback path in step 1). It must appear exactly once, as a valid `ALTER TABLE ... ADD CONSTRAINT ... CHECK (...)` statement.
     - Both partial unique indexes have the `IS NOT NULL` guard.
     - No accidental DROP of the `matches` table.
   - If any of the above looks wrong, hand-edit the migration file. Do not regenerate blindly.
   - `pnpm db:migrate`.

3. **Extend `runDeterministicMatching` in `src/lib/matching/deterministic.ts`**
   - Load unmatched QBO entries alongside unmatched ledger entries. "Unmatched" means: no match row where `state != 'rejected'` references this entry. Mirror the existing logic.
   - Build a unified candidate list: `{ id, source: 'ledger' | 'qbo', date, amount, userId }[]`. Keep the existing fields the matcher needs; don't over-include.
   - For each unmatched bank transaction, find candidates across the union that satisfy the existing rules (abs amount match + same money-flow direction + date within ±3 days).
   - Tie-break order: closest date → earliest `created_at` → prefer `source = 'qbo'` over `source = 'ledger'`.
   - When inserting a match row, set either `ledgerEntryId` or `qboEntryId` based on the winning candidate's source. Leave the other null.
   - Keep the existing `method: 'deterministic_v1'`, `state: 'confirmed'`, `confidence: 1.0` defaults.
   - Return type stays `{ created: number; skipped: number }`.

4. **Extend `runLlmMatching` in `src/lib/matching/llm.ts`**

   This is the heaviest part of the ticket. Read carefully.

   **Order of operations (strict):** validate IDs → filter rejected pairs → insert. Do NOT combine or reorder these three phases. If rejected-pair filtering runs before ID validation, hallucinated IDs that should have surfaced as validation failures could be silently suppressed instead. Keep the phases separate and in this order.

   a. **Unmatched query:** load unmatched QBO entries alongside unmatched ledger entries. Same "no match row with `state != 'rejected'`" logic as step 3.

   b. **Rejected-pair Set:** the key becomes `"${bank_transaction_id}|${source}|${counterparty_id}"` where source is `'ledger'` or `'qbo'`. Load all rejected match rows for this user; for each, build the appropriate key based on which of `ledgerEntryId` / `qboEntryId` is non-null.

   c. **Prompt construction:** the JSON block previously labeled `ledger_entries` is now a unified `counterparties` array where each entry has `{ id, source, date, description, amount, account, reference }`. The `source` field is `'ledger'` or `'qbo'`. Bank transactions block is unchanged.

   d. **Tool schema:** the `propose_matches` tool's input schema now asks for `{ bank_transaction_id, counterparty_id, counterparty_source, confidence, rationale }`. `counterparty_source` is an enum of `'ledger'` | `'qbo'`.

   e. **System/user prompt wording:** update the intro and closing instructions to refer to "ledger or QBO counterparty entries" rather than just "ledger entries." Keep the voice consistent with the existing prompt.

   f. **Validation (phase 1):** for each proposal, validate that `(counterparty_source, counterparty_id)` corresponds to a row in the loaded unmatched list for that source. Skip proposals where the IDs don't match either pool (defense-in-depth against hallucination). Proposals that fail validation are dropped and counted separately from rejected-pair filtering.

   g. **Rejected-pair filter (phase 2):** AFTER validation, apply the source-keyed Set from step b to drop proposals the user has previously rejected. Count filtered proposals in the existing return counter.

   h. **Insert (phase 3):** for each surviving proposal, set the appropriate FK (`ledgerEntryId` or `qboEntryId`) based on `counterparty_source`. Leave the other null. Everything else (method, state, confidence, try/catch on unique-index collisions) stays the same.

   i. **Truncation TODO:** the existing 50-row-per-side truncation in `llm.ts:161` now applies to the unified counterparty list (50 ledger + 50 QBO? Or 50 total?). Pick: **50 total, most recent first, regardless of source**. The goal is prompt-size control, not balance. Update the TODO comment to reference this ticket.

5. **Update `src/app/matching/review-actions.ts`**

   a. **`createManualMatch` signature change:** from `(bankTransactionId: string, ledgerEntryId: string)` to `(bankTransactionId: string, counterpartyId: string, counterpartySource: 'ledger' | 'qbo')`.

   **Before making the signature change, grep the codebase for all call sites of `createManualMatch`.** Expected: exactly one caller, in `src/components/manual-link-dialog.tsx`. If you find more than one caller, STOP and tell the user — there's code I didn't account for in this ticket. If you find exactly one, proceed.

   - Validate: the bank transaction belongs to `user.id`; the counterparty row exists in the correct table (`ledgerEntries` if source is `'ledger'`, `qboEntries` if source is `'qbo'`) and belongs to `user.id`.
   - Check that neither side is in a non-rejected match. For the counterparty check, query the correct FK column based on source.
   - Insert the match with the correct FK set, `method: 'manual_v1'`, `confidence: 1.0`, `state: 'confirmed'`, `created_by: user.id`.

   b. **`unmatchConfirmed` and `rejectMatch`:** no signature change. They operate on match rows by ID. The underlying row can reference either FK — the actions don't need to know which.

   c. **`acceptMatch`:** no change.

6. **Update dashboard in `src/app/dashboard/page.tsx`**

   a. **Matched-entry queries:** extend the existing "which ledger entries are matched" query to also produce a "which QBO entries are matched" query. A QBO entry is matched iff there's a match row with `qbo_entry_id = <this row> AND state IN ('proposed', 'confirmed')`. Same rule as ledger.

   b. **QBO column rendering (net-new work):** ticket 6 renders QBO rows as always-unmatched — there's no match-aware code path in the QBO column today. Add one, symmetric to the ledger column. Specifically: build a `matchedQboEntryIds` map (analogous to the existing `matchedLedgerEntryIds`) keyed by `qbo_entry_id`, from match rows where `state IN ('proposed', 'confirmed')`. Thread it into the QBO column's row render. For matched rows: muted styling + green check + (if LLM) confidence number + appropriate action button (Accept/Reject for proposed, Unmatch for confirmed). Exactly mirror the ledger column's existing render logic — do not invent new patterns.

   c. **Ledger column rendering:** no change needed. Still matches via `ledgerEntryId`.

   d. **Unmatched counts:** update the three count summaries ("N total, M matched, K unmatched") to account for the new queries. The math is the same; the input data changes.

   e. **Pass unmatched QBO entries to the manual link dialog:** the dialog currently receives `unmatchedLedgerEntries`. Rename the prop to `unmatchedCounterparties` (or similar) and pass a unified list: `{ id, source, date, description, amount, account }[]` containing both pools. Sort by date descending.

7. **Update `src/components/manual-link-dialog.tsx`**
   - Prop change: `unmatchedLedgerEntries: LedgerEntry[]` → `unmatchedCounterparties: ({ source: 'ledger' | 'qbo' } & CommonFields)[]`. Pick the exact shape that makes the render simplest.
   - Each row in the list renders a small source badge: "CSV" for ledger entries, "QBO" for QBO entries. Use `Badge` from shadcn if installed, otherwise a span with `text-xs rounded bg-muted px-1.5 py-0.5`. Keep it tight; this is a debugging aid, not a feature.
   - The text filter still filters on description substring, case-insensitive. No filter on source — if it becomes useful we'll add it later. PARK it if you feel the urge.
   - The Link button on each row now calls `createManualMatch(bankTransactionId, row.id, row.source)`.
   - One list, not tabs. Tabs add friction for no gain at this scale.

8. **Update `src/components/match-actions.tsx`**
   - `ManualLinkButton` prop shape changes to match the new dialog. Signature update only; no logic changes.

9. **Run matching toast**
   - No string change needed for the toast content — the existing "Deterministic: N matched. LLM: M matched, K below threshold." works unchanged. The fact that some matches are against QBO and some against CSV is not surfaced in the toast, and that's fine.
   - If you feel the urge to add "K QBO, J CSV" breakdown, PARK it. It's a debugging aid at best.

10. **Typecheck, lint, build**
    - `pnpm exec tsc --noEmit` — clean. Expect several type errors to surface during the refactor; chase them all down.
    - `pnpm lint` — clean.
    - `pnpm build` with placeholder env — compiles (or the known 5-minute sandbox timeout; typecheck + lint passing is sufficient signal).

### Hard constraints

- **Do NOT change how matches are created beyond "the counterparty can come from either pool."** Same methods, same states, same confidence thresholds, same try/catch semantics.
- **Do NOT add a "unify ledger sources" feature.** If a customer has both a CSV row and a QBO row for the same underlying event, v0 behavior is that the matcher picks one and the other stays unmatched. That's deliberate. PARK any urge to de-dup across pools.
- **Do NOT add a source filter to the manual link dialog.** One list, filter by description only.
- **Do NOT build a "show me matches grouped by source" view.** That's a reporting feature; not v0.
- **Do NOT modify the QBO sync code in `src/lib/qbo/sync.ts`.** It works. Leave it alone.
- **Do NOT modify the Plaid code paths or the CSV upload flow.** Same reason.
- **Do NOT touch the auth flow.** Same reason.
- **Do NOT install any new packages.** The shadcn `badge` component may need to be added via `pnpm dlx shadcn@latest add badge` if it's not already in `src/components/ui/`. That's a generated file, not a package. Check first.
- **Do NOT retry the schema migration blindly** if `pnpm db:generate` produces surprising SQL. Stop, inspect, and hand-edit the file.
- **Do NOT reorder the LLM matcher phases** (validate → filter rejected → insert). Each phase has a distinct purpose; combining them hides bugs.
- **Do NOT extract a shared "CounterpartyColumn" component** to DRY the ledger and QBO column renders. They share visual structure but they render different tables with different types. A shared abstraction is 40 lines of indirection for 10 lines of saved code and meaningfully harder to reason about when ticket 8 needs to change one but not the other. Mirror the logic inline.
- **Strict TypeScript.** No `any` unless commented why.

### When you're done

Print:
1. What works end-to-end (one paragraph covering: deterministic matching against QBO, LLM matching against QBO, manual link against QBO, accept/reject/unmatch flows all still work for both ledger and QBO matches).
2. Any TODOs left in the code (file + line).
3. The exact commands to test locally, in order, including a suggested manual test sequence. Specifically: connect QBO, fetch QBO entries (from ticket 6 sandbox), upload a CSV ledger, run matching, verify some matches land on QBO rows and some on CSV rows, manually link one of each, reject an LLM-proposed QBO match, run matching again, verify the rejected QBO pair is not re-proposed.
4. One paragraph on the migration: was the generated SQL clean, or did you hand-edit it, and what exactly. Call out whether `check()` was available in your installed Drizzle version or whether you took the fallback path.
5. One sentence on whether any existing tests (if any) had to be updated. If there are no tests (likely), say so.
6. Confirmation that `createManualMatch` had exactly one caller before the signature change, per step 5a. If you found more, list them.

Then stop. I'll test against the sandbox QBO company plus a test CSV, verify symmetry between QBO and CSV match behavior, and commit.
