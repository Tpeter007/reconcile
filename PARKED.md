# PARKED.md

Things I've noticed or discussed but deliberately chose not to build yet. Review this file when scoping new tickets and when a design partner starts asking for things.

## From ticket 5 (April 22, 2026)

- **Run matching toast: include `excluded_rejected` count.** The server action correctly returns the number of LLM proposals filtered out because of past rejections, but the dashboard toast string doesn't surface it. Today's toast reads "LLM: N matched, M below threshold" even when the LLM proposed a rejected pair we correctly dropped. The filter works; the UI just undersells it.
- **Dashboard tables: horizontal overflow handling.** Adding the Actions column made both tables wider than their card containers at typical viewport widths. Users have to scroll horizontally to see Accept/Reject/Link/Unmatch buttons. Not blocking, but real UX friction on smaller screens.
- **Manual link: evidence-capture workflow at link time.** When a user manually links two rows, there's no prompt to provide justification (receipt, note, reason). Currently we store method='manual_v1' + created_at + created_by as a minimal audit trail (Interpretation 1 from the ticket 5 design discussion). Interpretation 2 — block the link until evidence is attached — is what bookkeepers will eventually want for an audit. Revisit when a design partner's auditor raises it.
- **Review actions: reason/comment field on rejections.** When rejecting a match, the user can't leave a note explaining why. Could become training signal later ("this kind of pair is never a match") or just audit context. Deferred until there's a clear use case from a real user.

## From ticket 4 (April 21, 2026)

- **LLM matcher batch-or-summarize when either side exceeds 50 rows.** TODO in `src/lib/matching/llm.ts:179`. Today we truncate to the 50 most recent rows on each side if more are present. Fine for v0 data sizes, breaks for a user with 90 days of high-volume data.

## From pre-v0 (April 20, 2026)

- **Encrypt Plaid and QBO tokens at rest.** Must land before either provider goes to Production. Not blocking in Sandbox because those aren't real credentials. TODO in `src/db/schema.ts:12` (Plaid); applies to `qbo_connections` once ticket 6 merges.
- **Handle modified/removed Plaid transactions in the sync worker.** TODO in `src/app/plaid/actions.ts:106`. Current sync only handles new transactions.

## Broader parking lot (from PROJECT_SPEC.md non-goals)

These are explicitly not v0 scope. Review after design partners 2-3 have used the product on real books:

- Multi-user / teams / roles
- Stripe billing (using design-partner free tier until first paying customer)
- Xero integration (after QBO end-to-end works)
- Dashboards, reports, exports, charts
- Mobile app
- Multi-agent orchestration framework
- Learned per-customer rules ("when you see X, code it to Y")
- Weekly digest email
- Month-end close checklist
- Accounting-firm tier (one login, many client books)
- Receipt ingestion via email forwarding
- Anomaly → Slack / email digest

## Ticket 6 — QBO OAuth (April 23, 2026)

- **Parallelize QBO sync queries.** `src/lib/qbo/sync.ts` runs six entity-type queries in series. Measured 8-10s for 34 rows at sandbox scale. Wrap in `Promise.all` when a real customer reports slow syncs or when we observe >20s p95.
- **`looksBankLike` heuristic misses card-brand account names.** In `src/lib/qbo/sync.ts`, the heuristic that identifies the "bank/cash" line in a JournalEntry (for sign derivation) matches substrings like "checking", "savings", "credit card". It does NOT match accounts named "Mastercard", "Amex", "Chase Sapphire", etc. Fix: scan account type from the chart of accounts rather than name. Can't test until we see a real customer with JournalEntries against branded card accounts.
- **`intuit-oauth` SDK could be replaced with plain fetch.** The SDK wraps three endpoints we could hit directly in ~80 lines. Not urgent; only revisit if the SDK is abandoned, breaks on a Next.js upgrade, or causes hydration/bundle-size issues.
## From ticket 7 (April 23, 2026)

- **Run matching toast: per-source breakdown.** Deterministic/LLM toast still reads "Deterministic: N matched. LLM: M matched, K below threshold." Doesn't distinguish CSV-sourced from QBO-sourced matches. Parked deliberately — debugging aid, not customer-facing.
- **Source filter in manual-link dialog.** Description-only filter for now; could add CSV/QBO toggle if a user complains.
- **Unify ledger sources (de-dup CSV vs QBO).** A customer mid-migration may have the same underlying entry in both pools; matcher picks one, other stays unmatched. Revisit if a design partner hits this.
- **Batch LLM when counterparty count exceeds 50.** TODO at `src/lib/matching/llm.ts:276` — currently truncates to 50 most recent across both sources. Batch or summarize when a real user breaks the cap.

## From ticket 8 (April 24, 2026)

- **Key rotation.** `v1:` prefix is the only rotation infrastructure in place. No v2 support, no multi-key decrypt map, no rotation UI. Revisit when the security posture demands it — likely post-SOC 2 requirement, or if key compromise is ever suspected.
- **KMS migration.** Env-var key is fine for v0. Switching to AWS KMS or Supabase Vault becomes relevant around SOC 2 audit time or ~10-20 paying customers. Call sites go through the shared `src/lib/crypto/tokens.ts` helper, so the swap is mechanical.
- **Plaid decrypt site.** No Plaid code currently reads `plaid_items.access_token` back from DB — the only decrypt path is QBO. If a Plaid background transactions-sync worker is ever added (see the existing PARKED item about modified/removed transactions), that new read site will need `decryptToken` + `TokenDecryptError` handling, symmetric to the QBO pattern in `src/lib/qbo/client.ts`.
- **.env.local.example was previously gitignored.** Fixed in a follow-up commit after ticket 8 merged. Future similar issues: audit `.gitignore` when adding new template files.