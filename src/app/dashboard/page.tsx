import { redirect } from "next/navigation";
import { desc, eq, inArray } from "drizzle-orm";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/db";
import {
  bankAccounts,
  ledgerEntries,
  plaidItems,
  transactions,
} from "@/db/schema";
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
          <SignOutButton />
        </div>
      </header>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Bank transactions</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
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
                      colSpan={5}
                      className="text-center text-muted-foreground py-8"
                    >
                      {itemIds.length === 0
                        ? "No bank connected yet. Use Connect a bank to link one."
                        : "No transactions in the last 30 days yet."}
                    </TableCell>
                  </TableRow>
                ) : (
                  bankRows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="whitespace-nowrap">
                        {r.date}
                      </TableCell>
                      <TableCell>{r.description}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {r.mask ? `•••• ${r.mask}` : r.accountName}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {currency.format(Number(r.amount))}
                      </TableCell>
                      <TableCell>{r.pending ? "Pending" : "Posted"}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Ledger entries</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
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
                      colSpan={5}
                      className="text-center text-muted-foreground py-8"
                    >
                      No ledger entries yet. Upload a CSV to see them here.
                    </TableCell>
                  </TableRow>
                ) : (
                  ledgerRows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="whitespace-nowrap">
                        {r.date}
                      </TableCell>
                      <TableCell>{r.description}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {r.account ?? ""}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {r.reference ?? ""}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {currency.format(Number(r.amount))}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
