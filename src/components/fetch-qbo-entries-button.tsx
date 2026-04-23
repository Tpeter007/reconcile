"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { syncQboEntriesAction } from "@/app/qbo/actions";
import type { QboConnectionState } from "@/components/connect-qbo-button";

const ERROR_MESSAGES: Record<string, string> = {
  not_connected: "Connect QuickBooks first.",
  reconnect_required: "QuickBooks connection needs to be reconnected.",
  not_authenticated: "Not signed in.",
  sync_failed: "QBO sync failed. Check the server logs.",
};

function formatBreakdown(by_type: Record<string, number>): string {
  const entries = Object.entries(by_type).filter(([, n]) => n > 0);
  if (entries.length === 0) return "no entities returned anything";
  return entries.map(([k, v]) => `${k}: ${v}`).join(", ");
}

export function FetchQboEntriesButton({
  connectionState,
}: {
  connectionState: QboConnectionState;
}) {
  const [isPending, startTransition] = useTransition();
  const disabled = connectionState !== "connected" || isPending;

  function onClick() {
    startTransition(async () => {
      const result = await syncQboEntriesAction();
      if (!result.ok) {
        toast.error(ERROR_MESSAGES[result.error] ?? `QBO error: ${result.error}`);
        return;
      }
      const breakdown = formatBreakdown(result.by_type);
      const base = `QBO: ${result.created} created, ${result.updated} updated (${breakdown})`;
      if (result.failures.length > 0) {
        const failed = result.failures.map((f) => f.entity).join(", ");
        toast.warning(`${base}. Failed: ${failed}.`);
      } else {
        toast.success(base);
      }
    });
  }

  return (
    <Button variant="outline" onClick={onClick} disabled={disabled}>
      {isPending ? "Fetching QBO…" : "Fetch QBO entries"}
    </Button>
  );
}
