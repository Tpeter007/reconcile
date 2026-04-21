import { redirect } from "next/navigation";
import { desc, eq, inArray } from "drizzle-orm";
import { Check } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/db";
import {
  bankAccounts,
  ledgerEntries,
  matches,
  plaidItems,
  transactions,
} from "@/db/schema";
import { cn } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PlaidLinkButton } from "@/components/plaid-link-button";
import { LedgerUploadButton } from "@/components/ledger-upload-button";
import { RunMatchingButton } from "@/components/run-matching-button";
import { SignOutButton } from "./sign-out-button";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const items = await db
    .select({ id: plaidItems.id })
    .from(plaidItems)
    .where(eq(plaidItems.userId, user.id));
  const itemIds = items.map((i) => i.id);

  const bankRows =
    itemIds.length === 0
      ? []
      : await db
          .select({
            id: transactions.id,
            date: transactions.date,
            description: transactions.description,
            amount: transactions.amount,
            pending: transactions.pending,
            mask: bankAccounts.mask,
            accountName: bankAccounts.name,
          })
          .from(transactions)
          .innerJoin(
            bankAccounts,
            eq(transactions.bankAccountId, bankAccounts.id),
          )
          .where(inArray(bankAccounts.plaidItemId, itemIds))
          .orderBy(desc(transactions.date), desc(transactions.createdAt))
          .limit(100);

  const ledgerRows = await db
    .select({
      id: ledgerEntries.id,
      date: ledgerEntries.date,
      description: ledgerEntries.description,
      account: ledgerEntries.account,
      reference: ledgerEntries.reference,
      amount: ledgerEntries.amount,
    })
    .from(ledgerEntries)
    .where(eq(ledgerEntries.userId, user.id))
    .orderBy(desc(ledgerEntries.date), desc(ledgerEntries.createdAt))
    .limit(100);

  const matchRows = await db
    .select({
      bankTransactionId: matches.bankTransactionId,
      ledgerEntryId: matches.ledgerEntryId,
    })
    .from(matches)
    .where(eq(matches.userId, user.id));

  const matchedBankIds = new Set(matchRows.map((m) => m.bankTransactionId));
  const matchedLedgerIds = new Set(matchRows.map((m) => m.ledgerEntryId));

  const bankMatchedCount = bankRows.filter((r) => matchedBankIds.has(r.id))
    .length;
  const ledgerMatchedCount = ledgerRows.filter((r) =>
    matchedLedgerIds.has(r.id),
  ).length;

  const currency = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  });

  return (
    <main className="flex flex-1 flex-col gap-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Reconcile</h1>
          <p className="text-sm text-muted-foreground">
            Bank transactions and ledger entries, side by side.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <LedgerUploadButton />
          <PlaidLinkButton />
          <RunMatchingButton />
          <SignOutButton />
        </div>
      </header>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Bank transactions</CardTitle>
            <p className="text-sm text-muted-foreground">
              {bankRows.length} total, {bankMatchedCount} matched,{" "}
              {bankRows.length - bankMatchedCount} unmatched
            </p>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Date</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Account</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bankRows.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="text-center text-muted-foreground py-8"
                    >
                      {itemIds.length === 0
                        ? "No bank connected yet. Use Connect a bank to link one."
                        : "No transactions in the last 30 days yet."}
                    </TableCell>
                  </TableRow>
                ) : (
                  bankRows.map((r) => {
                    const matched = matchedBankIds.has(r.id);
                    return (
                      <TableRow
                        key={r.id}
                        className={cn(matched && "text-muted-foreground")}
                      >
                        <TableCell className="w-8">
                          {matched ? (
                            <Check
                              className="h-4 w-4 text-emerald-600"
                              aria-label="Matched"
                            />
                          ) : null}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {r.date}
                        </TableCell>
                        <TableCell>{r.description}</TableCell>
                        <TableCell>
                          {r.mask ? `•••• ${r.mask}` : r.accountName}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {currency.format(Number(r.amount))}
                        </TableCell>
                        <TableCell>
                          {r.pending ? "Pending" : "Posted"}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Ledger entries</CardTitle>
            <p className="text-sm text-muted-foreground">
              {ledgerRows.length} total, {ledgerMatchedCount} matched,{" "}
              {ledgerRows.length - ledgerMatchedCount} unmatched
            </p>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Date</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Account</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ledgerRows.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="text-center text-muted-foreground py-8"
                    >
                      No ledger entries yet. Upload a CSV to see them here.
                    </TableCell>
                  </TableRow>
                ) : (
                  ledgerRows.map((r) => {
                    const matched = matchedLedgerIds.has(r.id);
                    return (
                      <TableRow
                        key={r.id}
                        className={cn(matched && "text-muted-foreground")}
                      >
                        <TableCell className="w-8">
                          {matched ? (
                            <Check
                              className="h-4 w-4 text-emerald-600"
                              aria-label="Matched"
                            />
                          ) : null}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {r.date}
                        </TableCell>
                        <TableCell>{r.description}</TableCell>
                        <TableCell>{r.account ?? ""}</TableCell>
                        <TableCell>{r.reference ?? ""}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {currency.format(Number(r.amount))}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
