"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { createManualMatch } from "@/app/matching/review-actions";

export type BankRowInfo = {
  id: string;
  date: string;
  description: string;
  amount: string;
};

export type UnmatchedCounterparty = {
  id: string;
  source: "ledger" | "qbo";
  date: string;
  description: string;
  amount: string;
};

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

export function ManualLinkDialog({
  open,
  onOpenChange,
  bankRow,
  unmatchedCounterparties,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bankRow: BankRowInfo;
  unmatchedCounterparties: UnmatchedCounterparty[];
}) {
  const [filter, setFilter] = useState("");
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const q = filter.trim().toLowerCase();
  const filtered = q
    ? unmatchedCounterparties.filter((e) =>
        e.description.toLowerCase().includes(q),
      )
    : unmatchedCounterparties;

  function onLink(entry: UnmatchedCounterparty) {
    const key = `${entry.source}|${entry.id}`;
    setPendingKey(key);
    startTransition(async () => {
      const result = await createManualMatch(bankRow.id, entry.id, entry.source);
      setPendingKey(null);
      if (result.ok) {
        toast.success("Linked");
        onOpenChange(false);
        setFilter("");
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Link bank transaction to a counterparty</DialogTitle>
          <DialogDescription>
            {bankRow.date} · {bankRow.description} ·{" "}
            <span className="tabular-nums">
              {currency.format(Number(bankRow.amount))}
            </span>
          </DialogDescription>
        </DialogHeader>

        <Input
          placeholder="Filter by description…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />

        <div className="max-h-80 overflow-y-auto rounded-md border">
          {filtered.length === 0 ? (
            <div className="p-4 text-center text-sm text-muted-foreground">
              {unmatchedCounterparties.length === 0
                ? "No unmatched counterparty entries."
                : "No counterparty entries match that filter."}
            </div>
          ) : (
            <ul className="divide-y">
              {filtered.map((entry) => {
                const key = `${entry.source}|${entry.id}`;
                return (
                  <li
                    key={key}
                    className="flex items-center gap-2 p-2 text-sm"
                  >
                    <span className="shrink-0 text-xs rounded bg-muted px-1.5 py-0.5 font-medium">
                      {entry.source === "qbo" ? "QBO" : "CSV"}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="truncate">{entry.description}</div>
                      <div className="text-xs text-muted-foreground tabular-nums">
                        {entry.date} · {currency.format(Number(entry.amount))}
                      </div>
                    </div>
                    <Button
                      size="xs"
                      variant="outline"
                      disabled={pendingKey !== null}
                      onClick={() => onLink(entry)}
                    >
                      Link
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
