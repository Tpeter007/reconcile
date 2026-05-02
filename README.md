# Reconcile

A bank-to-books reconciliation tool for small businesses. Pulls bank transactions via Plaid, pulls accounting entries from QuickBooks Online, and uses Claude to suggest matches between them.

Built solo as a learning project. Shipped to production on real bank data, then archived after market research showed the AI bookkeeping space is already crowded with funded incumbents (Booke.ai, Vic.ai, Truewind) and the customer wedge wasn't worth pursuing further.

## What it does

- Magic-link auth (Supabase)
- Plaid integration for bank transaction sync
- QuickBooks Online OAuth + entity sync (six entity types)
- CSV ledger upload as a QBO alternative
- Deterministic matching (amount + date + direction)
- LLM matching via Claude Sonnet 4.5 with rejection feedback loop
- Three-column dashboard (bank / ledger / QBO)
- AES-256-GCM encryption at rest for all OAuth tokens

## Stack

Next.js 16 (App Router), TypeScript, Tailwind + shadcn/ui, Supabase Postgres + Auth, Drizzle ORM, Plaid, Anthropic SDK, deployed on Vercel with minimal Sentry.

## Project shape

- 11 tickets, ~6 weeks solo
- One ticket per branch, screenshot-driven approval discipline
- Every deferred decision documented in `PARKED.md`
- Full architecture notes in `PROJECT_SPEC.md`
- Deploy runbook in `DEPLOY.md`

## What I learned

- Solo full-stack shipping with AI as a senior-engineer pair: how to scope tickets, when to defer, when to push back on the AI's first answer
- Encryption-at-rest patterns and key rotation infrastructure
- OAuth flows for two different providers with different security postures
- The discipline of a parked-items file — every "we should fix this later" written down and dated, so future-me has context
- That a working v0 is not a market — most of the work after shipping is customer discovery, and the technical build is the cheapest part

## Why I stopped

The AI bookkeeping category is contested by funded startups 2-3 years ahead on product, distribution, and brand. Differentiating against QBO's built-in flow plus Booke/Vic/Truewind would require a sharp customer wedge I don't have and a sales motion I don't enjoy. The product is good portfolio evidence but not a viable business in this market.

## Status

Archived. Production deployment removed, secrets revoked, real customer data cleared.

---

Built April–May 2026.
