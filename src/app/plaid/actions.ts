"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { CountryCode, Products, type Transaction } from "plaid";
import { plaid } from "@/lib/plaid";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/db";
import { bankAccounts, plaidItems, transactions } from "@/db/schema";

async function requireUserId(): Promise<string> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  return user.id;
}

export async function createLinkToken(): Promise<{ linkToken: string }> {
  const userId = await requireUserId();

  const response = await plaid.linkTokenCreate({
    user: { client_user_id: userId },
    client_name: "Reconcile",
    products: [Products.Transactions],
    country_codes: [CountryCode.Us],
    language: "en",
  });

  return { linkToken: response.data.link_token };
}

export async function exchangePublicToken(
  publicToken: string,
): Promise<{ ok: true }> {
  const userId = await requireUserId();

  const exchange = await plaid.itemPublicTokenExchange({
    public_token: publicToken,
  });
  const accessToken = exchange.data.access_token;
  const itemId = exchange.data.item_id;

  const itemInfo = await plaid.itemGet({ access_token: accessToken });
  const institutionId = itemInfo.data.item.institution_id;
  let institutionName: string | null = null;
  if (institutionId) {
    const inst = await plaid.institutionsGetById({
      institution_id: institutionId,
      country_codes: [CountryCode.Us],
    });
    institutionName = inst.data.institution.name;
  }

  const [item] = await db
    .insert(plaidItems)
    .values({
      userId,
      accessToken,
      itemId,
      institutionName,
    })
    .onConflictDoUpdate({
      target: plaidItems.itemId,
      set: { accessToken, institutionName },
    })
    .returning();

  const accountsResp = await plaid.accountsGet({ access_token: accessToken });
  const accountIdMap = new Map<string, string>();
  for (const acc of accountsResp.data.accounts) {
    const [row] = await db
      .insert(bankAccounts)
      .values({
        plaidItemId: item.id,
        plaidAccountId: acc.account_id,
        name: acc.name,
        mask: acc.mask ?? null,
        type: acc.type,
        subtype: acc.subtype ?? null,
      })
      .onConflictDoUpdate({
        target: bankAccounts.plaidAccountId,
        set: {
          name: acc.name,
          mask: acc.mask ?? null,
          type: acc.type,
          subtype: acc.subtype ?? null,
        },
      })
      .returning({ id: bankAccounts.id, plaidAccountId: bankAccounts.plaidAccountId });
    accountIdMap.set(row.plaidAccountId, row.id);
  }

  const added: Transaction[] = [];
  let cursor: string | undefined = undefined;
  let hasMore = true;
  while (hasMore) {
    const sync = await plaid.transactionsSync({
      access_token: accessToken,
      cursor,
      count: 500,
    });
    added.push(...sync.data.added);
    // For this ticket we don't process modified/removed — TODO: handle in sync worker.
    hasMore = sync.data.has_more;
    cursor = sync.data.next_cursor;
  }

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setUTCDate(thirtyDaysAgo.getUTCDate() - 30);
  const cutoff = thirtyDaysAgo.toISOString().slice(0, 10);

  const recent = added.filter((t) => t.date >= cutoff);

  for (const t of recent) {
    const bankAccountId = accountIdMap.get(t.account_id);
    if (!bankAccountId) continue;
    await db
      .insert(transactions)
      .values({
        bankAccountId,
        plaidTransactionId: t.transaction_id,
        date: t.date,
        amount: t.amount.toString(),
        description: t.name,
        merchantName: t.merchant_name ?? null,
        pending: t.pending,
        rawJson: t,
      })
      .onConflictDoUpdate({
        target: transactions.plaidTransactionId,
        set: {
          date: t.date,
          amount: t.amount.toString(),
          description: t.name,
          merchantName: t.merchant_name ?? null,
          pending: t.pending,
          rawJson: t,
        },
      });
  }

  await db
    .update(plaidItems)
    .set({ cursor: cursor ?? null })
    .where(eq(plaidItems.id, item.id));

  revalidatePath("/dashboard");
  return { ok: true };
}
