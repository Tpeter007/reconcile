# PROJECT_SPEC.md
**Working codename:** Reconcile (rename before you tell anyone outside the build)
**Owner:** Sergei
**Status:** v0 in progress
**Last updated:** April 20, 2026

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

## The v0 demo video (the thing we're racing to in 30 days)
A new user:
1. Signs up with email
2. Connects a bank account via Plaid
3. Connects QuickBooks Online via OAuth
4. Within ~90 seconds of finishing step 3, sees a table of the last 30 days of bank transactions where each row is in one of three states:

   - ✅ **Matched** — auto-linked to a QBO entry, confidence score visible
   - ⚠️ **Suggested** — not in QBO yet, AI proposes a journal entry (vendor + category), one click to push it to QBO
   - 🚨 **Flagged** — anomaly with a plain-English explanation ("$4,200 to a new vendor, 3× your average transaction, no matching invoice")

That's the whole v0. If you catch yourself designing past that screen, you are off-scope.

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

If you feel the urge to build any of these, open a file called `PARKED.md` and write it down there. You will revisit it. Not now.

---

## Tech stack (opinionated — deviations require a one-paragraph written reason in the PR)
- **Framework:** Next.js 15 (App Router) + TypeScript, strict mode
- **UI:** Tailwind + shadcn/ui
- **Database:** Supabase (Postgres + auth + storage in one)
- **ORM:** Drizzle
- **Bank data:** Plaid (Sandbox → Development → Production)
- **Books:** QuickBooks Online OAuth 2.0 via `intuit-oauth` SDK
- **LLM:** Anthropic API, Claude Sonnet 4.6 for matching, Claude Opus 4.7 for anomaly narration
- **Background jobs:** Inngest
- **Hosting:** Vercel
- **Observability:** Sentry + Axiom for logs
- **Package manager:** pnpm

## Architecture in one paragraph
One Next.js app, one Postgres database. Plaid webhooks hit an Inngest function that syncs new transactions into Postgres. A second Inngest function pulls unmatched transactions in batches of ~20 and runs one LLM call per batch with two tools exposed: `search_qbo_entries(query)` and `get_vendor_history(vendor_name)`. The LLM returns structured JSON — match decisions + confidence + suggested entries. A third function detects anomalies (amount, vendor, timing) and runs a narration call. Every LLM prompt and response is logged to Postgres for debugging. You will need this log on day 4.

---

## 30-day milestones
- **Week 1 — Plumbing**: Next.js skeleton, Supabase auth, Plaid Link in Sandbox, transactions synced to DB, dashboard table of raw transactions.
- **Week 2 — Books**: QBO OAuth flow, QBO entries synced to DB, deterministic rule-based matching (exact amount + date ±3 days). Ship this even though it's dumb.
- **Week 3 — Intelligence**: LLM-augmented matching for messy descriptions, split payments, and foreign-currency conversions. Confidence scoring. Suggested journal entries.
- **Week 4 — Polish + push**: Anomaly detection + narration. One-click push to QBO. Demo flow from signup to "holy shit" in under 5 minutes. Record a Loom.

## Success criteria
- You can onboard a real friend's business from signup to matched table in under 5 minutes.
- LLM matching hits ≥85% precision on 30 days of their real transactions.
- At least one design partner paying $1 for 3 months (the dollar matters — it's a commitment test, not revenue).
- You have not added a single feature outside this spec.

---

## What comes after v0 (parking lot, not v0 scope)
- Xero parity (week 5–6)
- Learned rules: "when you see X, code it to Y" — becomes per-customer config
- Month-end close checklist wrapping the matching view
- Accounting-firm tier: one login, many client books
- Anomaly → Slack / email digest
- THIS is where the programmable-ledger vision begins. Own the data layer first, then earn the right to talk about tokenized rails.

## Guardrails for your future self
- If a feature isn't on the 30-day milestone list, it doesn't ship in v0.
- If you're 3 days behind on any week, cut scope — don't extend the week.
- Weekly Friday review: did you ship what the milestone said, or not? Be honest.
- The moment you feel like redesigning the architecture, re-read this file instead.

---

## Sample data
The repo ships with `sample-ledger.csv` (April 2026 expenses/income with specific
amounts and dates) and the Plaid Sandbox dataset (a static set of synthetic
transactions with fixed descriptions and amounts, dated relative to "today"
when Plaid returns them). These two sources were not generated together, so
the deterministic matcher (exact amount ± same money-flow direction, date
within ±3 days) will generally produce zero matches between them out of the
box. This is the honest behavior and intentional — a realistic reconciliation
flow needs a ledger that corresponds to the same underlying bank activity. To
see the matcher flag pairs during a demo, either (a) upload a ledger CSV whose
dates/amounts align with the Plaid Sandbox transactions you just pulled, or
(b) wait until real Plaid data and a real ledger are connected.
