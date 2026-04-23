import { Suspense } from "react";
import { redirect } from "next/navigation";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { Check } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/db";
import {
  bankAccounts,
  ledgerEntries,
  matches,
  plaidItems,
  qboConnections,
  qboEntries,
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
import {
  ConnectQboButton,
  type QboConnectionState,
} from "@/components/connect-qbo-button";
import { FetchQboEntriesButton } from "@/components/fetch-qbo-entries-button";
import { QboQueryToast } from "@/components/qbo-query-toast";
import {
  AcceptRejectButtons,
  ManualLinkButton,
  UnmatchButton,
} from "@/components/match-actions";
import type { UnmatchedLedgerEntry } from "@/components/manual-link-dialog";
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

  const [qboConn] = await db
    .select({
      id: qboConnections.id,
      refreshTokenExpiresAt: qboConnections.refreshTokenExpiresAt,
    })
    .from(qboConnections)
    .where(eq(qboConnections.userId, user.id))
    .limit(1);

  const now = new Date();
  const qboState: QboConnectionState = !qboConn
    ? "disconnected"
    : qboConn.refreshTokenExpiresAt > now
      ? "connected"
      : "reconnect_required";

  const qboRows = await db
    .select({
      id: qboEntries.id,
      date: qboEntries.date,
      description: qboEntries.description,
      account: qboEntries.account,
      reference: qboEntries.reference,
      amount: qboEntries.amount,
      qboEntityType: qboEntries.qboEntityType,
    })
    .from(qboEntries)
    .where(eq(qboEntries.userId, user.id))
    .orderBy(desc(qboEntries.date), desc(qboEntries.createdAt))
    .limit(100);

  const qboCountsByType = qboRows.reduce<Record<string, number>>((acc, r) => {
    acc[r.qboEntityType] = (acc[r.qboEntityType] ?? 0) + 1;
    return acc;
  }, {});

  const activeMatches = await db
    .select({
      id: matches.id,
      bankTransactionId: matches.bankTransactionId,
      ledgerEntryId: matches.ledgerEntryId,
      method: matches.method,
      confidence: matches.confidence,
      state: matches.state,
    })
    .from(matches)
    .where(and(eq(matches.userId, user.id), ne(matches.state, "rejected")));

  const matchByBankId = new Map(
    activeMatches.map((m) => [m.bankTransactionId, m]),
  );
  const matchByLedgerId = new Map(
    activeMatches.map((m) => [m.ledgerEntryId, m]),
  );

  const bankMatchedCount = bankRows.filter((r) =>
    matchByBankId.has(r.id),
  ).length;
  const ledgerMatchedCount = ledgerRows.filter((r) =>
    matchByLedgerId.has(r.id),
  ).length;

  const unmatchedLedgerEntries: UnmatchedLedgerEntry[] = ledgerRows
    .filter((r) => !matchByLedgerId.has(r.id))
    .map((r) => ({
      id: r.id,
      date: r.date,
      description: r.description,
      amount: r.amount,
    }));

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
          <ConnectQboButton state={qboState} />
          <FetchQboEntriesButton connectionState={qboState} />
          <RunMatchingButton />
          <SignOutButton />
        </div>
      </header>

      <Suspense fallback={null}>
        <QboQueryToast />
      </Suspense>

      <div className="overflow-x-auto">
      <div className="grid min-w-[1200px] grid-cols-1 gap-6 md:grid-cols-3">
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
                  <TableHead className="w-10" />
                  <TableHead>Date</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Account</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bankRows.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="text-center text-muted-foreground py-8"
                    >
                      {itemIds.length === 0
                        ? "No bank connected yet. Use Connect a bank to link one."
                        : "No transactions in the last 30 days yet."}
                    </TableCell>
                  </TableRow>
                ) : (
                  bankRows.map((r) => {
                    const match = matchByBankId.get(r.id);
                    const matched = match !== undefined;
                    const isLlm = match?.method === "llm_v1";
                    const isProposed = match?.state === "proposed";
                    return (
                      <TableRow
                        key={r.id}
                        className={cn(matched && "text-muted-foreground")}
                      >
                        <TableCell className="w-10">
                          {matched ? (
                            <div className="flex items-center gap-1">
                              <Check
                                className="h-4 w-4 text-emerald-600"
                                aria-label="Matched"
                              />
                              {isLlm ? (
                                <span className="text-[10px] text-muted-foreground tabular-nums">
                                  {Number(match.confidence).toFixed(2)}
                                </span>
                              ) : null}
                            </div>
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
                        <TableCell className="text-right">
                          {!matched ? (
                            <ManualLinkButton
                              bankRow={{
                                id: r.id,
                                date: r.date,
                                description: r.description,
                                amount: r.amount,
                              }}
                              unmatchedLedgerEntries={unmatchedLedgerEntries}
                            />
                          ) : isProposed ? (
                            <AcceptRejectButtons matchId={match.id} />
                          ) : (
                            <UnmatchButton matchId={match.id} />
                          )}
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
                  <TableHead className="w-10" />
                  <TableHead>Date</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Account</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ledgerRows.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="text-center text-muted-foreground py-8"
                    >
                      No ledger entries yet. Upload a CSV to see them here.
                    </TableCell>
                  </TableRow>
                ) : (
                  ledgerRows.map((r) => {
                    const match = matchByLedgerId.get(r.id);
                    const matched = match !== undefined;
                    const isLlm = match?.method === "llm_v1";
                    const isProposed = match?.state === "proposed";
                    return (
                      <TableRow
                        key={r.id}
                        className={cn(matched && "text-muted-foreground")}
                      >
                        <TableCell className="w-10">
                          {matched ? (
                            <div className="flex items-center gap-1">
                              <Check
                                className="h-4 w-4 text-emerald-600"
                                aria-label="Matched"
                              />
                              {isLlm ? (
                                <span className="text-[10px] text-muted-foreground tabular-nums">
                                  {Number(match.confidence).toFixed(2)}
                                </span>
                              ) : null}
                            </div>
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
                        <TableCell className="text-right">
                          {matched ? (
                            isProposed ? (
                              <AcceptRejectButtons matchId={match.id} />
                            ) : (
                              <UnmatchButton matchId={match.id} />
                            )
                          ) : null}
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
            <CardTitle>QBO entries</CardTitle>
            <p className="text-sm text-muted-foreground">
              {qboRows.length} total
            </p>
            <p className="text-xs text-muted-foreground">
              {Object.keys(qboCountsByType).length === 0
                ? qboState === "disconnected"
                  ? "Connect QuickBooks to pull entries."
                  : "No entries yet — click Fetch QBO entries."
                : Object.entries(qboCountsByType)
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([k, v]) => `${k}: ${v}`)
                    .join(" · ")}
            </p>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10" />
                  <TableHead>Date</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Account</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Type</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {qboRows.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="text-center text-muted-foreground py-8"
                    >
                      {qboState === "disconnected"
                        ? "QuickBooks not connected."
                        : qboState === "reconnect_required"
                          ? "Reconnect QuickBooks to refresh entries."
                          : "No QBO entries in the last 30 days yet."}
                    </TableCell>
                  </TableRow>
                ) : (
                  qboRows.map((r) => {
                    // QBO entries can never be in `matches` in v0 (Scope C will
                    // wire that up). Keep the matched-style branch present so
                    // the next ticket doesn't have to rewrite this block.
                    const matched = false;
                    return (
                      <TableRow
                        key={r.id}
                        className={cn(matched && "text-muted-foreground")}
                      >
                        <TableCell className="w-10">
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
                        <TableCell className="text-xs text-muted-foreground">
                          {r.qboEntityType}
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
      </div>
    </main>
  );
}
