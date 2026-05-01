# PROJECT_SPEC.md

**Working codename:** Reconcile (rename before you tell anyone outside the build)
**Owner:** Sergei
**Status:** v0 shipped to production; transitioning to design-partner phase
**Last updated:** April 30, 2026

---

## What this is, in one sentence

AI-native bank-to-books reconciliation for small businesses that keep their books in QuickBooks Online (and soon Xero).

## Who it's for (v0)

- Companies with 1–50 employees
- 1–3 connected bank accounts
- Books already in QuickBooks Online (U.S.)
- Bookkeeper or owner-operator doing the reconciliation today
- Target ACV: $49–$199/month

## Explicitly NOT for (v0)

- Mid-market on Sage Intacct or NetSuite — different product, different sale
- Accounting firms with 50+ client books — multi-tenant model, later
- Multi-entity consolidation
- Non-US books or non-USD accounts

---

## The v0 demo flow (the thing we raced to in 30 days)

A new user:

1. Signs up with email
2. Connects a bank account via Plaid
3. Connects QuickBooks Online via OAuth
4. Within ~90 seconds of finishing step 3, sees a table of the last 30 days of bank transactions where each row is in one of three states:
   - ✅ **Matched** — auto-linked to a QBO entry, confidence score visible
   - ⚠️ **Suggested** — not in QBO yet, AI proposes a journal entry (vendor + category), one click to push it to QBO
   - 🚨 **Flagged** — anomaly with a plain-English explanation ("$4,200 to a new vendor, 3× your average transaction, no matching invoice")

That was the v0 target. It is now substantially shipped except the anomaly narration and one-click push, which are scoped for the design-partner phase.

---

## Non-goals for v0 (read this twice)

- No multi-user / teams / roles
- No Stripe / billing — use a waitlist and hand-hold the first design partners free
- No Xero integration in the first 30 days (QBO first, end-to-end, then copy the pattern)
- No dashboards, reports, exports, charts
- No mobile app
- No multi-agent orchestration framework — one Next.js app, direct LLM calls when needed
- No custom ML models — use a frontier model with structured outputs and tool use
- No Docker, Kubernetes, microservices, message queues beyond what Inngest gives you
- No public landing page beyond a one-screen "coming soon" until v0 works

If you feel the urge to build any of these, open `PARKED.md` and write it down there. You will revisit it. Not now.

---

## Tech stack (opinionated — deviations require a one-paragraph written reason in the PR)

- **Framework:** Next.js 16 (App Router) + TypeScript, strict mode
- **UI:** Tailwind + shadcn/ui
- **Database:** Supabase (Postgres + auth + storage in one)
- **ORM:** Drizzle
- **Bank data:** Plaid (Sandbox → Trial Plan → paid plan as customers grow)
- **Books:** QuickBooks Online OAuth 2.0 via `intuit-oauth` SDK
- **LLM:** Anthropic API. Verify exact model strings via `grep -rn "claude-" src/`. Matching has been on Sonnet (4.5 family) since ticket 4; anomaly narration not yet implemented.
- **Background jobs:** Inngest (planned; not yet wired)
- **Hosting:** Vercel (production live as of ticket 9)
- **Observability:** Sentry minimal (errors only, no traces); Axiom parked
- **Package manager:** pnpm

## Architecture in one paragraph

One Next.js app, one Postgres database. Plaid webhooks (when wired) hit an Inngest function that syncs new transactions into Postgres. A second function pulls unmatched transactions in batches and runs one LLM call per batch with tools exposed: matching against the unified counterparty pool (ledger + QBO entries). The LLM returns structured JSON — match decisions + confidence + suggested entries. Anomaly detection + narration is a planned third function, not yet built. Every LLM prompt and response is logged to Postgres (`llm_logs` table) for debugging. You will need this log on day 4 — and have, repeatedly.

---

## 30-day milestones (v0 plan, mostly shipped)

- **Week 1 — Plumbing:** Next.js skeleton, Supabase auth, Plaid Link in Sandbox, transactions synced to DB, dashboard table of raw transactions. ✓
- **Week 2 — Books:** QBO OAuth flow, QBO entries synced to DB, deterministic rule-based matching (exact amount + date ±3 days). ✓
- **Week 3 — Intelligence:** LLM-augmented matching for messy descriptions. Confidence scoring. ✓ (Suggested journal entries deferred.)
- **Week 4 — Polish + push:** Anomaly detection + narration, one-click push to QBO, demo flow under 5 minutes, Loom recording. **Deferred to design-partner phase.**

## Success criteria

- Onboard a real friend's business from signup to matched table in under 5 minutes. **Not yet validated with a real customer.**
- LLM matching hits ≥85% precision on 30 days of their real transactions. **Pending real-bank data.**
- At least one design partner paying $1 for 3 months (the dollar matters — it's a commitment test, not revenue). **Pending design-partner conversations.**
- No feature added outside this spec. ✓ (Discipline held across 10 tickets.)

---

## What comes after v0 (parking lot, not v0 scope)

- Xero parity (week 5–6)
- Learned rules: "when you see X, code it to Y" — becomes per-customer config
- Month-end close checklist wrapping the matching view
- Accounting-firm tier: one login, many client books
- Anomaly → Slack / email digest
- THIS is where the programmable-ledger vision begins. Own the data layer first, then earn the right to talk about tokenized rails.

---

## What has shipped

- **April 20, 2026** — **Ticket 1 (v0 baseline):** signup → Plaid bank connect → transactions table rendering end-to-end.

- **April 20, 2026** — **Ticket 2:** CSV ledger upload, side-by-side dashboard.

- **April 21, 2026** — **Ticket 3:** deterministic matching (exact amount + money-flow direction + date ±3 days).

- **April 21, 2026** — **Ticket 4:** LLM matching layer with Sonnet 4.5 (`claude-sonnet-4-5-20250929`), `llm_logs` table, confidence badges on the dashboard. ~$0.028/click on realistic data.

- **April 22, 2026** — **Ticket 5:** review UI (accept/reject/unmatch/manual link) + rejected-pair exclusion in the LLM matcher. Manually verified end-to-end including DB-level inspection of the rejection filter.

- **April 23, 2026** — **Ticket 6:** QBO OAuth + manual sync across 6 entity types (Purchase, BillPayment, Deposit, Payment, SalesReceipt, JournalEntry), three-column dashboard, tri-state Connect/Reconnect/Disconnect button. Sandbox verified end-to-end including reconnect flow. Tokens stored plaintext at this point; encryption deferred to a combined Plaid+QBO ticket.

- **April 23, 2026** — **Ticket 7:** QBO as first-class matching target (Scope C). Both deterministic and LLM matchers now consider `ledger_entries` and `qbo_entries` as a unified counterparty pool. Manual link dialog shows unified list with CSV/QBO badges. Dashboard QBO column renders matched state symmetric to ledger. Schema: nullable FK + CHECK constraint guarantees exactly one counterparty per match. Sandbox verified end-to-end.

- **April 24, 2026** — **Ticket 8:** encryption at rest for Plaid and QBO tokens (AES-256-GCM, env-var key, `v1:` prefix for future rotation). Single shared helper at `src/lib/crypto/tokens.ts` with self-test on first use. One-shot clear script (`scripts/clear-for-encryption.ts`) handles plaintext-to-ciphertext transition via re-auth — deliberately kept out of `drizzle/migrations/`. Sandbox verified end-to-end.

- **April 28, 2026** — **Ticket 9:** production deploy to Vercel. Stable URL `reconcile-orcin.vercel.app`. Sentry minimal install (errors only, no traces, no replays). DEPLOY.md runbook at repo root. Smoke check verified end-to-end on prod: magic-link auth, Plaid OAuth (sandbox), QBO OAuth (sandbox realm 9341456929031248), encryption verified `v1:` prefix on all three token columns, deterministic + LLM matching ran clean. DB password rotated post-deploy (single-session leak via chat-app URL formatter, defensive rotation despite zero users).

- **April 30, 2026** — **Ticket 10:** scaffolded the Plaid Sandbox → Production swap on the Trial Plan (10-Item cap, warm-only outreach, no Security Questionnaire / LEI required at this tier). Confirmed no app code changes required — Plaid SDK init at `src/lib/plaid.ts` reads `PLAID_ENV` cleanly with no hardcoded sandbox values or test credentials in `src/`. Added `scripts/clear-plaid-data.ts` (one-shot, mirrors the ticket-8 clear pattern; truncates `plaid_items`, `bank_accounts`, `transactions` with CASCADE; preserves QBO, ledger, and `llm_logs`) and corresponding `pnpm clear-plaid-data` script entry. Documented the env-swap procedure in `DEPLOY.md` (clear-script step, `vercel env rm`/`add` sequence for `PLAID_ENV` / `PLAID_CLIENT_ID` / `PLAID_SECRET`, Trial Plan limit callout, post-swap `v1:` psql check via session pooler). Parked the Pay-as-you-go upgrade path, the Plaid Production readiness checklist, and real-world transaction-description normalization for matcher precision. Env swap, prod DB clear, redeploy, and real-bank smoke check happen outside this session.

---

## Guardrails for your future self

- If a feature isn't on the milestone list, it doesn't ship without an explicit decision to add it.
- If you're 3 days behind on any week, cut scope — don't extend the week.
- Weekly Friday review: did you ship what the milestone said, or not? Be honest.
- The moment you feel like redesigning the architecture, re-read this file instead.
- Customer conversations are not optional. No more than one week of engineering between conversations once design-partner phase begins.

---

## Scaling & cost triggers

This section captures when to change tools, upgrade tiers, or re-architect. The goal: don't pay for scale we don't have, but have clear signals for when to act.

### Infrastructure tiers

**Supabase free tier** — 500MB DB, 50K MAU, 2GB bandwidth. DB cap hits first. 1 SMB with 2 years of transactions ≈ 5–20MB.

- Upgrade to Supabase Pro ($25/mo) when: 10 paying customers OR DB >300MB.

**Plaid** — Sandbox is free forever. Trial Plan (current tier as of April 2026) caps at 10 connected Production Items. Paid plans charge per connected account per month.

- Upgrade from Trial to a paid plan when: about to cross the 10-Item cap, OR when graduating beyond design partners into open onboarding.
- Watch the subscription-product trap: Transactions is a subscription product. Items connected during Trial that include subscription-fee products start billing the moment the account upgrades to paid. Persist tokens carefully — losing one means you can't `/item/remove` it and you'll keep paying.

**Vercel** — Hobby is currently sufficient. Production deploy live.

- Upgrade to Pro ($20/mo) when: first paying customer OR hitting bandwidth/function-execution limits.

**Database connection mode** — currently Transaction Pooler (port 6543), correct for serverless. Migrations run from local against the direct connection (port 5432). Don't switch app to Session Pooler without a specific reason.

### LLM cost & latency

**Per-click cost (ticket 4 measurements):**

- Empty proposals (no fuzzy matches found): ~3.3K input + ~33 output tokens = ~$0.011
- Realistic proposals (6 fuzzy matches in 12×30 grid): ~3.6K input + ~1.1K output tokens = ~$0.028
- **Operating assumption: 2–3 cents per "Run matching" click at current scale.**

**Triggers to re-evaluate LLM path:**

- Monthly Anthropic bill for app usage > $50 → implement Haiku-first pass for high-confidence cases, escalate to Sonnet only on ambiguous ones
- p95 latency on Run matching > 30 seconds → implement batching per `llm.ts:161` TODO, send only 50 most-recent unmatched rows per call
- Any single customer reports 100+ unmatched rows after deterministic → prioritize batching immediately

**Haiku fallback design (deferred):** For pairs with exact-description match (after normalization) + amount within $0.01 + date within 1 day, a Haiku call is probably enough and ~10× cheaper. Don't build until cost data justifies.

### Dev-time cost (Claude Code)

Claude Code runs on Claude Max subscription, which has usage caps.

**Effort settings by ticket type:**

- **Opus 4.7 xhigh** — novel architecture, multi-file refactors, anything touching matching/LLM logic, debugging subtle issues
- **Opus 4.7 medium** — standard feature work with clear spec (most tickets)
- **Sonnet** — UI polish, adding a column, tweaking copy, fixing typos

Check Max usage monthly. If hitting caps often, be more deliberate with effort levels.

### Build & CI

`pnpm build` times out in Claude Code's 5-minute sandbox on a cold compile. Not a real failure — typecheck + lint passing is sufficient signal. Do full builds manually in your own terminal when needed before deploy.

### Stack-level stability rules

- **Don't chase versions.** We're on Next 16, Node 22, Drizzle current. Upgrade only for security patches or specific features we need.
- **Drizzle → raw SQL before swapping ORMs.** If a query gets hard to express, drop into `db.execute(sql\`...\`)`. Don't move to Prisma.
- **Supabase Auth is the default forever unless it specifically fails us.** Magic link works. Add Supabase's built-in OAuth providers for SSO when accounting-firm tier requires. Don't move to Clerk/Auth0.
- **Separate Postgres only post-Supabase-Pro-limits AND post-revenue.** Likely 50–100 paying customers out. Not a near-term concern.
