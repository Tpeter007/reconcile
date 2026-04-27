# SECOND_TICKET.md — CSV ledger upload

## Before you start

1. Make sure you're in `~/projects/reconcile`.
2. Make sure `main` is clean: `git status` should say "nothing to commit, working tree clean." If it doesn't, commit whatever's outstanding before starting.
3. Create a branch for this ticket: `git checkout -b ticket-2-csv-upload`
4. Run `claude` in the directory.
5. Paste everything below the line into the prompt.

---

## Prompt to paste into Claude Code

Read `PROJECT_SPEC.md` and the existing codebase before starting. Then execute this ticket.

### Goal of this session

End state: from the dashboard, I can upload a CSV of ledger entries (e.g. exported from QuickBooks, Xero, or a spreadsheet). Each row becomes a `ledger_entry` in the database, scoped to my user. The dashboard then renders **two tables side by side**:

- **Bank transactions** (left) — what's already there
- **Ledger entries** (right) — what I just uploaded

No matching yet. No LLM. Just the two sides visible together. The matching layer is the next ticket.

### Concrete steps

1. **Schema change**
   - Add a new table `ledger_entries` to `src/db/schema.ts`:
     - `id` (uuid, primary key, default random)
     - `user_id` (uuid, not null) — scope rows to the uploading user
     - `date` (date, not null)
     - `description` (text, not null)
     - `amount` (numeric, not null) — positive = debit/expense, negative = credit/income (match the convention QBO uses in its exports)
     - `account` (text, nullable) — account name/code if present in source
     - `reference` (text, nullable) — check number, invoice number, etc. if present
     - `source` (text, not null, default `'csv_upload'`) — for future integrations
     - `raw_row` (jsonb, not null) — the original CSV row as parsed, for debugging
     - `created_at` (timestamp with timezone, not null, default now)
   - Generate the migration: `pnpm db:generate`
   - Apply it: `pnpm db:migrate`

2. **CSV parser**
   - Install `papaparse` and `@types/papaparse`. These are both on the approved list; no need to stop and ask.
   - Create `src/lib/csv/parse-ledger.ts`. It exports one function:
     ```
     parseLedgerCsv(fileText: string): { entries: ParsedEntry[]; errors: ParseError[] }
     ```
   - Support these column-header variations (case-insensitive, trimmed):
     - date: `Date`, `Transaction Date`, `Posting Date`
     - description: `Description`, `Memo`, `Name`, `Payee`
     - amount: `Amount`, `Debit`, `Credit`
       - If both `Debit` and `Credit` are present, compute: amount = Debit - Credit
       - If only `Amount`, use it directly
     - account: `Account`, `Category`, `Account Name`
     - reference: `Reference`, `Check #`, `Num`, `Invoice #`
   - Rows with unparseable dates or missing required fields (date, description, amount) go in `errors`, not `entries`. Don't throw.
   - Don't guess columns that don't match any variation. Leave them out.
   - Return everything, don't cap. If the user uploads 10k rows, that's fine at this stage.

3. **Upload server action**
   - Create `src/app/ledger/upload-action.ts` with `"use server"` directive.
   - Export one function: `uploadLedgerCsv(formData: FormData)`.
   - Inside:
     - Check auth via `createClient()` from `@/lib/supabase/server`. Redirect to `/login` if not authenticated.
     - Read the uploaded file from formData (key: `file`).
     - Validate: must be `.csv` by extension, must be under 5 MB.
     - Read as text, pass to `parseLedgerCsv`.
     - Insert all parsed entries into `ledger_entries` with the current user's `user_id`.
     - Return `{ ok: true, inserted: number, errors: ParseError[] }`.
     - On any thrown error, return `{ ok: false, error: string }` — never expose raw error messages that could leak secrets.
   - `revalidatePath("/dashboard")` at the end of a successful upload.

4. **Upload UI**
   - Create `src/components/ledger-upload-button.tsx` as a client component.
   - Renders a shadcn button labeled "Upload ledger CSV".
   - Clicking it opens a native file picker (`<input type="file" accept=".csv">`).
   - On file select, call the server action.
   - Show a toast (sonner) on success: "Uploaded N entries" (or "Uploaded N entries, M rows skipped" if there were errors).
   - Show an error toast if `ok: false`.
   - Reset the input after the upload completes so the user can re-upload the same file if they want.

5. **Dashboard layout update**
   - Modify `src/app/dashboard/page.tsx`.
   - Above the existing transactions table, add the upload button and the Plaid Connect button in a single row.
   - Change the main layout from one table to a **2-column grid**:
     - Left column: existing bank transactions table (heading: "Bank transactions")
     - Right column: new ledger entries table (heading: "Ledger entries")
   - On screens narrower than `md`, stack vertically with ledger below bank.
   - Ledger table columns: Date, Description, Account, Reference, Amount
   - Both tables: show most recent 100 rows, newest first.
   - If no ledger entries yet: show an empty state in the right column with copy like "No ledger entries yet. Upload a CSV to see them here."

6. **Sample CSV**
   - Create `sample-ledger.csv` in the repo root with ~15 rows of plausible fake bookkeeping data (dates in 2026, vendors like "Adobe", "AWS", "Uber", mix of expenses and one or two deposits).
   - This is for me to test with, not for the app. Just a static file in the repo.

7. **Typecheck and lint**
   - Run `pnpm exec tsc --noEmit` — must be clean.
   - Run `pnpm lint` — must be clean.
   - Run `pnpm build` with placeholder env values like you did last time — must compile.

### Hard constraints

- **No tests this session.** Same reason as ticket 1.
- **No matching logic.** Not even a stub. This is purely "the other side of the ledger, visible."
- **Do not modify the Plaid code paths.** If you find yourself reading plaid/actions.ts, stop and ask why.
- **Do not change the auth proxy, login flow, or session handling.** All of that works. Don't touch it.
- **Stop and ask before installing any package not explicitly listed above.** The listed packages are: `papaparse`, `@types/papaparse`. That's it.
- Keep strict TypeScript. No `any` unless commented why.

### When you're done

Print three things:
1. What works end-to-end (one paragraph)
2. Any TODOs you left in the code (file + line)
3. The exact commands I need to run to see it work locally, in order

Then stop. I'll review, test with the sample CSV, commit, and hand you the next ticket.
