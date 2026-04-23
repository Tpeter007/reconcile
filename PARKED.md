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