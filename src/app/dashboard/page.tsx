import { redirect } from "next/navigation";
import { desc, eq, inArray } from "drizzle-orm";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/db";
import { bankAccounts, plaidItems, transactions } from "@/db/schema";
import {
  Card,
  CardContent,
  CardDescription,
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

  if (items.length === 0) {
    return (
      <main className="flex flex-1 items-center justify-center p-6">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Connect a bank to get started</CardTitle>
            <CardDescription>
              We&apos;ll pull the last 30 days of transactions. Use Plaid
              Sandbox credentials (<span className="font-mono">user_good</span>{" "}
              / <span className="font-mono">pass_good</span>).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <PlaidLinkButton />
          </CardContent>
        </Card>
      </main>
    );
  }

  const itemIds = items.map((i) => i.id);

  const rows = await db
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
    .innerJoin(bankAccounts, eq(transactions.bankAccountId, bankAccounts.id))
    .where(inArray(bankAccounts.plaidItemId, itemIds))
    .orderBy(desc(transactions.date), desc(transactions.createdAt))
    .limit(100);

  const currency = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  });

  return (
    <main className="flex flex-1 flex-col gap-6 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Transactions</h1>
          <p className="text-sm text-muted-foreground">
            Showing the most recent 100 transactions from your connected
            accounts.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <PlaidLinkButton />
          <SignOutButton />
        </div>
      </header>

      <Card>
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
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="text-center text-muted-foreground py-8"
                  >
                    No transactions in the last 30 days yet.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((r) => (
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
    </main>
  );
}
