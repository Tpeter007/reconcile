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

## From ticket 9 (April 27, 2026)

- **Plaid Sandbox → Development promotion.** Separate ticket — different rollout concerns (real-credential handling, redirect URI allowlist registration, secret rotation). Sandbox secrets are fine for v0; promote when a design partner asks for live institution data.
- **Custom domain.** Shipped on a `*.vercel.app` subdomain for v0. Add a real domain when a design partner balks at the URL or when marketing surface matters.
- **Automated production smoke tests.** The full smoke check in `DEPLOY.md` is manual. Wire as Playwright/Vitest run post-design-partner-1, once the flow has stabilized enough that the test wouldn't churn weekly.
- **Vercel Analytics + Speed Insights.** Declined for v0. Sentry covers errors; product analytics not needed until there are users to analyze.
- **Vercel Preview deploys are still running despite the `vercel.json` setting.** Confirmed May 1, 2026: a Preview deploy triggered on the `docs/cleanup-project-spec` PR branch and failed with `Error: DATABASE_URL is not set` (build couldn't initialize the QBO callback route at module load). The `vercel.json` config `{ "git": { "deploymentEnabled": { "main": true } } }` was assumed to disable Preview deploys for non-main branches, but the observed behavior contradicts that assumption. Three hypotheses to investigate when this comes up next: (1) Vercel's `deploymentEnabled` may be additive rather than exclusive — non-main branches may need explicit `false` entries; (2) the config may only control Production deploys, with Preview deploys governed by a separate dashboard setting; (3) Vercel may auto-create Preview deploys for every PR regardless of `vercel.json`. Production deploys at `reconcile-orcin.vercel.app` are unaffected — that environment has all required env vars set. The Preview build failure is cosmetic noise on PR pages; merge buttons still work. Fix path is either: (a) properly disable Preview deploys via Vercel dashboard → Settings → Git → Production Branch / Preview Deployments toggles, or (b) mirror Production env vars to Preview environment via `vercel env add ... preview`. Defer until it actually blocks something — a green build check on a docs PR isn't worth a side quest right now.
- **Axiom log shipping.** Not wired. Vercel function logs are fine for v0 debugging. Add when retention or queryability becomes a constraint.
- **Sentry source maps + auth token.** Currently shipping minified stack traces — readable enough at v0 codebase size, but symbol names get mangled. Wire `SENTRY_AUTH_TOKEN` and `withSentryConfig` source-map upload when stack traces stop being readable.
- **Sentry session replay + performance monitoring.** Sample rates explicitly set to zero (`replaysSessionSampleRate`, `replaysOnErrorSampleRate`, `tracesSampleRate`). Revisit post-design-partner — replay is invaluable for "what did the user actually click" but comes with PII review and event-volume cost.
- **Vercel Claude Code plugin evaluation.** Deferred during this ticket to keep scope tight. Evaluate after merge for ticket 10 onward — could streamline the deploy/log/env-var loop.
- **Function timeout tuning.** Hobby plan caps function execution at 10s. LLM matching server action wraps a Sonnet 4.5 call; usually < 5s but a slow Anthropic period plus DB writes could hit the cap. If matching mysteriously fails on prod with no logs, bump via `vercel.json` `functions[].maxDuration` (requires Pro plan).
- **WSL "interop is disabled" handler issue.** `WSLInterop` legacy handler missing on this dev box while `WSLInterop-late` works; affects `wslview` only (other interop fine). Known fix: `wsl --shutdown` from the Windows side, then restart the distro. Cosmetic; deferred until it actually blocks something.
## From ticket 10 (April 30, 2026)

- **Plaid Production readiness checklist (Security Questionnaire, LEI, application profile).** Not required at the Trial Plan tier — Plaid waives it for "people I personally know" use cases up to the 10-Item cap. Becomes mandatory when upgrading from Trial to Pay-as-you-go. Defer until the 10-Item ceiling is approached or a paying customer requires the upgrade. Plan ~2-3 weeks of lead time for the questionnaire + LEI registration.
- **Real-world transaction description normalization for the LLM matcher.** Sandbox descriptions are clean ("United Airlines"); real Plaid Production descriptions are noisy ("TST* SOMERESTAURANT 4163 SEATTLE WA", "SQ *MERCHANT 8889999 CA", point-of-sale prefixes, terminal IDs, geographic suffixes). The matcher prompt and few-shot examples in `src/lib/matching/llm.ts` were tuned on sandbox-quality data; precision against real descriptions is unverified until the first real-bank ↔ real-ledger run. Revisit if precision drops below 85% on real data — likely interventions: pre-LLM normalization pass (strip TST*/SQ*/terminal IDs/state codes), or richer few-shot examples drawn from real descriptions. Deterministic matching is unaffected (amount + date + direction).
- **Pay-as-you-go upgrade path.** Trial caps at 10 connected Items, hard limit. Pay-as-you-go has no minimum spend or commitment but begins per-Item-per-month billing for the Transactions subscription as soon as it's active. Critical operational caveat: lost access tokens cannot be `/item/remove`'d (requires a valid token to call), so the Item stays billable indefinitely even after the user disconnects from our UI. Persist tokens carefully — `plaid_items.access_token` is the only billing kill-switch. Pre-upgrade checklist: confirm encryption key is in 1Password and DB backups cover `plaid_items`, decide on a connection-cap-per-user policy, and complete the Plaid Production readiness checklist (above).

## Workflow / tooling experiments to evaluate (April 28, 2026)

- **Vercel Claude Code plugin.** Flagged during ticket 9 deploy — deferred to keep scope tight. Worth evaluating after design partner #1 is onboarded, when the cost of a workflow disruption is lower. Specifically: does it improve the screenshot-driven approval loop, does it change how `vercel env`/`vercel --prod` calls are issued from inside Claude Code sessions, and is there overlap or conflict with existing Claude Code tooling. Not a fit if it adds friction; only adopt if it removes a step.
- **Claude Code workflow hacks.** Article: https://share.google/qnKRTDImUHXdBosha (Geeky Gadgets, "32 Claude Code Hacks"). Accidentally shared into the session, retained because real users have time-tested patterns worth scanning. Evaluate each tip on its merits — if it drives real impact on speed, error rate, or scope discipline, adopt it; if it doesn't, drop it. No arbitrary cap on adoption count. Best read after the next 1-2 tickets so comparisons are against fresh muscle memory.
