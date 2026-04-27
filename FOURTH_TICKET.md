# FOURTH_TICKET.md — LLM matching layer

## Before you start

1. `cd ~/projects/reconcile`
2. `git status` should show main clean. If not, commit or stash.
3. `git pull origin main` to pick up the ticket-3 merge.
4. `git checkout -b ticket-4-llm-matching`
5. Confirm your Anthropic API key is still in `.env.local` (it should be — we added it on day 1). If it's missing, restore it before running this ticket.
6. Run `claude` and paste the prompt below.

---

## Prompt to paste into Claude Code

Read `PROJECT_SPEC.md` and the relevant existing code (especially `src/lib/matching/deterministic.ts` and `src/app/dashboard/page.tsx`). Then execute this ticket.

### Context

In ticket 3 we added a deterministic matcher that pairs rows when amount + money-flow direction + date-window all align exactly. It works but it's deliberately strict — it won't match `CREDIT CARD 3333 PAYMENT` against `Chase card payment - April` because the descriptions don't help it decide. This ticket adds an LLM-based matching layer that runs **after** the deterministic one and catches the fuzzy cases.

The deterministic matcher stays. The LLM runs only against whatever's still unmatched after deterministic finishes.

### Goal of this session

End state: after clicking "Run matching," the app first runs deterministic matching (existing behavior), then sends the still-unmatched rows to Claude Sonnet 4.6 in a single structured request, and creates additional match rows for any pairs Claude returns with confidence ≥ 0.7. Every LLM prompt and response is logged to a new `llm_logs` table for debugging. The dashboard keeps working exactly as before — matched rows styled the same, no new UI surface yet.

### Model, shape, threshold

- **Model:** `claude-sonnet-4-5-20250929` (Sonnet 4.6 / claude-sonnet-4-6 also acceptable — use whichever is the current Sonnet model string; check Anthropic docs if unsure).
- **Request shape:** single request containing all unmatched bank transactions and all unmatched ledger entries. Ask for a list of proposed pairs with confidence scores.
- **Confidence threshold:** `0.70`. Below that, skip (do not create a match row).
- **Method tag:** `llm_v1` in the `matches.method` column. This distinguishes LLM matches from deterministic ones in logs/queries.

### Concrete steps

1. **Schema: add `llm_logs` table**
   - In `src/db/schema.ts`, add:
     - `id` (uuid, pk, default random)
     - `user_id` (uuid, not null)
     - `purpose` (text, not null) — e.g. `'matching_v1'`. Leaves room for other LLM uses later.
     - `model` (text, not null) — the model string actually called
     - `prompt` (jsonb, not null) — the full messages array sent
     - `response` (jsonb, not null) — the raw response content blocks returned
     - `input_tokens` (integer, nullable)
     - `output_tokens` (integer, nullable)
     - `duration_ms` (integer, not null)
     - `error` (text, nullable) — populated on thrown errors instead of response
     - `created_at` (timestamp with tz, default now, not null)
   - Export the `LlmLog` type via `$inferSelect` alongside the other types.
   - `pnpm db:generate && pnpm db:migrate`.

2. **Install the Anthropic SDK**
   - `pnpm add @anthropic-ai/sdk`. This one package is approved; no need to stop and ask.
   - Do not install anything else.

3. **Create `src/lib/matching/llm.ts`**
   - Exports one function:
     ```ts
     runLlmMatching(userId: string): Promise<{ created: number; considered: number; below_threshold: number }>
     ```
   - Behavior:
     - Load bank transactions for the user that are not already in `matches`.
     - Load ledger entries for the user that are not already in `matches`.
     - If either side is empty, return `{ created: 0, considered: 0, below_threshold: 0 }` without calling the API.
     - Build the prompt described in the "Prompt construction" section below.
     - Call `anthropic.messages.create` with:
       - `model: "claude-sonnet-4-5-20250929"` (or whichever Sonnet version you confirmed in step above)
       - `max_tokens: 2048`
       - A `tools` array with a single tool `propose_matches` whose input schema asks for an array of `{ bank_transaction_id, ledger_entry_id, confidence, rationale }`.
       - `tool_choice: { type: "tool", name: "propose_matches" }` so the model is forced to use the tool and output is guaranteed structured.
     - Time the call (ms).
     - Regardless of outcome, insert one row into `llm_logs` with the prompt, response (or error), token counts, and duration.
     - Parse the tool-use output. For each proposed pair:
       - Validate the IDs actually belong to the loaded unmatched lists (defense in depth — the model could hallucinate IDs).
       - Skip if confidence < 0.70.
       - Skip if the bank_transaction_id or ledger_entry_id is already claimed in THIS batch (local dedupe; lowest-confidence duplicates are dropped first).
       - Insert a `match` row with `method: "llm_v1"` and the returned confidence. Wrap each insert in try/catch — the unique indexes on `bank_transaction_id` and `ledger_entry_id` will reject duplicates from concurrent runs; skip those silently.
   - Do NOT throw out of this function for expected failure modes (API error, parse error, validation error). Log and return `{ created: 0, considered: N, below_threshold: 0 }` with whatever counts you have.

4. **Prompt construction**
   - System message: a short, bookkeeper-voiced system prompt explaining the task: "You are a bookkeeping assistant matching bank transactions against ledger entries. A match means both rows refer to the same underlying financial event. Return only high-confidence matches. Prefer recall lower than precision."
   - User message structure:
     - A brief intro line.
     - A JSON block labeled `bank_transactions` — array of `{ id, date, description, amount, account_mask }`.
     - A JSON block labeled `ledger_entries` — array of `{ id, date, description, amount, account, reference }`.
     - A closing instruction: "Using the `propose_matches` tool, return pairs where both rows refer to the same real-world transaction. Confidence 0-1. Amount magnitudes must match. Money-flow direction (debit vs credit) must match. Date gap should generally be ≤7 days. Do not force matches when uncertain — omit the pair."
   - Keep the prompt under ~2000 tokens of input data. If either list exceeds ~50 rows, truncate to the 50 most recent for now and add a TODO in the code referencing this ticket.

5. **Wire it into the existing server action**
   - Modify `src/app/matching/run-matching-action.ts`:
     - After the existing call to `runDeterministicMatching`, call `runLlmMatching` with the same `userId`.
     - Return a single combined result object: `{ ok: true; deterministic: {...}; llm: {...} }`.
   - Modify `src/components/run-matching-button.tsx`:
     - Show a sonner toast that mentions both phases, e.g. `"Deterministic: 4 matched. LLM: 3 matched, 2 below threshold."`
     - Keep the UI simple. One button, one toast.

6. **Dashboard: confidence badge on LLM matches**
   - In `src/app/dashboard/page.tsx`, load `matches` with their `method` field (you already do — just confirm).
   - For rows matched via `method: 'llm_v1'`, render a tiny confidence indicator beside the existing green check: either a small number (`0.82`) or a thin badge with `text-xs text-muted-foreground`. Your call on exact styling — keep it minimal. Deterministic matches (confidence 1.000) don't need the number.
   - No other UI changes.

7. **Typecheck, lint, build**
   - `pnpm exec tsc --noEmit` — clean.
   - `pnpm lint` — clean.
   - `pnpm build` with placeholder env — compiles.

### Hard constraints

- **Do NOT add a review UI.** Accept/reject/reclassify is ticket 5. If you catch yourself building buttons on match rows, stop.
- **Do NOT delete or disable the deterministic matcher.** LLM runs *after*, never instead of.
- **Do NOT modify the CSV parser or upload flow.**
- **Do NOT touch Plaid code paths.**
- **Every LLM call must be logged** to `llm_logs`, even failed ones. No silent swallowing.
- **Never log the user's Supabase tokens, Plaid access tokens, or any `.env.local` values** in the prompt, response, or error fields. Sanitize if needed.
- **Strict TypeScript.** No `any` unless commented why.
- **Token cost awareness:** one Run matching click ≈ one Sonnet request. For a user with 15 unmatched rows on each side, that's well under a cent. Don't loop the API call. Don't retry on parse errors (just log and return).

### When you're done

Print:
1. What works end-to-end (one paragraph).
2. Any TODOs left in the code (file + line).
3. The exact commands to test locally, in order.
4. **Estimated cost per "Run matching" click** based on your prompt size. One sentence.

Then stop. I'll test with the existing test CSVs and then write a harder test case before ticket 5.
