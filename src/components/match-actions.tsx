"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  acceptMatch,
  rejectMatch,
  unmatchConfirmed,
} from "@/app/matching/review-actions";
import {
  ManualLinkDialog,
  type BankRowInfo,
  type UnmatchedLedgerEntry,
} from "@/components/manual-link-dialog";

export function AcceptRejectButtons({ matchId }: { matchId: string }) {
  const [isPending, startTransition] = useTransition();

  function onAccept() {
    startTransition(async () => {
      const result = await acceptMatch(matchId);
      if (result.ok) toast.success("Match accepted");
      else toast.error(result.error);
    });
  }

  function onReject() {
    startTransition(async () => {
      const result = await rejectMatch(matchId);
      if (result.ok) toast.success("Match rejected");
      else toast.error(result.error);
    });
  }

  return (
    <div className="flex gap-1">
      <Button size="xs" variant="outline" onClick={onAccept} disabled={isPending}>
        Accept
      </Button>
      <Button size="xs" variant="outline" onClick={onReject} disabled={isPending}>
        Reject
      </Button>
    </div>
  );
}

export function UnmatchButton({ matchId }: { matchId: string }) {
  const [isPending, startTransition] = useTransition();

  function onClick() {
    startTransition(async () => {
      const result = await unmatchConfirmed(matchId);
      if (result.ok) toast.success("Unmatched");
      else toast.error(result.error);
    });
  }

  return (
    <Button size="xs" variant="outline" onClick={onClick} disabled={isPending}>
      Unmatch
    </Button>
  );
}

export function ManualLinkButton({
  bankRow,
  unmatchedLedgerEntries,
}: {
  bankRow: BankRowInfo;
  unmatchedLedgerEntries: UnmatchedLedgerEntry[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button size="xs" variant="outline" onClick={() => setOpen(true)}>
        Link
      </Button>
      <ManualLinkDialog
        open={open}
        onOpenChange={setOpen}
        bankRow={bankRow}
        unmatchedLedgerEntries={unmatchedLedgerEntries}
      />
    </>
  );
}
